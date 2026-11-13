import { BlurView } from "expo-blur";
import { usePathname } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type RefObject } from "react";
import {
  ActivityIndicator,
  Image,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  SlideInLeft,
  SlideInRight,
  useAnimatedKeyboard,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import {
  DateDetail,
  dateValue,
  DetailsList,
  DurationDetail,
  PriorityDetail,
  RepeatDetail,
  type DetailKey,
} from "@/components/addSheet/AddSheetDetails";
import { SheetIcon, type SheetIconName } from "@/components/addSheet/SheetParts";
import { formatShortTime, formatTime, longDay } from "@/components/addSheet/sheetFormat";
import { TaskPreviewCard } from "@/components/addSheet/TaskPreviewCard";
import { MAX_TASK_TITLE_LENGTH } from "@/components/TaskFormFields";
import { colors } from "@/constants/theme";
import { useAiLocked } from "@/hooks/useAiLocked";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import { classifyIntent } from "@/lib/ai/classifyIntent";
import { aiUnavailableMessage } from "@/lib/ai/language";
import { extractAttachmentText } from "@/lib/ai/media";
import type { ExtractedTaskDraft } from "@/lib/ai/types";
import { makeDeadline, type DeadlineInput } from "@/lib/deadline";
import { formatTaskLength } from "@/lib/formatDuration";
import { getLanguage } from "@/lib/i18n";
import { pad, toLocalDateKey, type LocalDate } from "@/lib/localDate";
import { adjustToPace, computePace } from "@/lib/pace";
import { openPaywall, showPlanLimit } from "@/lib/paywall";
import { pickContextDocument, pickContextPhoto, takeContextPhoto, type PickOutcome } from "@/lib/pickContextFile";
import { PlanLimitError } from "@/lib/plan";
import { posthog } from "@/lib/posthog";
import { parseQuickAdd } from "@/lib/quickAdd";
import { buildRule, describeRule, slotDeadline, type RuleInput } from "@/lib/recurrence";
import type { ImportanceLevel } from "@/lib/scoring";
import { useAddSheetStore } from "@/store/useAddSheetStore";
import { entriesFor, useFocusLogStore } from "@/store/useFocusLogStore";
import type { ContextAttachment } from "@/store/useReassessStore";
import { taskIdForCandidate, useTaskStore } from "@/store/useTaskStore";
import type { TaskPriorityLevel } from "@/types/task";
import { shadow } from "@/constants/shadow";

const P = colors.palette;

// The page behind: blurred (the mockups' 7 px) and darkened.
const BLUR_INTENSITY = 28;
const ANDROID_BLUR_REDUCTION = 2.4;
const OPEN_MS = 280;
const CLOSE_MS = 220;
const SHEET_SHADOW = shadow("0 -12px 30px rgba(34, 28, 23, 0.2)", 16);
const SEND_SHADOW = shadow("0 6px 14px rgba(242, 106, 46, 0.35)", 5, "#F26A2E");
const ADD_SHADOW = shadow("0 8px 18px rgba(242, 106, 46, 0.3)", 6, "#F26A2E");
const MENU_SHADOW = shadow("0 18px 38px rgba(34, 28, 23, 0.28)", 12);
/** Room kept above whatever floats over the sheet. */
const FLOAT_GAP = 14;

/** One task as the line (or Nexdo AI, from the line or a photo) read it — what the sheet saves. */
type QuickTask = {
  id?: string;
  title: string;
  estimatedMinutes: number;
  deadline?: DeadlineInput;
  priorityLevel: ImportanceLevel;
  recurrence?: RuleInput;
  /** The guessed length was set to the user's pace (Pro, lib/pace.ts). */
  paced?: boolean;
};

/** An AI draft in the quick task's shape: its deadline back to a day, and a time only if one was said. */
function fromDraft(draft: ExtractedTaskDraft): QuickTask {
  let deadline: DeadlineInput | undefined;
  if (draft.dueDate) {
    const due = new Date(draft.dueDate);
    deadline = draft.dueHasTime
      ? { date: toLocalDateKey(due), time: `${pad(due.getHours())}:${pad(due.getMinutes())}` }
      : { date: toLocalDateKey(due) };
  }
  // No steps from here: a task is broken down in its focus session (the user's call, 2026-11-08).
  return {
    id: draft.candidateId ? taskIdForCandidate(draft.candidateId) : undefined,
    title: draft.title,
    estimatedMinutes: draft.estimatedMinutes,
    deadline,
    priorityLevel: draft.priorityLevel,
    recurrence: draft.recurrence,
  };
}

/** Tasks Nexdo AI found — in a photo or file, or in a line the rules couldn't read — each kept or not. */
type Found = { tasks: QuickTask[]; keep: boolean[]; source: "photo" | "text" };

type Attachment = { file: ContextAttachment; status: "reading" | "done" | "failed" };

/** What the user set in Details; each one wins over what the line says. */
type Overrides = {
  deadline?: DeadlineInput | null;
  minutes?: number;
  repeat?: RuleInput | null;
  priority?: TaskPriorityLevel;
};

type View_ = "type" | "details" | DetailKey;

/**
 * iOS: the keyboard's height, frame by frame, from Reanimated; the sheet is
 * lifted by exactly this much.
 */
function useKeyboardLiftIos() {
  const keyboard = useAnimatedKeyboard();
  // The settled height, for sizing the sheet; the shared value moves it.
  const [height, setHeight] = useState(0);
  useAnimatedReaction(
    () => Math.round(keyboard.height.value),
    (next, previous) => {
      if (next !== previous) scheduleOnRN(setHeight, next);
    },
  );
  return { lift: keyboard.height, height };
}

/**
 * Android: no lift. The sheet sits in its own window (a Modal) that Android
 * itself ends at the keyboard's top. Reading the keyboard's height there never
 * worked: the app's "pan" mode slides the whole screen instead (just far
 * enough to show the typed line, so Details stayed under the keyboard), and
 * Reanimated's reader gets no numbers in that mode (2026-11-09 screenshots).
 */
function useNoKeyboardLift() {
  const lift = useSharedValue(0);
  return { lift, height: 0 };
}

const useKeyboardLift = Platform.OS === "android" ? useNoKeyboardLift : useKeyboardLiftIos;
/** Android's sheet window (see useNoKeyboardLift). */
const OWN_WINDOW = Platform.OS === "android";
/**
 * Before Android 15 the system pads that window itself (down to the keyboard
 * or the navigation bar), and the Modal's own frame padded it again unless
 * the status bar is "translucent" — on the user's phone a gap the height of
 * the navigation bar over the keyboard (2026-11-09). Android 15+ draws windows
 * edge to edge, so there only the Modal's frame does it.
 */
const SYSTEM_PADS_WINDOW = OWN_WINDOW && typeof Platform.Version === "number" && Platform.Version < 35;
/** After the window shows: asking for the keyboard before that is dropped. */
const FOCUS_DELAY_MS = 180;

/** The sheet's place in the tabs layout: mounted only while it's open. */
export function AddTaskSheetHost({ blurTarget }: { blurTarget: RefObject<ComponentRef<typeof View> | null> }) {
  const open = useAddSheetStore((state) => state.open);
  return open ? <AddTaskSheet blurTarget={blurTarget} /> : null;
}

/**
 * Add task (addtask-design/, 2026-11-08): a sheet over the blurred page with
 * the keyboard up. One line is read as it's typed (lib/quickAdd.ts) — its
 * day, time, length and repeat marked in orange — and a preview card of the
 * task floats above. Details opens Date, Duration, Repeat and Priority, one at
 * a time; the + adds tasks from a photo or a file (Pro), read by Nexdo AI.
 */
function AddTaskSheet({ blurTarget }: { blurTarget: RefObject<ComponentRef<typeof View> | null> }) {
  const t = useTranslation();
  const rtl = useRtlText();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const hide = useAddSheetStore((state) => state.hide);
  const addTask = useTaskStore((state) => state.addTask);
  const tasks = useTaskStore((state) => state.tasks);
  const aiLocked = useAiLocked();
  const { lift, height: keyboardHeight } = useKeyboardLift();
  // The sheet's area: the whole screen on iOS; on Android, its window's room
  // between the status bar and the keyboard (or the navigation bar).
  const [overlayHeight, setOverlayHeight] = useState(windowHeight);
  // Android: the tallest the window has been, so a shorter one means the keyboard is up.
  const [fullHeight, setFullHeight] = useState(0);
  const handleAreaLayout = (height: number) => {
    setOverlayHeight(height);
    setFullHeight((current) => Math.max(current, height));
  };
  // The room above the keyboard (or the whole area when it's closed).
  const available = Math.max(0, overlayHeight - keyboardHeight);
  // The sheet's box ends right on the keyboard, following it as it moves.
  const liftStyle = useAnimatedStyle(() => ({ bottom: lift.value }));
  // Navigating away (the paywall) closes the sheet: on Android its window
  // would otherwise stay over the new page.
  const pathname = usePathname();
  const openedOn = useRef(pathname);
  useEffect(() => {
    if (pathname !== openedOn.current) hide();
  }, [hide, pathname]);
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  // Whether the sheet is still open when an AI answer comes back. Set in the
  // effect too: development mounts everything twice, cleanup included.
  const mounted = useRef(true);
  const attachmentRequest = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const [line, setLine] = useState("");
  // The line as typed right now, for an AI answer arriving after it changed.
  const lineRef = useRef("");
  const [lineTouched, setLineTouched] = useState(false);
  const [aiState, setAiState] = useState<"idle" | "reading" | "empty">("idle");
  const [found, setFound] = useState<Found | null>(null);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [view, setView] = useState<View_>("type");
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(0);
  const [floatHeight, setFloatHeight] = useState(0);

  // ─── Open and close ────────────────────────────────────────────────────
  const progress = useSharedValue(0);
  const closing = useRef(false);
  useEffect(() => {
    progress.set(withTiming(1, { duration: reduceMotion ? 0 : OPEN_MS, easing: Easing.out(Easing.cubic) }));
  }, [progress, reduceMotion]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    Keyboard.dismiss();
    progress.set(
      withTiming(0, { duration: reduceMotion ? 0 : CLOSE_MS, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) scheduleOnRN(hide);
      }),
    );
  }, [hide, progress, reduceMotion]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - progress.value) * (windowHeight * 0.6) }] }));
  const stripStyle = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - progress.value) * (windowHeight * 0.6) }] }));

  // ─── Reading the line ──────────────────────────────────────────────────
  const now = useMemo(() => new Date(), [line]); // eslint-disable-line react-hooks/exhaustive-deps
  const parsed = useMemo(() => parseQuickAdd(line, now, getLanguage()), [line, now]);
  const userId = useTaskStore((state) => state.syncUserId);
  const focusEntries = useFocusLogStore((state) => state.entries);
  const pace = useMemo(() => (aiLocked ? null : computePace(entriesFor(focusEntries, userId))), [aiLocked, focusEntries, userId]);
  const lineMinutes = parsed.durationTyped ? parsed.estimatedMinutes : adjustToPace(parsed.estimatedMinutes, pace);

  // The task as it will be saved: the line, with whatever Details changed on top.
  const deadline = overrides.deadline !== undefined ? (overrides.deadline ?? undefined) : parsed.deadline;
  const minutes = overrides.minutes ?? lineMinutes;
  const repeat = overrides.repeat !== undefined ? overrides.repeat : (parsed.recurrence ?? null);
  const priority: ImportanceLevel = overrides.priority ?? parsed.priorityLevel;
  const priorityLevel: TaskPriorityLevel = priority === "critical" ? "high" : priority;
  const paced = overrides.minutes === undefined && lineMinutes !== parsed.estimatedMinutes;

  const hasLine = line.trim().length > 0;
  const titleMissing = lineTouched && !found && !parsed.title;

  // The line, split so what the rules read can be marked.
  const segments = useMemo(() => {
    const parts: { text: string; mark: boolean }[] = [];
    let at = 0;
    for (const range of parsed.highlights) {
      if (range.start > at) parts.push({ text: line.slice(at, range.start), mark: false });
      parts.push({ text: line.slice(range.start, range.end), mark: true });
      at = range.end;
    }
    if (at < line.length) parts.push({ text: line.slice(at), mark: false });
    return parts;
  }, [line, parsed.highlights]);

  const busy = useMemo(() => {
    const counts = new Map<LocalDate, number>();
    for (const task of tasks) {
      if (task.status !== "pending" || !task.deadline?.date) continue;
      counts.set(task.deadline.date, (counts.get(task.deadline.date) ?? 0) + 1);
    }
    return counts;
  }, [tasks]);

  /** What a card says about a task: when (its first day, if it repeats) and how long. */
  const describeTask = (task: Pick<QuickTask, "deadline" | "estimatedMinutes" | "recurrence" | "paced">, foundCard: boolean) => {
    const rule = task.recurrence ? buildRule(task.recurrence, makeDeadline(task.deadline), now) : null;
    const shown = rule ? slotDeadline(rule, rule.anchorDate) : makeDeadline(task.deadline);
    const dateLabel =
      foundCard && rule
        ? describeRule(rule, t)
        : shown
          ? `${longDay(shown.date, now, t)}${shown.time ? ` · ${formatTime(shown.time, t.locale)}` : ""}`
          : undefined;
    const lengthLabel =
      task.estimatedMinutes > 0
        ? task.paced
          ? `${formatTaskLength(task.estimatedMinutes)} · ${t.form.quick.yourPace}`
          : formatTaskLength(task.estimatedMinutes)
        : undefined;
    return { dateLabel, lengthLabel, repeats: !!rule };
  };

  // ─── Editing ───────────────────────────────────────────────────────────
  const handleLineChange = (text: string) => {
    lineRef.current = text;
    setLine(text);
    if (lineTouched) setLineTouched(false);
    if (found?.source === "text") setFound(null);
    if (aiState !== "idle") setAiState("idle");
  };

  const setOverride = <K extends keyof Overrides>(key: K, value: Overrides[K]) =>
    setOverrides((current) => ({ ...current, [key]: value }));

  const openDetails = () => {
    Keyboard.dismiss();
    setMenuOpen(false);
    setView("details");
  };
  const hideDetails = () => {
    setView("type");
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  // Pro: the line goes to the same AI the brain dump uses, for whatever it
  // makes of it as new tasks. Counted against the month's AI messages.
  const handleAiRead = async () => {
    const text = line.trim();
    if (!text || aiState === "reading") return;
    setAiState("reading");
    posthog.capture("quick_add_ai_read");
    try {
      const turn = await classifyIntent({ text, now: new Date(), recentTaskIds: [], tasks: [] });
      const drafts = turn.actions.flatMap((action) => (action.type === "CREATE_TASK" ? action.drafts : []));
      if (!mounted.current) return;
      // The line may have changed while the AI was reading it: then its answer is stale.
      if (lineRef.current.trim() !== text) {
        setAiState("idle");
        return;
      }
      setFound(drafts.length > 0 ? { tasks: drafts.map(fromDraft), keep: drafts.map(() => true), source: "text" } : null);
      setAiState(drafts.length > 0 ? "idle" : "empty");
    } catch (error) {
      if (!mounted.current) return;
      setAiState("idle");
      if (error instanceof PlanLimitError) showPlanLimit(error.meter);
      // classifyIntent falls back to the offline reader when the AI can't be
      // reached, so this is something unexpected — still worth a word.
      else {
        console.warn("[AddTaskSheet] AI read failed", error);
        setProblem(aiUnavailableMessage(getLanguage()));
      }
    }
  };

  // A photo or a file (Pro): read by the vision model, then by the same AI as
  // the line, into tasks to keep or not — the brain dump's own steps.
  const handlePick = async (pick: () => Promise<PickOutcome>) => {
    setMenuOpen(false);
    if (aiLocked) {
      openPaywall("media");
      return;
    }
    const request = ++attachmentRequest.current;
    let outcome: PickOutcome;
    try {
      outcome = await pick();
    } catch (error) {
      if (!mounted.current || request !== attachmentRequest.current) return;
      console.warn("[AddTaskSheet] couldn't pick a file", error);
      setProblem(t.taskDetail.attach.pickFailed);
      return;
    }
    if (!mounted.current || request !== attachmentRequest.current || outcome.status === "cancelled") return;
    if (outcome.status !== "picked") {
      setProblem(
        outcome.status === "tooBig"
          ? t.taskDetail.attach.tooBig
          : outcome.status === "unsupported"
            ? t.taskDetail.attach.unsupported
            : t.taskDetail.attach.cameraDenied,
      );
      return;
    }
    const file = outcome.file;
    Keyboard.dismiss();
    setView("type");
    setProblem(null);
    setFound(null);
    setAttachment({ file, status: "reading" });
    posthog.capture("add_task_from_file", { kind: file.kind });
    try {
      const text = await extractAttachmentText(file, { language: getLanguage() });
      if (!mounted.current || request !== attachmentRequest.current) return;
      if (!text) {
        setAttachment({ file, status: "failed" });
        setProblem(file.kind === "photo" ? t.taskDetail.attach.emptyPhoto : t.taskDetail.attach.emptyDocument);
        return;
      }
      const turn = await classifyIntent({ text, now: new Date(), recentTaskIds: [], tasks: [] });
      const drafts = turn.actions.flatMap((action) => (action.type === "CREATE_TASK" ? action.drafts : []));
      if (!mounted.current || request !== attachmentRequest.current) return;
      setAttachment({ file, status: "done" });
      if (drafts.length === 0) {
        setProblem(t.form.quick.aiNothing);
        return;
      }
      setFound({ tasks: drafts.map(fromDraft), keep: drafts.map(() => true), source: "photo" });
    } catch (error) {
      if (!mounted.current || request !== attachmentRequest.current) return;
      setAttachment({ file, status: "failed" });
      if (error instanceof PlanLimitError) showPlanLimit(error.meter);
      else setProblem(t.taskDetail.attach.readFailed);
    }
  };

  const removeAttachment = () => {
    attachmentRequest.current += 1;
    setAttachment(null);
    setFound(null);
    setProblem(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const toggleKeep = (index: number) =>
    setFound((current) => (current ? { ...current, keep: current.keep.map((keep, other) => (other === index ? !keep : keep)) } : current));

  // ─── Saving ────────────────────────────────────────────────────────────
  const save = (task: QuickTask, source: string) => {
    addTask({
      id: task.id,
      title: task.title.slice(0, MAX_TASK_TITLE_LENGTH),
      estimatedMinutes: task.estimatedMinutes,
      deadline: task.deadline,
      priorityLevel: task.priorityLevel,
      recurrence: task.recurrence,
    });
    posthog.capture("task_created", {
      source,
      priority_level: task.priorityLevel,
      estimated_minutes: task.estimatedMinutes,
      has_deadline: Boolean(task.deadline),
      step_count: 0,
      recurrence: task.recurrence?.frequency ?? "none",
    });
  };

  const keptCount = found ? found.keep.filter(Boolean).length : 0;
  const reading = aiState === "reading" || attachment?.status === "reading";
  const canSend = !reading && (found ? keptCount > 0 : !!parsed.title);

  const handleSubmit = () => {
    if (reading) return;
    if (found) {
      if (keptCount === 0) return;
      found.tasks.forEach((task, index) => {
        if (found.keep[index]) save(task, found.source === "photo" ? "add_from_file" : "quick_add_ai");
      });
      close();
      return;
    }
    if (!parsed.title) {
      setLineTouched(true);
      return;
    }
    save(
      {
        title: parsed.title,
        estimatedMinutes: minutes,
        deadline,
        priorityLevel: priority,
        recurrence: repeat ?? undefined,
      },
      Object.keys(overrides).length > 0 ? "quick_add_details" : "quick_add",
    );
    close();
  };

  // ─── Back and outside taps ─────────────────────────────────────────────
  // Back goes up a level: the menu, a detail, the details list, then the sheet.
  const goBack = useCallback(() => {
    if (menuOpen) setMenuOpen(false);
    else if (view !== "type" && view !== "details") setView("details");
    else if (view === "details") setView("type");
    else close();
  }, [close, menuOpen, view]);

  // A tap outside closes the sheet (or just the menu, when it's open).
  const handleOutsidePress = () => {
    if (menuOpen) setMenuOpen(false);
    else close();
  };

  // Back on Android: the sheet's window gets it (Modal onRequestClose).

  // ─── Layout ────────────────────────────────────────────────────────────
  const keyboardOpen = OWN_WINDOW ? fullHeight - overlayHeight > 120 : keyboardHeight > 0;
  // Android's window already ends above the navigation bar.
  const bottomPadding = keyboardOpen || OWN_WINDOW ? 14 : Math.max(28, insets.bottom + 14);
  // The sheet never runs up under the status bar (outside Android's window),
  // nor under what floats on it.
  const topInset = OWN_WINDOW && !SYSTEM_PADS_WINDOW ? 0 : insets.top;
  const floatSpace = floatHeight > 0 ? floatHeight + FLOAT_GAP : 0;
  const sheetMax = Math.max(220, available - topInset - 12 - Math.min(floatSpace, 140));
  const floatMax = Math.max(120, available - topInset - 16 - sheetHeight - FLOAT_GAP);

  const detailOpen = view === "date" || view === "duration" || view === "repeat" || view === "priority";
  const entering = (from: "right" | "left") =>
    reduceMotion ? undefined : (from === "right" ? SlideInRight : SlideInLeft).duration(220).easing(Easing.out(Easing.cubic));

  const detailRows: { key: DetailKey; icon: SheetIconName; label: string; value: string }[] = [
    { key: "date", icon: "calendar", label: t.addSheet.date, value: dateValue(deadline, now, t, (time) => formatShortTime(time, t.locale)) },
    { key: "duration", icon: "clock", label: t.addSheet.duration, value: formatTaskLength(minutes) },
    {
      key: "repeat",
      icon: "repeat",
      label: t.addSheet.repeat,
      value: (() => {
        const rule = repeat ? buildRule(repeat, makeDeadline(deadline), now) : null;
        return rule ? describeRule(rule, t) : t.recurrence.frequencies.none;
      })(),
    },
    { key: "priority", icon: "flag", label: t.addSheet.priority, value: t.addSheet[priorityLevel] },
  ];

  // Under the line: what's wrong with it, or what Nexdo AI could do with it.
  const hint = titleMissing ? (
    <Text style={[{ fontFamily: "SpaceGrotesk-Medium", fontSize: 13, color: P.alert }, rtl]}>{t.form.quick.titleMissing}</Text>
  ) : !hasLine || found ? null : aiState === "empty" ? (
    <Text style={[{ fontFamily: "SpaceGrotesk-Medium", fontSize: 13, color: P.inkMuted }, rtl]}>{t.form.quick.aiNothing}</Text>
  ) : parsed.looksLikeChange ? (
    aiLocked ? (
      <AnimatedPressable onPress={() => openPaywall("live")} scaleTo={0.97} accessibilityRole="button">
        <Text style={{ fontFamily: "SpaceGrotesk-SemiBold", fontSize: 13, color: P.accentInk }}>{t.form.quick.changeHintLocked}</Text>
      </AnimatedPressable>
    ) : (
      <Text style={[{ fontFamily: "SpaceGrotesk-Medium", fontSize: 13, color: P.inkMuted }, rtl]}>{t.form.quick.changeHint}</Text>
    )
  ) : parsed.unclear ? (
    aiState === "reading" ? (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <ActivityIndicator size="small" color={P.accent} />
        <Text style={{ fontFamily: "SpaceGrotesk-Medium", fontSize: 13, color: P.inkMuted }}>{t.form.quick.aiReading}</Text>
      </View>
    ) : (
      <AnimatedPressable
        onPress={aiLocked ? () => openPaywall("chat") : () => void handleAiRead()}
        scaleTo={0.97}
        accessibilityRole="button"
      >
        <Text style={{ fontFamily: "SpaceGrotesk-SemiBold", fontSize: 13, color: P.accentInk }}>
          {aiLocked ? t.form.quick.aiLocked : t.form.quick.aiRead}
        </Text>
      </AnimatedPressable>
    )
  ) : null;

  // ─── Pieces ────────────────────────────────────────────────────────────
  const plusButton = (
    <AnimatedPressable
      onPress={() => {
        if (!menuOpen) Keyboard.dismiss();
        setMenuOpen((open) => !open);
      }}
      scaleTo={0.92}
      accessibilityRole="button"
      accessibilityLabel={menuOpen ? t.common.close : t.addSheet.fromPhoto}
      accessibilityState={{ expanded: menuOpen }}
      style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: menuOpen ? P.ink : P.chip, alignItems: "center", justifyContent: "center" }}
    >
      <SheetIcon name={menuOpen ? "close" : "plus"} size={21} color={menuOpen ? "#FFFFFF" : P.ink} strokeWidth={2.3} />
    </AnimatedPressable>
  );

  const inputRow = (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
      {plusButton}
      <TextInput
        ref={inputRef}
        // Android focuses it once its window shows (Modal onShow): focused
        // any earlier, the keyboard never came up, and a second focus() was
        // ignored as already done.
        autoFocus={!OWN_WINDOW}
        multiline
        onChangeText={handleLineChange}
        onFocus={() => {
          setMenuOpen(false);
          if (view === "details") setView("type");
        }}
        placeholder={t.addSheet.placeholder}
        placeholderTextColor={P.inkFaint}
        maxLength={MAX_TASK_TITLE_LENGTH + 100}
        submitBehavior="submit"
        returnKeyType="done"
        onSubmitEditing={handleSubmit}
        selectionColor={P.accent}
        cursorColor={P.accent}
        accessibilityLabel={t.addSheet.placeholder}
        style={[
          {
            flex: 1,
            minHeight: 44,
            maxHeight: 26 * 4 + 16,
            paddingTop: 8,
            paddingBottom: 8,
            paddingHorizontal: 0,
            fontFamily: "SpaceGrotesk-SemiBold",
            fontSize: 19,
            lineHeight: 26,
            color: P.ink,
            textAlignVertical: "top",
          },
          rtl,
        ]}
      >
        {segments.map((segment, index) =>
          segment.mark ? (
            <Text key={index} style={{ color: P.accentInk, backgroundColor: P.peach }}>
              {segment.text}
            </Text>
          ) : (
            <Text key={index}>{segment.text}</Text>
          ),
        )}
      </TextInput>
      <AnimatedPressable
        onPress={handleSubmit}
        disabled={!canSend}
        scaleTo={0.92}
        accessibilityRole="button"
        accessibilityLabel={found ? t.addSheet.addTasks(keptCount) : t.addSheet.addTask}
        accessibilityState={{ disabled: !canSend }}
        style={[
          { width: 44, height: 44, borderRadius: 22, backgroundColor: canSend ? P.accent : P.line, alignItems: "center", justifyContent: "center" },
          canSend ? SEND_SHADOW : null,
        ]}
      >
        <SheetIcon name="arrowUp" size={22} color="#FFFFFF" strokeWidth={2.6} />
      </AnimatedPressable>
    </View>
  );

  const fileRow = attachment ? (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      {plusButton}
      <View
        style={{
          flexShrink: 1,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingVertical: 6,
          paddingLeft: 6,
          paddingRight: 12,
          borderRadius: 16,
          backgroundColor: P.paperCard,
          borderWidth: 1.5,
          borderColor: P.lineWarm,
        }}
      >
        {attachment.file.kind === "photo" ? (
          <Image source={{ uri: attachment.file.uri }} style={{ width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: P.line }} />
        ) : (
          // A document: a ruled page.
          <View style={{ width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: P.line, backgroundColor: "#FFFFFF", paddingTop: 6, gap: 6, overflow: "hidden" }}>
            {[0, 1, 2, 3, 4].map((row) => (
              <View key={row} style={{ height: 1, backgroundColor: P.chip }} />
            ))}
          </View>
        )}
        <View style={{ flexShrink: 1 }}>
          <Text numberOfLines={1} style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 14, color: P.ink }}>
            {attachment.file.name ?? attachment.file.label}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            {attachment.status === "reading" ? <ActivityIndicator size="small" color={P.accent} style={{ transform: [{ scale: 0.7 }] }} /> : null}
            <Text style={{ fontFamily: "SpaceGrotesk-Regular", fontSize: 12, color: P.inkMuted }}>
              {attachment.status === "reading" ? t.addSheet.reading : t.addSheet.readBy}
            </Text>
          </View>
        </View>
        <AnimatedPressable onPress={removeAttachment} scaleTo={0.9} hitSlop={8} accessibilityRole="button" accessibilityLabel={t.addSheet.removeFile} style={{ marginLeft: 6 }}>
          <SheetIcon name="close" size={16} color={P.inkFaint} strokeWidth={2.2} />
        </AnimatedPressable>
      </View>
    </View>
  ) : null;

  const detailsPill = (
    <AnimatedPressable
      onPress={view === "details" ? hideDetails : openDetails}
      scaleTo={0.95}
      accessibilityRole="button"
      accessibilityState={{ expanded: view === "details" }}
      style={{
        height: 34,
        paddingHorizontal: 12,
        borderRadius: 17,
        backgroundColor: view === "details" ? P.ink : P.chip,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
      }}
    >
      <Text style={{ fontFamily: "SpaceGrotesk-SemiBold", fontSize: 13.5, color: view === "details" ? "#FFFFFF" : P.ink }}>
        {view === "details" ? t.addSheet.hideDetails : t.addSheet.details}
      </Text>
      <View style={{ transform: [{ rotate: view === "details" ? "180deg" : "0deg" }] }}>
        <SheetIcon name="chevronDown" size={15} color={view === "details" ? "#FFFFFF" : P.ink} strokeWidth={2.4} />
      </View>
    </AnimatedPressable>
  );

  const backToDetails = () => setView("details");

  const sheetBody = detailOpen ? (
    <Animated.View key={view} entering={entering("right")}>
      {view === "date" ? (
        <DateDetail deadline={deadline} onChange={(next) => setOverride("deadline", next ?? null)} busy={busy} now={now} onBack={backToDetails} />
      ) : view === "duration" ? (
        <DurationDetail minutes={minutes} onChange={(next) => setOverride("minutes", next)} onBack={backToDetails} />
      ) : view === "repeat" ? (
        <RepeatDetail repeat={repeat} onChange={(next) => setOverride("repeat", next)} deadline={deadline} now={now} onBack={backToDetails} />
      ) : (
        <PriorityDetail value={priorityLevel} onChange={(next) => setOverride("priority", next)} onBack={backToDetails} />
      )}
    </Animated.View>
  ) : (
    <Animated.View key="main" entering={view === "details" ? undefined : entering("left")} style={{ gap: 12 }}>
      {attachment ? fileRow : inputRow}
      {!attachment && (hint || (hasLine && !found)) ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: -2 }}>
          <View style={{ flex: 1 }}>{hint}</View>
          {hasLine && !found ? detailsPill : null}
        </View>
      ) : null}
      {problem ? <Text style={[{ fontFamily: "SpaceGrotesk-Medium", fontSize: 13, color: P.alert }, rtl]}>{problem}</Text> : null}
      {view === "details" && !attachment && !found ? (
        <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(200)} exiting={reduceMotion ? undefined : FadeOut.duration(120)}>
          <DetailsList rows={detailRows} onOpen={(key) => setView(key)} />
        </Animated.View>
      ) : null}
      {attachment && found ? (
        <AnimatedPressable
          onPress={handleSubmit}
          disabled={keptCount === 0}
          scaleTo={0.98}
          accessibilityRole="button"
          style={[
            { height: 54, borderRadius: 27, backgroundColor: P.accent, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, opacity: keptCount === 0 ? 0.4 : 1 },
            ADD_SHADOW,
          ]}
        >
          <SheetIcon name="plus" size={18} color="#FFFFFF" strokeWidth={2.4} />
          <Text style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 16, color: "#FFFFFF", includeFontPadding: false }}>{t.addSheet.addTasks(keptCount)}</Text>
        </AnimatedPressable>
      ) : null}
    </Animated.View>
  );

  // What floats over the sheet: the photo menu, the tasks found, or the new task's preview.
  const single = describeTask({ deadline, estimatedMinutes: minutes, recurrence: repeat ?? undefined, paced }, false);
  const floating = menuOpen ? (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(150)}
      accessibilityRole="menu"
      style={[{ width: 280, alignSelf: "flex-start", borderRadius: 22, backgroundColor: P.menu, padding: 6 }, MENU_SHADOW]}
    >
      {(
        [
          { icon: "camera", title: t.addSheet.takePhoto, hint: t.addSheet.takePhotoHint, pick: takeContextPhoto },
          { icon: "image", title: t.addSheet.choosePhoto, hint: t.addSheet.choosePhotoHint, pick: pickContextPhoto },
          { icon: "file", title: t.addSheet.uploadFile, hint: t.addSheet.uploadFileHint, pick: pickContextDocument },
        ] as const
      ).map((option) => (
        <AnimatedPressable
          key={option.icon}
          onPress={() => void handlePick(option.pick)}
          scaleTo={0.98}
          accessibilityRole="menuitem"
          accessibilityLabel={aiLocked ? `${option.title} — ${t.plan.proOnly}` : option.title}
          style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 14 }}
        >
          <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: P.peach, alignItems: "center", justifyContent: "center" }}>
            <SheetIcon name={option.icon} size={19} color={P.accentInk} />
          </View>
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 15, color: P.ink }}>{option.title}</Text>
            <Text style={{ fontFamily: "SpaceGrotesk-Regular", fontSize: 12.5, color: P.inkMuted }}>{option.hint}</Text>
          </View>
          {aiLocked ? <SheetIcon name="lock" size={15} color={P.inkMuted} /> : null}
        </AnimatedPressable>
      ))}
    </Animated.View>
  ) : found ? (
    <View style={{ gap: 10, maxHeight: floatMax }}>
      <Text
        style={{
          marginLeft: 4,
          fontFamily: "SpaceMono-Bold",
          fontSize: 11,
          letterSpacing: 1.32,
          textTransform: "uppercase",
          color: P.paper,
          textShadowColor: "rgba(0, 0, 0, 0.35)",
          textShadowRadius: 6,
          textShadowOffset: { width: 0, height: 1 },
        }}
      >
        {t.addSheet.found(found.tasks.length)}
      </Text>
      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 10, paddingBottom: 4 }} showsVerticalScrollIndicator={false}>
        {found.tasks.map((task, index) => {
          const info = describeTask(task, true);
          return (
            <TaskPreviewCard
              key={task.id ?? `found-${index}`}
              title={task.title}
              dateLabel={info.dateLabel}
              lengthLabel={info.lengthLabel}
              repeats={info.repeats}
              kept={found.keep[index]}
              onToggleKeep={() => toggleKeep(index)}
            />
          );
        })}
      </ScrollView>
    </View>
  ) : hasLine && !attachment ? (
    <TaskPreviewCard title={parsed.title || "…"} dateLabel={single.dateLabel} lengthLabel={single.lengthLabel} repeats={single.repeats} />
  ) : null;

  // The sheet and the taps around it: in the page on iOS, in their own window
  // on Android (which ends it at the keyboard).
  const sheetArea = (
    <View
      onLayout={(event) => handleAreaLayout(event.nativeEvent.layout.height)}
      style={StyleSheet.absoluteFill}
      accessibilityViewIsModal
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={handleOutsidePress} accessibilityRole="button" accessibilityLabel={t.common.close} />

      {/* A box from the top down to the keyboard (or the bottom): the sheet
          sits at its foot. */}
      <Animated.View
        pointerEvents="box-none"
        style={[{ position: "absolute", left: 0, right: 0, top: 0, justifyContent: "flex-end" }, liftStyle]}
      >
        <Animated.View style={sheetStyle}>
          {/* Floating over the sheet, a little above it. */}
          <View
            pointerEvents="box-none"
            onLayout={(event) => setFloatHeight(floating ? event.nativeEvent.layout.height : 0)}
            style={{ position: "absolute", left: 20, right: 20, bottom: "100%", marginBottom: FLOAT_GAP }}
          >
            {floating}
          </View>

          {/* No size animation: when Details appears the sheet is simply taller
              at once — growing into it showed the gap being filled (user, 2026-11-09). */}
          <Animated.View
            onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}
            style={[
              {
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                backgroundColor: P.paper,
                paddingTop: 10,
                paddingBottom: bottomPadding,
                maxHeight: sheetMax,
              },
              // Android: none — it would show as a dark line where the window
              // ends above the navigation bar.
              OWN_WINDOW ? null : SHEET_SHADOW,
            ]}
          >
            <View style={{ alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: P.handle, marginBottom: 12 }} />
            <ScrollView
              style={{ flexGrow: 0 }}
              contentContainerStyle={{ paddingHorizontal: 20 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {sheetBody}
            </ScrollView>
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </View>
  );

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, backdropStyle]}>
        <BlurView
          blurTarget={blurTarget}
          blurMethod="dimezisBlurViewSdk31Plus"
          blurReductionFactor={ANDROID_BLUR_REDUCTION}
          tint="default"
          intensity={BLUR_INTENSITY}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: P.veil }, backdropStyle]} />

      {OWN_WINDOW ? (
        <>
          {/* The sheet's paper carried on under the navigation bar, below its window. */}
          <Animated.View
            pointerEvents="none"
            style={[{ position: "absolute", left: 0, right: 0, bottom: 0, height: insets.bottom, backgroundColor: P.paper }, stripStyle]}
          />
          <Modal
            visible
            transparent
            animationType="none"
            statusBarTranslucent={SYSTEM_PADS_WINDOW}
            navigationBarTranslucent={false}
            onRequestClose={goBack}
            onShow={() => {
              setTimeout(() => inputRef.current?.focus(), FOCUS_DELAY_MS);
            }}
          >
            {sheetArea}
          </Modal>
        </>
      ) : (
        sheetArea
      )}
    </View>
  );
}
