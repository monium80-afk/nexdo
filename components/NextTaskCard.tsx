import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import { ScrollView, Text, View, type TextLayoutEvent, type ViewProps } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInUp,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type AnimatedProps,
  type SharedValue,
} from "react-native-reanimated";

import { AllowanceNote } from "@/components/AllowanceNote";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { BreakdownContextSheet } from "@/components/BreakdownContextSheet";
import { BreakdownSheet } from "@/components/BreakdownSheet";
import { CompletedOverlay, type OverlayOrigin } from "@/components/CompletedOverlay";
import { FocusSoundPicker } from "@/components/FocusSoundPicker";
import { GemLogo } from "@/components/GemLogo";
import { AppIcon } from "@/components/icons/AppIcons";
import { StartSessionButton } from "@/components/StartSessionButton";
import { StuckCard } from "@/components/StuckCard";
import { useTabBarHeight } from "@/components/TabBar";
import { FocusClockFace } from "@/components/FocusClockFace";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from "react-native-svg";

import { MOTION } from "@/constants/theme";
import { useAiLocked } from "@/hooks/useAiLocked";
import { useRtlText } from "@/hooks/useRtlText";
import { useSessionCountdown } from "@/hooks/useSessionCountdown";
import { useTaskAiAssist } from "@/hooks/useTaskAiAssist";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import type { NextMove } from "@/lib/ai/suggestNextMove";
import { showAlert } from "@/lib/alert";
import { formatTaskLength } from "@/lib/formatDuration";
import { openPaywall } from "@/lib/paywall";
import { playSound } from "@/lib/sounds";
import { getDueInfo } from "@/lib/taskMeta";
import { sessionElapsedMs, useSessionStore, type ActiveSession } from "@/store/useSessionStore";
import { useTaskStore } from "@/store/useTaskStore";
import { withUndo } from "@/store/useUndoStore";
import type { StepDraft, Subtask, Task } from "@/types/task";

// A card on the stack is never shorter than the mockup's (Final-Today.html):
// a short title leaves air above the buttons rather than a stubby card. The
// stack sizes cards from the height their content reports; the card's shadow
// lives on the stack, not here — the card clips itself to the height it is
// given, and a clipping view on iOS cuts off its own shadow with it.
// A size down from the mockup's 252 (the user's call, 2026-11-03).
const CARD_MIN_HEIGHT = 196;

// How long the "task complete" overlay holds the card: in a session, before
// the session closes; in the stack, before the card is sent off. Long enough
// for the celebration to land, short enough not to be in the way.
export const CELEBRATION_MS = 1100;
// When the tick lands on the disc (see CompletedOverlay) — the second haptic.
const CHECK_LANDS_MS = 330;
const TODAY_CHECK_LANDS_MS = 1200;
// The stack's send-off after the celebration, plus a little air: the overlay
// stays on the card until it has flown out of sight.
const SEND_OFF_CLEAR_MS = CELEBRATION_MS + 700;

export type CardBounds = { x: number; y: number; width: number; height: number };

export type TodayDoneMotion = {
  started: SharedValue<number>;
  checkScale: SharedValue<number>;
  ringStarted: SharedValue<number>;
  ringProgress: SharedValue<number>;
  titleProgress: SharedValue<number>;
  fadeProgress: SharedValue<number>;
  cardSqueeze: SharedValue<number>;
  cardExit: SharedValue<number>;
  nextMove: SharedValue<number>;
  nextOpacity: SharedValue<number>;
};

type TodayTitleLine = TextLayoutEvent["nativeEvent"]["lines"][number];

function TodayTitleStrike({ line, progress }: { line: TodayTitleLine; progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    left: line.x,
    width: line.width * progress.get(),
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          top: line.y + line.height / 2 - 1.5,
          height: 3,
          borderRadius: 2,
          backgroundColor: "#F26A2E",
        },
        style,
      ]}
    />
  );
}

// A session's parts rising into place once its backdrop has opened: each
// fades up from a little below, a beat after the one before.
const SESSION_ENTER_MS = 460;
const SESSION_ENTER_STAGGER = 110;

function sessionEnter(order: number, reduceMotion: boolean) {
  if (reduceMotion) return FadeIn.duration(0);
  return FadeInUp.duration(SESSION_ENTER_MS)
    .delay(order * SESSION_ENTER_STAGGER)
    .easing(Easing.out(Easing.cubic));
}

// A step's box filling in, and the progress bar sliding along after it.
const STEP_TICK_MS = 160;
const STEP_PROGRESS_MS = 380;

/** A step's box: the orange fill and its tick pop in on the UI thread. */
function StepCheckbox({ done, current }: { done: boolean; current: boolean }) {
  const colors = useColors();
  const reduceMotion = useReducedMotion();
  const fill = useSharedValue(done ? 1 : 0);

  useEffect(() => {
    fill.set(withTiming(done ? 1 : 0, { duration: reduceMotion ? 0 : STEP_TICK_MS, easing: MOTION.easing.enter }));
  }, [done, fill, reduceMotion]);

  const fillStyle = useAnimatedStyle(() => ({
    opacity: fill.value,
    transform: [{ scale: 0.6 + 0.4 * fill.value }],
  }));

  return (
    <View className={current ? "h-5 w-5 rounded-md border-2 border-orange-500" : "h-5 w-5 rounded-md border-2 border-white/20"}>
      {/* Over the border too, so a ticked box is solid orange. */}
      <Animated.View
        className="absolute -left-[2px] -top-[2px] h-5 w-5 items-center justify-center rounded-md bg-orange-500"
        style={fillStyle}
      >
        <Feather name="check" size={12} color={colors.onAccent} />
      </Animated.View>
    </View>
  );
}

/** How much of the plan is done — a bar that slides to each new length. */
function StepsProgress({ fraction }: { fraction: number }) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(fraction);

  useEffect(() => {
    progress.set(withTiming(fraction, { duration: reduceMotion ? 0 : STEP_PROGRESS_MS, easing: MOTION.easing.enter }));
  }, [fraction, progress, reduceMotion]);

  const barStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  return (
    <View className="h-1.5 flex-row overflow-hidden rounded-full bg-white/10">
      <Animated.View className="rounded-full bg-orange-500" style={barStyle} />
    </View>
  );
}

/** The task's plan while a session runs on it — every step, each one tickable. */
function MicroStepsChecklist({
  task,
  onToggleStep,
  locked,
}: {
  task: Task;
  onToggleStep: (stepId: string) => void;
  /** The task is being celebrated as finished: a tap now would be drawn but never saved. */
  locked: boolean;
}) {
  const rtl = useRtlText();
  const steps = task.subtasks?.slice().sort((a, b) => a.order - b.order) ?? [];

  // A tap shows at once, here. Saving it re-renders the whole Next page, so
  // that waits until the tick has played, and each step goes back to the
  // store's word once the store agrees with the tap.
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const caughtUp = Object.keys(ticked).filter((id) => {
    const step = steps.find((entry) => entry.id === id);
    return !step || (step.status === "completed") === ticked[id];
  });
  if (caughtUp.length > 0) {
    setTicked((current) => {
      const next = { ...current };
      caughtUp.forEach((id) => delete next[id]);
      return next;
    });
  }

  const isDone = (step: Subtask) => ticked[step.id] ?? step.status === "completed";
  const doneCount = steps.filter(isDone).length;

  // The toggle each step still has waiting to be handed over. A second tap
  // before it goes undoes the first, so the two cancel out and nothing is
  // sent — otherwise ticking the last step and unticking it straight away
  // would start the task's celebration, and the untick would be dropped.
  const waiting = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const handlePress = (step: Subtask) => {
    if (locked) return;
    setTicked((current) => ({ ...current, [step.id]: !(current[step.id] ?? step.status === "completed") }));
    const earlier = waiting.current.get(step.id);
    if (earlier !== undefined) {
      clearTimeout(earlier);
      waiting.current.delete(step.id);
      return;
    }
    waiting.current.set(
      step.id,
      setTimeout(() => {
        waiting.current.delete(step.id);
        onToggleStep(step.id);
      }, STEP_TICK_MS),
    );
  };

  return (
    <View className="glass gap-3 rounded-[20px] p-4">
      <StepsProgress fraction={steps.length > 0 ? doneCount / steps.length : 0} />

      <View className="gap-2.5">
        {steps.map((step) => {
          const done = isDone(step);
          return (
            <AnimatedPressable
              key={step.id}
              onPress={() => handlePress(step)}
              accessibilityRole="checkbox"
              accessibilityLabel={step.label}
              accessibilityState={{ checked: done, disabled: locked }}
              className="flex-row items-center gap-3"
            >
              <StepCheckbox done={done} current={!done && step.status === "current"} />
              <Text
                numberOfLines={2}
                style={rtl}
                className={
                  done
                    ? "flex-1 font-grotesk-medium text-sm text-ink-charcoal-muted line-through"
                    : "flex-1 font-grotesk-medium text-sm text-ink-charcoal"
                }
              >
                {step.label}
              </Text>
            </AnimatedPressable>
          );
        })}
      </View>
    </View>
  );
}

/** The orange "✓ Done" pill (Final-Focus.html). */
function DonePill({ onPress, flex }: { onPress: () => void; flex: number }) {
  const t = useTranslation();
  return (
    <AnimatedPressable
      onPress={onPress}
      scaleTo={0.97}
      accessibilityRole="button"
      style={{ flex, height: 50, borderRadius: 25, backgroundColor: "#F26A2E", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}
    >
      <AppIcon name="check" size={16} strokeWidth={2.8} color="#FFFFFF" />
      <Text numberOfLines={1} style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 16, color: "#FFFFFF", includeFontPadding: false, textAlignVertical: "center", textAlign: "center", lineHeight: 20 }}>
        {t.common.done}
      </Text>
    </AnimatedPressable>
  );
}

/** A quiet text link under the session's buttons: Cancel session, End session. */
function QuietLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <AnimatedPressable onPress={onPress} scaleTo={0.97} accessibilityRole="button" style={{ height: 36, justifyContent: "center", paddingHorizontal: 8 }}>
      <Text style={{ fontFamily: "SpaceGrotesk-SemiBold", fontSize: 14, color: "#7A6E64" }}>{label}</Text>
    </AnimatedPressable>
  );
}

/**
 * The session's clock and its controls (Final-Focus.html) — or, for a task
 * with no duration, no clock at all (the user's call, 2026-10-09): a goal kept
 * up through the day isn't something to time.
 */
function SessionPanel({
  session,
  caption,
  onComplete,
}: {
  session: ActiveSession;
  /** "of 30 mins · Step 2: …", under the clock. */
  caption: string;
  onComplete: () => void;
}) {
  return session.plannedMinutes > 0 ? (
    <TimedSessionPanel session={session} caption={caption} onComplete={onComplete} />
  ) : (
    <UntimedSessionPanel onComplete={onComplete} />
  );
}

/** A session on a task with no duration: no timer, just finishing it — or leaving. */
function UntimedSessionPanel({ onComplete }: { onComplete: () => void }) {
  const t = useTranslation();
  const rtl = useRtlText();
  return (
    <View style={{ alignSelf: "stretch", alignItems: "center", gap: 14 }}>
      <Text style={[{ fontFamily: "SpaceGrotesk-Regular", fontSize: 15, lineHeight: 21, color: "#7A6E64", textAlign: "center" }, rtl]}>
        {t.session.noTimer}
      </Text>
      <View style={{ alignSelf: "stretch", flexDirection: "row" }}>
        <DonePill onPress={onComplete} flex={1} />
      </View>
    </View>
  );
}

/** The running clock of a session with a length: the ring and gem, then Pause · Done. */
function TimedSessionPanel({
  session,
  caption,
  onComplete,
}: {
  session: ActiveSession;
  caption: string;
  onComplete: () => void;
}) {
  const t = useTranslation();
  const countdown = useSessionCountdown(session);
  const pause = useSessionStore((state) => state.pause);
  const resume = useSessionStore((state) => state.resume);

  return (
    <View style={{ alignSelf: "stretch", alignItems: "center", gap: 10 }}>
      {/* The ring, the gem and the clock — and the "time's up" celebration.
          Keyed by the session, so a new one starts fresh. */}
      <FocusClockFace
        key={`${session.startedAt ?? ""}-${session.taskIds.join(",")}`}
        session={session}
        countdown={countdown}
        caption={caption}
      />

      <View style={{ alignSelf: "stretch", flexDirection: "row", gap: 10, marginTop: 4 }}>
        <AnimatedPressable
          onPress={countdown.isRunning ? pause : resume}
          scaleTo={0.97}
          accessibilityRole="button"
          accessibilityLabel={countdown.isRunning ? t.session.pauseA11y : t.session.resumeA11y}
          style={{ flex: 1, height: 50, borderRadius: 25, backgroundColor: "#221C17", alignItems: "center", justifyContent: "center" }}
        >
          <Text numberOfLines={1} style={{ fontFamily: "SpaceGrotesk-SemiBold", fontSize: 16, color: "#FFFFFF", includeFontPadding: false, textAlignVertical: "center", textAlign: "center", lineHeight: 20 }}>
            {countdown.isRunning ? t.session.pause : t.session.resume}
          </Text>
        </AnimatedPressable>
        <DonePill onPress={onComplete} flex={1.3} />
      </View>
    </View>
  );
}

/** One card of the Next page's stack — a task's essentials, a session button and the AI helpers. */
export function NextTaskCard({
  task,
  rank,
  preview = false,
  focusMode = false,
  style,
  contentStyle,
  todayDoneEnabled = false,
  todayDoneMotion,
  onMeasure,
  onBoundsChange,
  onStart,
  onComplete,
  onCelebrated,
  onDetails,
  onNavigate,
  onBack,
}: {
  /** Focus mode: back to Today, the session still running. */
  onBack?: () => void;
  task: Task;
  rank: number;
  /** The stack's Next (1) / Previous (-1), offered to screen readers in place of a swipe. */
  onNavigate?: (step: 1 | -1) => void;
  /** A card waiting in the stack — dimmed and not interactive. */
  preview?: boolean;
  /** The expanded card shown while its focus session is active. */
  focusMode?: boolean;
  /** The height the stack gives this card, as an animated style. */
  style?: AnimatedProps<ViewProps>["style"];
  /** How visible the card's content is — everything on it but its surface — as an animated style. */
  contentStyle?: AnimatedProps<ViewProps>["style"];
  /** Use the Today stack's one-shot task completion flow. */
  todayDoneEnabled?: boolean;
  /** The one-shot task-done animation used by the Today card stack. */
  todayDoneMotion?: TodayDoneMotion;
  /** The height this card's content wants, so the stack can size it. */
  onMeasure?: (height: number) => void;
  onBoundsChange?: (bounds: CardBounds) => void;
  onStart: (plannedMinutes: number, bounds?: CardBounds) => void;
  /**
   * The task was finished straight from the card, no session. The stack owns
   * its send-off and completes it once the next card is in place.
   */
  onComplete: () => void;
  /**
   * Focus mode: the task was finished in the session and its celebration has
   * played — time to close the session over it. The task itself is completed
   * right after, so that heavier update never lands on the celebration.
   */
  onCelebrated?: () => void;
  onDetails: () => void;
}) {
  const colors = useColors();
  const tabBarHeight = useTabBarHeight();
  const cardRef = useRef<ComponentRef<typeof View>>(null);
  const completeButtonRef = useRef<ComponentRef<typeof View>>(null);
  // Measured on Start: the session opens out of the button itself.
  const startButtonRef = useRef<ComponentRef<typeof View>>(null);
  const t = useTranslation();
  const rtl = useRtlText();
  const reduceMotion = useReducedMotion();
  const [todayTitleLines, setTodayTitleLines] = useState<TodayTitleLine[]>([]);
  const todayTitleStyle = useAnimatedStyle(() => ({
    opacity: 1 - 0.5 * (todayDoneMotion?.titleProgress.get() ?? 0),
  }));
  const todayFadeStyle = useAnimatedStyle(() => ({
    opacity: 1 - 0.65 * (todayDoneMotion?.fadeProgress.get() ?? 0),
  }));
  const todayCheckStyle = useAnimatedStyle(() => ({
    transform: [{ scale: todayDoneMotion?.checkScale.get() ?? 0 }],
  }));
  const todayRingStyle = useAnimatedStyle(() => {
    const started = todayDoneMotion?.ringStarted.get() ?? 0;
    const progress = todayDoneMotion?.ringProgress.get() ?? 0;
    return {
      opacity: started * (1 - progress),
      transform: [{ scale: 1 + 0.9 * progress }],
    };
  });
  const due = getDueInfo(task);
  const isOverdue = due.tone === "overdue";
  // Due today or tomorrow: the deadline reads in peach, as the one thing to notice.
  const dueSoon = due.tone === "today" || due.tone === "urgent";
  // The session's length: the task's own. A task with no duration gets a
  // session with no timer (SessionPanel).
  const plannedMinutes = Math.max(0, task.estimatedMinutes || 0);
  const completeStep = useTaskStore((state) => state.completeStep);
  const completeTask = useTaskStore((state) => state.completeTask);
  const setSteps = useTaskStore((state) => state.setSteps);
  const leaveSession = useSessionStore((state) => state.leave);

  // A session runs inside the card of the task it is for, so the timer stays
  // with everything else that task needs.
  const session = useSessionStore((state) => state.session);
  const liveSession = session?.taskIds.includes(task.id) ? session : undefined;
  const hasRunningSession = Boolean(liveSession);
  const previousSessionState = useRef(hasRunningSession);
  // Only a task with steps of its own, or ones AI Breakdown added (before the
  // session or during it), gets a checklist under its title.
  const hasSteps = (task.subtasks?.length ?? 0) > 0;

  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [breakdownMounted, setBreakdownMounted] = useState(false);
  // Bumped each time the sheet opens, so it always starts a fresh draft from
  // the task — even when reopened while the last one is still sliding away.
  const [breakdownKey, setBreakdownKey] = useState(0);
  const [breakdownAutoGenerate, setBreakdownAutoGenerate] = useState(false);
  const [breakdownClosingTask, setBreakdownClosingTask] = useState<Task | null>(null);
  const breakdownCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // "Break it down"'s first card, asking to see the task — mounted while open
  // and as it slides away.
  const [breakdownContextOpen, setBreakdownContextOpen] = useState(false);
  const [breakdownContextMounted, setBreakdownContextMounted] = useState(false);
  const breakdownContextTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // "I'm stuck"'s card, under the session's buttons — kept by task, as the
  // stack hands its mounted cards different tasks.
  const [stuckTaskId, setStuckTaskId] = useState<string | null>(null);
  const stuckOpen = stuckTaskId === task.id;
  const setStuckOpen = (open: boolean) => setStuckTaskId(open ? task.id : null);
  // Which task is being celebrated, rather than a plain flag: the stack keeps
  // a fixed set of cards mounted and rotates the tasks through them, so a card
  // can be handed a different task mid-celebration. The overlay belongs to the
  // task that earned it, not to this card.
  const [celebratedTaskId, setCelebratedTaskId] = useState<string | null>(null);
  // Where the green flood starts: the button that finished the task.
  const [celebrationOrigin, setCelebrationOrigin] = useState<OverlayOrigin | undefined>(undefined);
  const pendingCelebrationTaskIds = useRef(new Set<string>());
  const celebrating = celebratedTaskId === task.id;

  // A focus session that finished its task keeps its clock and controls on
  // screen while it closes: swapping them for the Start button under the
  // celebration was wasted work, right when the phone had the least to spare.
  const [heldSession, setHeldSession] = useState(liveSession);
  if (liveSession && liveSession !== heldSession) setHeldSession(liveSession);
  // The session itself — clock, steps, AI helpers — only ever shows in focus
  // mode, full screen. In the stack, a running session is just a way back
  // into it (Resume session): drawing the whole session in the card made it
  // grow very long, e.g. after the app was closed mid-session and reopened
  // (the session is saved, the full-screen view isn't).
  const runningSession = focusMode ? (liveSession ?? (celebrating ? heldSession : undefined)) : undefined;

  // Under the focus clock: "of 30 mins · Step 2: write the introduction" — the
  // first step not yet done, when the task has steps.
  const insets = useSafeAreaInsets();
  const orderedSteps = (task.subtasks ?? []).slice().sort((a, b) => a.order - b.order);
  const openStepIndex = orderedSteps.findIndex((step) => step.status !== "completed");
  const focusCaption =
    t.focusPage.ofLength(formatTaskLength(runningSession?.plannedMinutes ?? plannedMinutes)) +
    (openStepIndex >= 0 ? ` · ${t.focusPage.step(openStepIndex + 1, orderedSteps[openStepIndex].label)}` : "");

  useEffect(() => () => {
    if (breakdownCloseTimer.current) clearTimeout(breakdownCloseTimer.current);
    if (breakdownContextTimer.current) clearTimeout(breakdownContextTimer.current);
  }, []);

  const closeBreakdown = () => {
    if (!breakdownMounted) {
      setBreakdownOpen(false);
      return;
    }
    setBreakdownClosingTask(task);
    setBreakdownOpen(false);
    if (breakdownCloseTimer.current) clearTimeout(breakdownCloseTimer.current);
    breakdownCloseTimer.current = setTimeout(() => {
      setBreakdownMounted(false);
      setBreakdownClosingTask(null);
      breakdownCloseTimer.current = null;
    }, MOTION.duration.screen + 30);
  };

  /**
   * Finished in a session: the celebration plays first, and only then is the
   * task completed. Completing it re-renders the whole Next page (the queue
   * reshuffles, the session ends); doing that on the tap held the overlay's
   * first frames back and made it stutter. In focus mode the session starts
   * closing over the celebration (onCelebrated) just before the task is
   * completed, and the overlay fades out with it rather than vanishing.
   */
  const celebrate = (finish: () => void) => {
    const taskId = task.id;
    if (celebrating || pendingCelebrationTaskIds.current.has(taskId)) return;
    pendingCelebrationTaskIds.current.add(taskId);
    setCelebrationOrigin(undefined);
    setCelebratedTaskId(taskId);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    playSound("complete");
    setTimeout(() => {
      onCelebrated?.();
      // A turn later, so the close is already running on the UI thread.
      setTimeout(() => {
        try {
          finish();
          // Only this task's own session ends with it.
          if (useSessionStore.getState().session?.taskIds.includes(taskId)) leaveSession();
        } finally {
          pendingCelebrationTaskIds.current.delete(taskId);
          if (!onCelebrated) setCelebratedTaskId((current) => (current === taskId ? null : current));
        }
      }, 0);
    }, CELEBRATION_MS);
  };

  const handleComplete = () => celebrate(() => withUndo(t.undoToast.done(task.title), () => completeTask(task.id)));

  // The Today stack owns its tick and send-off; other views keep the existing
  // flood and side-swipe celebration.
  const handleQuickComplete = () => {
    if (celebrating || pendingCelebrationTaskIds.current.has(task.id)) return;
    if (todayDoneEnabled) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      const playCompletionFeedback = () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        playSound("complete");
      };
      if (reduceMotion) playCompletionFeedback();
      else setTimeout(playCompletionFeedback, TODAY_CHECK_LANDS_MS);
      onComplete();
      return;
    }

    const taskId = task.id;
    pendingCelebrationTaskIds.current.add(taskId);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    // A second, firmer tap as the tick lands on the disc.
    setTimeout(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      playSound("complete");
    }, CHECK_LANDS_MS);

    let begun = false;
    const begin = (origin?: OverlayOrigin) => {
      if (begun) return;
      begun = true;
      setCelebrationOrigin(origin);
      setCelebratedTaskId(taskId);
    };
    // Measuring is quick, but never worth a celebration that doesn't show:
    // if it hasn't answered almost at once, the flood starts from the middle.
    const fallback = setTimeout(() => begin(), 120);
    const card = cardRef.current;
    const button = completeButtonRef.current;
    if (card && button) {
      card.measureInWindow((cardX, cardY) => {
        button.measureInWindow((x, y, width, height) => {
          clearTimeout(fallback);
          begin({ x: x - cardX + width / 2, y: y - cardY + height / 2 });
        });
      });
    } else {
      clearTimeout(fallback);
      begin();
    }

    onComplete();
    setTimeout(() => {
      pendingCelebrationTaskIds.current.delete(taskId);
      setCelebratedTaskId((current) => (current === taskId ? null : current));
    }, SEND_OFF_CLEAR_MS);
  };

  // Ticking the last open step finishes the whole task (see completeStep), so
  // that tap gets the same send-off as the Complete button.
  const handleToggleStep = (stepId: string) => {
    if (pendingCelebrationTaskIds.current.has(task.id)) return;
    // Read fresh: the checklist hands its ticks over a moment after the tap,
    // possibly several in a row, each seeing the one before it.
    const steps = useTaskStore.getState().tasks.find((entry) => entry.id === task.id)?.subtasks ?? [];
    const finishesTask = steps.every((step) =>
      step.id === stepId ? step.status !== "completed" : step.status === "completed",
    );
    if (!finishesTask) {
      // A small tick for a step done — none for taking one back.
      if (steps.find((step) => step.id === stepId)?.status !== "completed") playSound("step");
      completeStep(task.id, stepId);
      return;
    }
    celebrate(() => withUndo(t.undoToast.done(task.title), () => completeStep(task.id, stepId)));
  };

  // Confirmed, because the clock is thrown away with the session and a stray
  // tap mid-focus would be the worst moment to lose it.
  const handleCancelSession = () => {
    showAlert(t.session.cancelTitle, t.session.cancelBody, [
      { text: t.session.keepGoing, style: "cancel" },
      { text: t.session.endSession, style: "destructive", onPress: leaveSession },
    ]);
  };

  const { breakdownStatus, regenerateBreakdown, cancelBreakdown } = useTaskAiAssist(
    task,
    plannedMinutes > 0 ? plannedMinutes : undefined,
  );
  // Free has no AI (lib/plan.ts): the session's AI buttons wear a padlock and
  // open the plans, so it's clear before the tap that they come with Pro.
  const aiLocked = useAiLocked();

  useEffect(() => {
    const sessionChanged = previousSessionState.current !== hasRunningSession;
    previousSessionState.current = hasRunningSession;
    if (!sessionChanged || preview || focusMode || !onBoundsChange) return;
    const timer = setTimeout(() => {
      cardRef.current?.measureInWindow((x, y, width, height) => onBoundsChange({ x, y, width, height }));
    }, MOTION.duration.standard + 20);
    return () => clearTimeout(timer);
  }, [focusMode, hasRunningSession, onBoundsChange, preview, task.id]);

  // Opened from "Break it down", after the context card: the user asked for
  // steps, so the AI drafts them as the sheet opens.
  const handleOpenBreakdown = () => {
    if (breakdownCloseTimer.current) clearTimeout(breakdownCloseTimer.current);
    breakdownCloseTimer.current = null;
    setBreakdownAutoGenerate(true);
    setBreakdownKey((key) => key + 1);
    setBreakdownMounted(true);
    setBreakdownClosingTask(null);
    setBreakdownOpen(true);
  };

  // "Break it down": first the card asking to see the task (a photo, a file,
  // a sentence) — then, once it has slid away, AI Breakdown.
  const handleOpenBreakdownContext = () => {
    if (breakdownContextTimer.current) clearTimeout(breakdownContextTimer.current);
    breakdownContextTimer.current = null;
    setBreakdownContextMounted(true);
    setBreakdownContextOpen(true);
  };

  const closeBreakdownContext = (then?: () => void) => {
    setBreakdownContextOpen(false);
    if (breakdownContextTimer.current) clearTimeout(breakdownContextTimer.current);
    breakdownContextTimer.current = setTimeout(() => {
      setBreakdownContextMounted(false);
      breakdownContextTimer.current = null;
      then?.();
    }, MOTION.duration.screen + 30);
  };

  // ✕, the scrim or Back: the draft is dropped, and so is a request still on its way.
  const handleDiscardBreakdown = () => {
    cancelBreakdown();
    closeBreakdown();
  };

  // "Confirm these steps": only now does anything reach the task. With every
  // step ticked that finishes it, so it gets the same send-off as Complete.
  const handleConfirmBreakdown = (steps: StepDraft[]) => {
    const finishes = steps.length > 0 && steps.every((step) => step.completed);
    closeBreakdown();
    if (finishes) celebrate(() => setSteps(task.id, steps));
    else setSteps(task.id, steps);
  };

  // "I'm stuck" → "Add as a step": the small action becomes the next step.
  // A task without steps gets two — that action, then the rest of the work —
  // so its length stays what it was rather than becoming the action's 3 minutes.
  const handleAddStuckStep = (idea: NextMove) => {
    const current = useTaskStore.getState().tasks.find((entry) => entry.id === task.id) ?? task;
    const newId = (index: number) => `subtask-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 6)}`;
    const step: StepDraft = { id: newId(0), label: idea.action, estimatedMinutes: idea.minutes, completed: false };
    const drafts: StepDraft[] = (current.subtasks ?? [])
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((subtask) => ({
        id: subtask.id,
        label: subtask.label,
        estimatedMinutes: subtask.estimatedMinutes,
        completed: subtask.status === "completed",
      }));
    if (drafts.length === 0) {
      const rest = Math.max(5, current.estimatedMinutes - idea.minutes);
      drafts.push(step, { id: newId(1), label: t.stuck.restStep, estimatedMinutes: rest, completed: false });
    } else {
      const firstOpen = drafts.findIndex((draft) => !draft.completed);
      drafts.splice(firstOpen < 0 ? drafts.length : firstOpen, 0, step);
    }
    setSteps(task.id, drafts);
    playSound("step");
  };

  const handleStart = () => {
    const begin = (bounds?: CardBounds) => onStart(plannedMinutes, bounds);
    const target = startButtonRef.current ?? cardRef.current;
    if (!target) {
      begin();
      return;
    }
    let measured = false;
    const fallback = setTimeout(() => {
      if (measured) return;
      measured = true;
      begin();
    }, 120);
    target.measureInWindow((x, y, width, height) => {
      if (measured) return;
      measured = true;
      clearTimeout(fallback);
      begin({ x, y, width, height });
    });
  };

  return (
    <Animated.View
      ref={cardRef}
      pointerEvents={preview ? "none" : "auto"}
      className={focusMode ? "flex-1" : "overflow-hidden rounded-[24px] bg-ink"}
      style={[style, focusMode ? { flex: 1 } : null]}
    >
      {/* Dimming and sizing a waiting card is the parent's job, so both can
          ease as that card moves up the stack. The content keeps the height it
          asks for and is clipped to whatever the card is given. */}
      {focusMode ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 6, paddingHorizontal: 20, paddingBottom: insets.bottom + 20 }}
          showsVerticalScrollIndicator={false}
        >
          {/* The warm light behind the ring (Final-Focus.html: 420 wide, 140 down). */}
          <View pointerEvents="none" style={{ position: "absolute", top: insets.top + 60, left: 0, right: 0, alignItems: "center" }}>
            <Svg width={420} height={420}>
              <Defs>
                <RadialGradient id="focusGlow" cx={210} cy={210} r={297} gradientUnits="userSpaceOnUse">
                  <Stop offset={0} stopColor="rgb(242,106,46)" stopOpacity={0.18} />
                  <Stop offset={0.65} stopColor="rgb(242,106,46)" stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Circle cx={210} cy={210} r={210} fill="url(#focusGlow)" />
            </Svg>
          </View>

          <Animated.View style={[{ alignItems: "center", gap: 10 }, contentStyle]}>
            {/* Back · FOCUS SESSION · the sound. Back leaves the page; the session keeps running. */}
            <Animated.View entering={sessionEnter(0, reduceMotion)} style={{ alignSelf: "stretch", flexDirection: "row", alignItems: "center" }}>
              <View style={{ flex: 1, alignItems: "flex-start" }}>
                {onBack ? (
                  <AnimatedPressable
                    onPress={onBack}
                    scaleTo={0.94}
                    accessibilityRole="button"
                    accessibilityLabel={t.focusPage.back}
                    style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: "#E2D6C8", backgroundColor: "#FCF7EF", alignItems: "center", justifyContent: "center" }}
                  >
                    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#221C17" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                      <Path d="M15 5l-7 7 7 7" />
                    </Svg>
                  </AnimatedPressable>
                ) : null}
              </View>
              <Text style={{ fontFamily: "SpaceMono-Bold", fontSize: 11, letterSpacing: 1.54, textTransform: "uppercase", color: "#7A6E64" }}>
                {t.focusPage.eyebrow}
              </Text>
              <View style={{ flex: 1, alignItems: "flex-end" }}>
                <FocusSoundPicker />
              </View>
            </Animated.View>

            {/* The title opens the task. */}
            <Animated.View entering={sessionEnter(0, reduceMotion)} style={{ alignSelf: "stretch", marginTop: 2 }}>
              <AnimatedPressable onPress={onDetails} scaleTo={0.99} accessibilityRole="button">
                <Text
                  numberOfLines={2}
                  style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 23, lineHeight: 28, letterSpacing: -0.46, color: "#221C17", textAlign: "center" }}
                >
                  {task.title}
                </Text>
              </AnimatedPressable>
            </Animated.View>

            {runningSession ? (
              <>
                <Animated.View entering={sessionEnter(1, reduceMotion)} style={{ alignSelf: "stretch", alignItems: "center" }}>
                  <SessionPanel session={runningSession} caption={focusCaption} onComplete={handleComplete} />
                </Animated.View>

                <Animated.View entering={sessionEnter(2, reduceMotion)} style={{ alignSelf: "stretch", alignItems: "center", gap: 4, marginTop: 22 }}>
                  {/* The AI's help (Pro): "Break it into steps" first asks to see
                      the task; "I'm stuck" gives one small thing to do now. */}
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
                    <AnimatedPressable
                      onPress={aiLocked ? () => openPaywall("assist") : handleOpenBreakdownContext}
                      scaleTo={0.97}
                      accessibilityRole="button"
                      accessibilityLabel={aiLocked ? `${t.focusPage.breakIntoSteps} — ${t.plan.proOnly}` : t.focusPage.breakIntoSteps}
                      style={{ height: 38, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6 }}
                    >
                      <Text style={{ fontFamily: "SpaceGrotesk-SemiBold", fontSize: 15, color: "#C4461A" }}>{t.focusPage.breakIntoSteps}</Text>
                      {aiLocked ? <Feather name="lock" size={12} color="#C4461A" /> : null}
                    </AnimatedPressable>
                    <Text style={{ fontFamily: "SpaceGrotesk-SemiBold", fontSize: 15, color: "#C9BDB2" }}>·</Text>
                    <AnimatedPressable
                      onPress={aiLocked ? () => openPaywall("assist") : () => setStuckOpen(!stuckOpen)}
                      scaleTo={0.97}
                      accessibilityRole="button"
                      accessibilityLabel={aiLocked ? `${t.session.stuck} — ${t.plan.proOnly}` : t.session.stuck}
                      accessibilityState={{ expanded: stuckOpen }}
                      style={{ height: 38, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6 }}
                    >
                      <Text style={{ fontFamily: "SpaceGrotesk-SemiBold", fontSize: 15, color: "#C4461A" }}>{t.session.stuck}</Text>
                      {aiLocked ? <Feather name="lock" size={12} color="#C4461A" /> : null}
                    </AnimatedPressable>
                  </View>

                  {/* "I'm stuck"'s idea, on the app's dark card. */}
                  {stuckOpen && !aiLocked ? (
                    <View style={{ alignSelf: "stretch", borderRadius: 24, backgroundColor: "#221C17", padding: 6 }}>
                      <StuckCard
                        task={task}
                        minutesInSession={Math.round(sessionElapsedMs(runningSession) / 60_000)}
                        onAddStep={plannedMinutes > 0 ? handleAddStuckStep : undefined}
                        onClose={() => setStuckOpen(false)}
                      />
                    </View>
                  ) : aiLocked ? null : (
                    <AllowanceNote meter="assist" />
                  )}

                  {/* The task's steps, each tickable, on the same dark card. */}
                  {hasSteps ? (
                    <View style={{ alignSelf: "stretch", borderRadius: 24, backgroundColor: "#221C17", padding: 6 }}>
                      <MicroStepsChecklist task={task} onToggleStep={handleToggleStep} locked={celebrating} />
                    </View>
                  ) : null}

                  {/* The way out without finishing: quieter than everything above it. */}
                  {runningSession.plannedMinutes > 0 ? (
                    <QuietLink label={t.session.cancelSession} onPress={handleCancelSession} />
                  ) : (
                    <QuietLink label={t.session.endSession} onPress={leaveSession} />
                  )}
                </Animated.View>
              </>
            ) : null}
          </Animated.View>
        </ScrollView>
      ) : (
      <ScrollView
        scrollEnabled={focusMode}
        nestedScrollEnabled={focusMode}
        style={focusMode ? { flex: 1 } : undefined}
        // In a focus session the glass pane's 8dp margin + 1dp edge + 11dp
        // padding keep its content 20dp in from the screen, as in the stack —
        // and its foot clear of the tab bar, which floats over the page.
        contentContainerStyle={
          focusMode
            ? { flexGrow: 1, padding: 8, paddingBottom: 32 + tabBarHeight }
            : // The buttons sit as far from the card's foot as from its sides (the user's call, 2026-11-03).
              { minHeight: CARD_MIN_HEIGHT, paddingTop: 16, paddingHorizontal: 16, paddingBottom: 16 }
        }
        onContentSizeChange={(_, height) => {
          if (!focusMode) onMeasure?.(height);
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* In a focus session the whole card becomes a pane of glass over the
            glowing backdrop; in the stack it's the card itself. */}
        {/* contentStyle: the stack fades a waiting card's content out, so it
            waits as a plain card, and back in once it's on top. */}
        <Animated.View
          className={focusMode ? "glass--soft gap-[18px] rounded-[24px] p-[11px]" : "grow"}
          style={contentStyle}
        >
        {/* In a session the parts rise in one after another — the task, its
            steps, then the clock — the app's fade-up entrance. */}
        <Animated.View entering={focusMode ? sessionEnter(0, reduceMotion) : undefined}>
          {focusMode ? (
            <>
              {/* Where the task sits in the queue, and its score — worth knowing,
                  but set in small glass pills so the timer stays the one orange thing. */}
              <View className="flex-row items-center justify-between gap-3">
                <View className="glass flex-row items-center gap-1.5 rounded-full py-0.5 pl-1.5 pr-2.5">
                  <Ionicons name={task.pinnedAt ? "bookmark" : "flame"} size={13} color={colors.ink.charcoalMuted} />
                  <Text className="font-grotesk-bold text-[13px] text-ink-charcoal">
                    {task.pinnedAt ? t.next.pinned : t.next.priorityRank(rank)}
                  </Text>
                </View>
                <View className="glass flex-row items-center gap-1.5 rounded-full px-2.5 py-0.5">
                  <GemLogo size={13} onDark />
                  <Text className="font-grotesk-semibold text-[13px] text-ink-charcoal">
                    {t.next.scoreLabel}
                    <Text className="font-grotesk-bold text-ink-charcoal">{task.priorityScore}</Text>
                  </Text>
                </View>
              </View>

              <AnimatedPressable onPress={onDetails} scaleTo={0.99} accessibilityRole="button" className="mt-3">
                <Text
                  numberOfLines={4}
                  style={rtl}
                  className="font-grotesk-bold text-[22px] leading-[26px] tracking-tight text-ink-charcoal"
                >
                  {task.title}
                </Text>
              </AnimatedPressable>

              {/* Deadline and length as glass chips; only an overdue deadline
                  gets a badge — solid red, white text — reading just "Overdue". */}
              <View className="mt-2.5 flex-row flex-wrap items-center gap-x-2 gap-y-2">
                <View
                  className={
                    isOverdue
                      ? "badge--overdue-solid flex-row items-center gap-1.5 rounded-[10px] px-2 py-1"
                      : "glass flex-row items-center gap-1.5 rounded-[10px] px-2 py-1"
                  }
                >
                  <Ionicons
                    name="calendar-clear-outline"
                    size={14}
                    color={isOverdue ? colors.onAccent : colors.ink.charcoalMuted}
                  />
                  <Text
                    className={
                      isOverdue
                        ? "font-grotesk-bold text-[13px] text-on-accent"
                        : due.tone === "muted"
                          ? "font-grotesk-medium text-[13px] text-ink-charcoal-muted"
                          : "font-grotesk-semibold text-[13px] text-ink-charcoal"
                    }
                  >
                    {isOverdue ? t.due.overdue : due.label}
                  </Text>
                </View>
                <View className="glass flex-row items-center gap-1.5 rounded-[10px] px-2 py-1">
                  <Ionicons name="time-outline" size={14} color={colors.ink.charcoalMuted} />
                  <Text className="font-grotesk-semibold text-[13px] text-ink-charcoal">{formatTaskLength(plannedMinutes)}</Text>
                </View>
              </View>
            </>
          ) : (
            <>
              {/* The 2026-11 redesign (Final-Today.html): "Do this first" for
                  the top task, its place in the queue for the rest. No XP pile
                  top-right yet — there's no XP system — so the title runs the
                  card's full width. */}
              <Animated.View style={todayDoneMotion ? todayFadeStyle : undefined} className="flex-row items-center">
                <View className="h-[24px] flex-row items-center gap-[5px] rounded-[12px] bg-accent/16 pl-[8px] pr-[10px]">
                  {task.pinnedAt ? (
                    <Ionicons name="bookmark" size={11} color={colors.palette.peachOnDark} />
                  ) : (
                    <AppIcon name="flame" size={12} color={colors.palette.peachOnDark} />
                  )}
                  <Text className="font-grotesk-semibold text-[11.5px] text-peach-on-dark">
                    {task.pinnedAt ? t.next.pinned : rank === 1 ? t.next.doThisFirst : t.next.priorityRank(rank)}
                  </Text>
                </View>
              </Animated.View>

              {/* The title opens the task. A screen reader gets the stack's
                  Next / Previous here too, in place of a swipe. */}
              <Animated.View style={todayDoneMotion ? todayTitleStyle : undefined}>
                <AnimatedPressable
                  onPress={onDetails}
                  scaleTo={0.99}
                  accessibilityRole="button"
                  accessibilityActions={
                    onNavigate
                      ? [
                          { name: "next", label: t.next.nextCard },
                          { name: "previous", label: t.next.previous },
                        ]
                      : undefined
                  }
                  onAccessibilityAction={(event) => onNavigate?.(event.nativeEvent.actionName === "previous" ? -1 : 1)}
                  className="mt-[14px]"
                >
                  <View style={{ position: "relative" }}>
                    <Text
                      numberOfLines={4}
                      onTextLayout={
                        todayDoneMotion
                          ? (event) => setTodayTitleLines(event.nativeEvent.lines)
                          : undefined
                      }
                      style={rtl}
                      className="font-grotesk-bold text-[23px] leading-[25px] tracking-[-0.46px] text-paper"
                    >
                      {task.title}
                    </Text>
                    {todayDoneMotion
                      ? todayTitleLines.map((line, index) => (
                          <TodayTitleStrike key={index} line={line} progress={todayDoneMotion.titleProgress} />
                        ))
                      : null}
                  </View>
                </AnimatedPressable>
              </Animated.View>

              {/* Due │ length │ score, on one line. A long due label gives way
                  (…) so the line never wraps. Red is for "Overdue" only. */}
              <Animated.View style={todayDoneMotion ? todayFadeStyle : undefined} className="mt-[11px] flex-row items-center gap-[8px]">
                {isOverdue ? (
                  <View className="h-[21px] shrink flex-row items-center gap-[4px] rounded-[11px] bg-alert px-[7px]">
                    <AppIcon name="calendar" size={12} strokeWidth={2} color="#FFFFFF" />
                    <Text numberOfLines={1} className="shrink font-grotesk-bold text-[11.5px] text-white">
                      {t.due.overdue}
                    </Text>
                  </View>
                ) : (
                  <View className="shrink flex-row items-center gap-[5px]">
                    <AppIcon name="calendar" size={14} strokeWidth={2} color={dueSoon ? colors.palette.peachOnDark : colors.palette.paperDim} />
                    <Text
                      numberOfLines={1}
                      className={`shrink font-grotesk-semibold text-[13px] ${dueSoon ? "text-peach-on-dark" : "text-paper-dim"}`}
                    >
                      {due.label}
                    </Text>
                  </View>
                )}
                <View className="h-[14px] w-[1.5px] bg-paper/20" />
                <View className="shrink-0 flex-row items-center gap-[5px]">
                  <AppIcon name="clock" size={14} strokeWidth={2} color={colors.palette.paperDim} />
                  <Text numberOfLines={1} className="font-grotesk-semibold text-[13px] text-paper-dim">
                    {formatTaskLength(plannedMinutes)}
                  </Text>
                </View>
                <View className="h-[14px] w-[1.5px] bg-paper/20" />
                <View className="shrink-0 flex-row items-center gap-[5px]">
                  <Text className="font-grotesk-medium text-[13px] text-paper-faint">{t.next.score}</Text>
                  <Text className="font-grotesk-semibold text-[13px] text-paper-dim">{task.priorityScore}</Text>
                </View>
              </Animated.View>
            </>
          )}
        </Animated.View>

        {runningSession && hasSteps ? (
          <Animated.View
            entering={
              focusMode
                ? sessionEnter(1, reduceMotion)
                : reduceMotion
                  ? FadeIn.duration(0)
                  : FadeIn.duration(MOTION.duration.standard)
            }
            exiting={reduceMotion ? FadeOut.duration(0) : FadeOut.duration(MOTION.duration.short)}
          >
            <MicroStepsChecklist task={task} onToggleStep={handleToggleStep} locked={celebrating} />
          </Animated.View>
        ) : null}

        <Animated.View
          key={runningSession ? "session-controls" : "start-controls"}
          entering={
            focusMode
              ? sessionEnter(hasSteps ? 2 : 1, reduceMotion)
              : reduceMotion
                ? FadeIn.duration(0)
                : FadeIn.duration(MOTION.duration.short)
          }
          exiting={reduceMotion ? FadeOut.duration(0) : FadeOut.duration(MOTION.duration.short)}
          // On the stack the buttons sit at the card's foot, however short
          // the title — the card is never shorter than the mockup's 252.
          className={focusMode ? "gap-[10px]" : "mt-auto gap-[10px] pt-[14px]"}
        >
          {runningSession ? (
            <>
              <SessionPanel session={runningSession} caption="" onComplete={handleComplete} />

              {/* Focus sounds (Pro): rain, brown noise or waves while the clock runs. */}
              <FocusSoundPicker />

              {/* The AI's help belongs to the session, where you're doing the
                  task. "Break it down" first asks to see what the task really
                  is — a photo, a file, a sentence said — so the steps fit the
                  actual work. "I'm stuck" gives one small thing to do right
                  now (2026-11-02). */}
              <View className="flex-row gap-2.5">
                <AnimatedPressable
                  onPress={aiLocked ? () => openPaywall("assist") : handleOpenBreakdownContext}
                  accessibilityRole="button"
                  accessibilityLabel={aiLocked ? `${t.breakdown.button} — ${t.plan.proOnly}` : t.breakdown.button}
                  className="glass min-h-[44px] flex-1 flex-row items-center justify-center gap-2 rounded-[14px] px-2.5 py-2"
                >
                  <Ionicons name="sparkles-outline" size={16} color={colors.ink.charcoal} />
                  <Text numberOfLines={1} className="shrink font-grotesk-semibold text-[14px] text-ink-charcoal">
                    {t.breakdown.button}
                  </Text>
                  {aiLocked ? <Feather name="lock" size={12} color={colors.ink.charcoalMuted} /> : null}
                </AnimatedPressable>
                <AnimatedPressable
                  onPress={aiLocked ? () => openPaywall("assist") : () => setStuckOpen(!stuckOpen)}
                  accessibilityRole="button"
                  accessibilityLabel={aiLocked ? `${t.session.stuck} — ${t.plan.proOnly}` : t.session.stuck}
                  accessibilityState={{ expanded: stuckOpen }}
                  className="glass min-h-[44px] flex-1 flex-row items-center justify-center gap-2 rounded-[14px] px-2.5 py-2"
                >
                  <Ionicons name="footsteps-outline" size={16} color={colors.ink.charcoal} />
                  <Text numberOfLines={1} className="shrink font-grotesk-semibold text-[14px] text-ink-charcoal">
                    {t.session.stuck}
                  </Text>
                  {aiLocked ? <Feather name="lock" size={12} color={colors.ink.charcoalMuted} /> : null}
                </AnimatedPressable>
              </View>
              {stuckOpen && !aiLocked ? (
                <StuckCard
                  task={task}
                  minutesInSession={Math.round(sessionElapsedMs(runningSession) / 60_000)}
                  onAddStep={plannedMinutes > 0 ? handleAddStuckStep : undefined}
                  onClose={() => setStuckOpen(false)}
                />
              ) : (
                <AllowanceNote meter="assist" onDark />
              )}
              {aiLocked ? (
                <Text className="text-center font-grotesk-medium text-[13px] text-ink-charcoal-muted" style={rtl}>
                  {t.plan.aiIsPro}
                </Text>
              ) : null}
            </>
          ) : (
            <View className="flex-row gap-[8px]">
              <Animated.View
                ref={startButtonRef}
                collapsable={false}
                style={todayDoneMotion ? todayFadeStyle : undefined}
                className="flex-1"
              >
                <StartSessionButton minutes={plannedMinutes} runningSession={liveSession} onPress={handleStart} />
              </Animated.View>

              {/* Already done, or done without the timer: finish it right here,
                  with the round tick beside Start. The wrapper is what's
                  measured, so the celebration can flood out of it. */}
              <View ref={completeButtonRef} collapsable={false}>
                <AnimatedPressable
                  onPress={handleQuickComplete}
                  scaleTo={0.92}
                  accessibilityRole="button"
                  accessibilityLabel={t.next.markComplete}
                  className="relative h-[44px] w-[44px] items-center justify-center rounded-full bg-accent/16"
                >
                  <AppIcon name="check" size={19} strokeWidth={3} color={colors.palette.peachOnDark} />
                  {todayDoneMotion ? (
                    <>
                      <Animated.View
                        pointerEvents="none"
                        style={[
                          {
                            position: "absolute",
                            top: -2,
                            right: -2,
                            bottom: -2,
                            left: -2,
                            borderRadius: 25,
                            borderWidth: 3,
                            borderColor: "#F26A2E",
                          },
                          todayRingStyle,
                        ]}
                      />
                      <Animated.View
                        pointerEvents="none"
                        style={[
                          {
                            position: "absolute",
                            top: 0,
                            right: 0,
                            bottom: 0,
                            left: 0,
                            borderRadius: 22,
                            backgroundColor: "#F26A2E",
                            alignItems: "center",
                            justifyContent: "center",
                          },
                          todayCheckStyle,
                        ]}
                      >
                        <AppIcon name="check" size={19} strokeWidth={3} color="#FFFFFF" />
                      </Animated.View>
                    </>
                  ) : null}
                </AnimatedPressable>
              </View>
            </View>
          )}
        </Animated.View>

        </Animated.View>
      </ScrollView>
      )}

      {celebrating ? <CompletedOverlay title={task.title} origin={celebrationOrigin} /> : null}

      {breakdownContextMounted && focusMode ? (
        <BreakdownContextSheet
          visible={breakdownContextOpen}
          task={task}
          onClose={() => closeBreakdownContext()}
          onContinue={() => closeBreakdownContext(handleOpenBreakdown)}
        />
      ) : null}

      {/* Mounted only while open — a Modal per card is expensive, and these
          cards are re-rendered on every swipe. */}
      {breakdownMounted && !preview ? (
        <BreakdownSheet
          key={breakdownKey}
          visible={breakdownOpen}
          task={breakdownOpen ? task : breakdownClosingTask ?? task}
          status={breakdownStatus}
          autoGenerate={breakdownAutoGenerate}
          onGenerate={regenerateBreakdown}
          onConfirm={handleConfirmBreakdown}
          onClose={handleDiscardBreakdown}
        />
      ) : null}
    </Animated.View>
  );
}
