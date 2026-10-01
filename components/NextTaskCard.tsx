import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, View, type ViewProps } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type AnimatedProps,
} from "react-native-reanimated";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { BreakdownSheet } from "@/components/BreakdownSheet";
import { CompletedOverlay, type OverlayOrigin } from "@/components/CompletedOverlay";
import { GemLogo } from "@/components/GemLogo";
import { HighlightedText } from "@/components/HighlightedText";
import { useTabBarHeight } from "@/components/TabBar";
import { TimerRing } from "@/components/TimerRing";
import { MOTION, gradients } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useSessionCountdown } from "@/hooks/useSessionCountdown";
import { useTaskAiAssist } from "@/hooks/useTaskAiAssist";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDuration } from "@/lib/formatDuration";
import { getDueInfo } from "@/lib/taskMeta";
import { useSessionStore, type ActiveSession } from "@/store/useSessionStore";
import { useTaskStore } from "@/store/useTaskStore";
import type { Subtask, Task } from "@/types/task";

// A task with no estimate still needs a timer length.
const FALLBACK_SESSION_MINUTES = 25;

// The hairline the card draws above and below its content — the stack sizes
// cards from the height their content reports, and this is what the card's own
// box adds on top of it. Its shadow lives on the stack, not here: the card
// clips itself to the height it is given, and a clipping view on iOS cuts off
// its own shadow with it.
const CARD_BORDERS = 2;

// How long the "task complete" overlay holds the card: in a session, before
// the session closes; in the stack, before the card is sent off. Long enough
// for the celebration to land, short enough not to be in the way.
export const CELEBRATION_MS = 1100;
// When the tick lands on the disc (see CompletedOverlay) — the second haptic.
const CHECK_LANDS_MS = 330;
// The stack's send-off after the celebration, plus a little air: the overlay
// stays on the card until it has flown out of sight.
const SEND_OFF_CLEAR_MS = CELEBRATION_MS + 700;

// The green Complete button's own glow, and the lift under the white play disc.
const COMPLETE_GLOW = { boxShadow: "0 8px 16px -8px rgba(40, 153, 90, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.18)" };
const PLAY_SHADOW = { boxShadow: "0 3px 8px -2px rgba(150, 50, 10, 0.45)" };

export type CardBounds = { x: number; y: number; width: number; height: number };

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
function MicroStepsChecklist({ task, onToggleStep }: { task: Task; onToggleStep: (stepId: string) => void }) {
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

  const handlePress = (step: Subtask) => {
    setTicked((current) => ({ ...current, [step.id]: !(current[step.id] ?? step.status === "completed") }));
    setTimeout(() => onToggleStep(step.id), STEP_TICK_MS);
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
              accessibilityState={{ checked: done }}
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

/** The running clock, in place of the "Start Session" button. */
function SessionPanel({
  session,
  onComplete,
  onCancel,
}: {
  session: ActiveSession;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const colors = useColors();
  const t = useTranslation();
  const countdown = useSessionCountdown(session);
  const pause = useSessionStore((state) => state.pause);
  const resume = useSessionStore((state) => state.resume);

  return (
    <View className="glass items-center gap-3 rounded-[22px] p-4">
      <TimerRing progress={countdown.progress} overtime={countdown.isOvertime}>
        {/* Shrinks to fit the ring once a long session shows hours too.
            Tabular digits, so the clock doesn't shift sideways as it ticks. */}
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          className="text-center font-grotesk-bold text-[44px] leading-[52px] tracking-tight"
          style={{
            width: 144,
            fontVariant: ["tabular-nums"],
            color: countdown.isOvertime ? colors.overdue[300] : colors.ink.charcoal,
          }}
        >
          {countdown.clock}
        </Text>
      </TimerRing>

      <View className="flex-row gap-2.5 self-stretch">
        <AnimatedPressable
          onPress={countdown.isRunning ? pause : resume}
          accessibilityRole="button"
          className="glass flex-1 flex-row items-center justify-center gap-2 rounded-[16px] px-2.5 py-3"
        >
          <Feather name={countdown.isRunning ? "pause" : "play"} size={16} color={colors.ink.charcoal} />
          <Text className="shrink font-grotesk-bold text-sm text-ink-charcoal">
            {countdown.isRunning ? t.session.pauseTimer : t.session.resumeTimer}
          </Text>
        </AnimatedPressable>
        <AnimatedPressable
          onPress={onComplete}
          accessibilityRole="button"
          className="flex-1 flex-row items-center justify-center gap-2 rounded-[16px] px-2.5 py-3"
          style={[{ backgroundColor: colors.success[500] }, gradients.success, COMPLETE_GLOW]}
        >
          <Feather name="check" size={16} color={colors.onAccent} />
          <Text className="shrink font-grotesk-bold text-sm text-on-accent">{t.session.complete}</Text>
        </AnimatedPressable>
      </View>

      {/* The way back out: a session you abandon leaves the task untouched, so
          this is quieter than the two actions above it. */}
      <AnimatedPressable
        onPress={onCancel}
        accessibilityRole="button"
        className="flex-row items-center justify-center gap-2 self-stretch rounded-full border border-white/15 px-2.5 py-2.5"
      >
        <Feather name="x" size={14} color={colors.ink.charcoalMuted} />
        <Text className="shrink font-grotesk-semibold text-sm text-ink-charcoal-muted">
          {t.session.cancelSession}
        </Text>
      </AnimatedPressable>
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
  onMeasure,
  onBoundsChange,
  onStart,
  onComplete,
  onCelebrated,
  onDetails,
}: {
  task: Task;
  rank: number;
  /** A card waiting in the stack — dimmed and not interactive. */
  preview?: boolean;
  /** The expanded card shown while its focus session is active. */
  focusMode?: boolean;
  /** The height the stack gives this card, as an animated style. */
  style?: AnimatedProps<ViewProps>["style"];
  /** How visible the card's content is — everything on it but its surface — as an animated style. */
  contentStyle?: AnimatedProps<ViewProps>["style"];
  /** The height this card's content wants, so the stack can size it. */
  onMeasure?: (height: number) => void;
  onBoundsChange?: (bounds: CardBounds) => void;
  onStart: (plannedMinutes: number, bounds?: CardBounds) => void;
  /**
   * The task was finished straight from the card, no session. Called as the
   * celebration starts: the stack holds the card through it, then sends it
   * off and completes the task (see NextTaskCardStack).
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
  const cardRef = useRef<View>(null);
  const completeButtonRef = useRef<View>(null);
  const t = useTranslation();
  const rtl = useRtlText();
  const reduceMotion = useReducedMotion();
  const due = getDueInfo(task);
  const isOverdue = due.tone === "overdue";
  const plannedMinutes = task.estimatedMinutes > 0 ? task.estimatedMinutes : FALLBACK_SESSION_MINUTES;
  const completeStep = useTaskStore((state) => state.completeStep);
  const completeTask = useTaskStore((state) => state.completeTask);
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
  const [breakdownClosingTask, setBreakdownClosingTask] = useState<Task | null>(null);
  const breakdownCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const runningSession = liveSession ?? (focusMode && celebrating ? heldSession : undefined);

  useEffect(() => () => {
    if (breakdownCloseTimer.current) clearTimeout(breakdownCloseTimer.current);
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

  const handleComplete = () => celebrate(() => completeTask(task.id));

  // Done without a session: the card floods green out of the button and
  // celebrates while the stack holds it, then the stack flies it off and only
  // then completes the task — so the queue never reshuffles under the finger.
  const handleQuickComplete = () => {
    if (celebrating || pendingCelebrationTaskIds.current.has(task.id)) return;
    const taskId = task.id;
    pendingCelebrationTaskIds.current.add(taskId);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    // A second, firmer tap as the tick lands on the disc.
    setTimeout(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
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
  // that tap gets the same send-off as the Complete button. Ticked from inside the
  // AI Breakdown sheet, the sheet gets out of the way so the card can show it.
  const handleToggleStep = (stepId: string) => {
    if (pendingCelebrationTaskIds.current.has(task.id)) return;
    // Read fresh: the checklist hands its ticks over a moment after the tap,
    // possibly several in a row, each seeing the one before it.
    const steps = useTaskStore.getState().tasks.find((entry) => entry.id === task.id)?.subtasks ?? [];
    const finishesTask = steps.every((step) =>
      step.id === stepId ? step.status !== "completed" : step.status === "completed",
    );
    if (!finishesTask) {
      completeStep(task.id, stepId);
      return;
    }
    closeBreakdown();
    celebrate(() => completeStep(task.id, stepId));
  };

  // Confirmed, because the clock is thrown away with the session and a stray
  // tap mid-focus would be the worst moment to lose it.
  const handleCancelSession = () => {
    Alert.alert(t.session.cancelTitle, t.session.cancelBody, [
      { text: t.session.keepGoing, style: "cancel" },
      { text: t.session.endSession, style: "destructive", onPress: leaveSession },
    ]);
  };

  const { advice, requestAdvice, dismissAdvice, breakdownStatus, regenerateBreakdown } = useTaskAiAssist(
    task,
    plannedMinutes,
  );
  const adviceShown = advice.status !== "idle";

  useEffect(() => {
    const sessionChanged = previousSessionState.current !== hasRunningSession;
    previousSessionState.current = hasRunningSession;
    if (!sessionChanged || preview || focusMode || !onBoundsChange) return;
    const timer = setTimeout(() => {
      cardRef.current?.measureInWindow((x, y, width, height) => onBoundsChange({ x, y, width, height }));
    }, MOTION.duration.standard + 20);
    return () => clearTimeout(timer);
  }, [focusMode, hasRunningSession, onBoundsChange, preview, task.id]);

  const handleOpenBreakdown = () => {
    if (breakdownCloseTimer.current) clearTimeout(breakdownCloseTimer.current);
    breakdownCloseTimer.current = null;
    setBreakdownMounted(true);
    setBreakdownClosingTask(null);
    setBreakdownOpen(true);
    // No steps yet — have the AI draft them right away.
    const hasUnfinishedSteps = (task.subtasks ?? []).some((subtask) => subtask.status !== "completed");
    if (!hasUnfinishedSteps && breakdownStatus !== "loading") regenerateBreakdown();
  };

  const handleStart = () => {
    const begin = (bounds?: CardBounds) => onStart(plannedMinutes, bounds);
    if (!cardRef.current) {
      begin();
      return;
    }
    let measured = false;
    const fallback = setTimeout(() => {
      if (measured) return;
      measured = true;
      begin();
    }, 120);
    cardRef.current.measureInWindow((x, y, width, height) => {
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
      className={focusMode ? "flex-1" : "overflow-hidden rounded-[28px] hairline-charcoal bg-charcoal-900"}
      style={[style, focusMode ? { flex: 1 } : gradients.charcoalCard]}
    >
      {/* Dimming and sizing a waiting card is the parent's job, so both can
          ease as that card moves up the stack. The content keeps the height it
          asks for and is clipped to whatever the card is given. */}
      <ScrollView
        scrollEnabled={focusMode}
        nestedScrollEnabled={focusMode}
        style={focusMode ? { flex: 1 } : undefined}
        // In a focus session the glass pane's 8dp margin + 1dp edge + 11dp
        // padding keep its content 20dp in from the screen, as in the stack —
        // and its foot clear of the tab bar, which floats over the page.
        contentContainerStyle={{
          flexGrow: focusMode ? 1 : undefined,
          padding: focusMode ? 8 : 20,
          paddingBottom: focusMode ? 32 + tabBarHeight : 20,
        }}
        onContentSizeChange={(_, height) => {
          if (!focusMode) onMeasure?.(height + CARD_BORDERS);
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* In a focus session the whole card becomes a pane of glass over the
            glowing backdrop; in the stack it's the card itself. */}
        {/* contentStyle: the stack fades a waiting card's content out, so it
            waits as a plain card, and back in once it's on top. */}
        <Animated.View
          className={focusMode ? "glass--soft gap-[18px] rounded-[24px] p-[11px]" : "gap-[18px]"}
          style={contentStyle}
        >
        <View>
          {/* Where the task sits in the queue, and its score — worth knowing,
              but set in small pills so the title wins. */}
          <View className="flex-row items-center justify-between gap-3">
            {/* Plain glass in a session, where the timer is the one orange thing. */}
            <View
              className={
                focusMode
                  ? "glass flex-row items-center gap-1.5 rounded-full py-0.5 pl-1.5 pr-2.5"
                  : "flex-row items-center gap-1.5 rounded-full py-0.5 pl-1.5 pr-2.5"
              }
              style={focusMode ? undefined : gradients.rankPill}
            >
              <Ionicons
                name={task.pinnedAt ? "bookmark" : "flame"}
                size={13}
                color={focusMode ? colors.ink.charcoalMuted : colors.orange[400]}
              />
              <Text className={focusMode ? "font-grotesk-bold text-[13px] text-ink-charcoal" : "font-grotesk-bold text-[13px] text-orange-300"}>
                {task.pinnedAt ? t.next.pinned : t.next.priorityRank(rank)}
              </Text>
            </View>
            <View className="glass flex-row items-center gap-1.5 rounded-full px-2.5 py-0.5">
              <GemLogo size={13} onDark />
              <Text className="font-grotesk-semibold text-[13px] text-ink-charcoal">
                {t.next.scoreLabel}
                <Text className={focusMode ? "font-grotesk-bold text-ink-charcoal" : "font-grotesk-bold text-orange-400"}>
                  {task.priorityScore}
                </Text>
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

          {/* Deadline and length — what decides whether this fits right now.
              In a session they become glass chips; only an overdue deadline
              gets a badge — solid red, white text — and reads simply
              "Overdue" however late it is, as on the Tasks page. */}
          <View className="mt-2.5 flex-row flex-wrap items-center gap-x-2 gap-y-2">
            <View
              className={
                isOverdue
                  ? "badge--overdue-solid flex-row items-center gap-1.5 rounded-[10px] px-2 py-1"
                  : focusMode
                    ? "glass flex-row items-center gap-1.5 rounded-[10px] px-2 py-1"
                    : "flex-row items-center gap-1.5"
              }
            >
              <Ionicons
                name="calendar-clear-outline"
                size={14}
                color={isOverdue ? colors.onAccent : focusMode ? colors.ink.charcoalMuted : colors.ink.charcoal}
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
            {focusMode ? null : <View className="h-[13px] w-px bg-white/20" />}
            <View
              className={
                focusMode ? "glass flex-row items-center gap-1.5 rounded-[10px] px-2 py-1" : "flex-row items-center gap-1.5"
              }
            >
              <Ionicons name="time-outline" size={14} color={focusMode ? colors.ink.charcoalMuted : colors.ink.charcoal} />
              <Text className="font-grotesk-semibold text-[13px] text-ink-charcoal">{formatDuration(plannedMinutes)}</Text>
            </View>
          </View>

        </View>

        {runningSession && hasSteps ? (
          <Animated.View
            entering={reduceMotion ? FadeIn.duration(0) : FadeIn.duration(MOTION.duration.standard)}
            exiting={reduceMotion ? FadeOut.duration(0) : FadeOut.duration(MOTION.duration.short)}
          >
            <MicroStepsChecklist task={task} onToggleStep={handleToggleStep} />
          </Animated.View>
        ) : null}

        <Animated.View
          key={runningSession ? "session-controls" : "start-controls"}
          entering={reduceMotion ? FadeIn.duration(0) : FadeIn.duration(MOTION.duration.short)}
          exiting={reduceMotion ? FadeOut.duration(0) : FadeOut.duration(MOTION.duration.short)}
          className="gap-[10px]"
        >
          {runningSession ? (
            <>
              <SessionPanel session={runningSession} onComplete={handleComplete} onCancel={handleCancelSession} />

              {/* The AI helpers belong to the session: breaking the task down
                  and asking how to go about it are for when you're doing it.
                  A plain pane of glass each. */}
              <View className="flex-row gap-[10px]">
                <AnimatedPressable
                  onPress={handleOpenBreakdown}
                  accessibilityRole="button"
                  accessibilityLabel={t.session.aiBreakdown}
                  className="glass min-h-[40px] flex-1 flex-row items-center justify-center gap-2 rounded-[14px] px-3 py-2"
                >
                  <Ionicons name="list-outline" size={16} color={colors.ink.charcoal} />
                  <Text className="shrink font-grotesk-semibold text-[13px] text-ink-charcoal">{t.next.breakDown}</Text>
                </AnimatedPressable>
                <AnimatedPressable
                  onPress={adviceShown ? dismissAdvice : requestAdvice}
                  accessibilityRole="button"
                  accessibilityLabel={t.session.aiAdvice}
                  accessibilityState={{ selected: adviceShown }}
                  className={
                    adviceShown
                      ? "min-h-[40px] flex-1 flex-row items-center justify-center gap-2 rounded-[14px] border border-orange-500/40 bg-orange-500/15 px-3 py-2"
                      : "glass min-h-[40px] flex-1 flex-row items-center justify-center gap-2 rounded-[14px] px-3 py-2"
                  }
                >
                  <Ionicons name="bulb-outline" size={15} color={colors.ink.charcoal} />
                  <Text className="shrink font-grotesk-semibold text-[13px] text-ink-charcoal">{t.next.getAdvice}</Text>
                </AnimatedPressable>
              </View>
            </>
          ) : (
            <>
              <AnimatedPressable
                onPress={handleStart}
                accessibilityRole="button"
                accessibilityLabel={t.next.startSessionFor(formatDuration(plannedMinutes))}
                style={gradients.accent}
                className="glow-accent min-h-[44px] flex-row items-center justify-center gap-3 rounded-[16px] bg-orange-500 px-4 py-1.5"
              >
                <View className="h-[28px] w-[28px] items-center justify-center rounded-full bg-white" style={PLAY_SHADOW}>
                  {/* Nudged right: a triangle's visual centre sits left of its box. */}
                  <Ionicons name="play" size={13} color={colors.orange[500]} style={{ marginLeft: 2 }} />
                </View>
                <Text style={rtl} className="font-grotesk-bold text-[15px] text-on-accent">
                  {t.next.startSessionLabel}
                </Text>
              </AnimatedPressable>

              {/* Already done, or done without the timer: finish it right here.
                  Tinted green, like the session's own Complete button, but
                  quieter than Start. The wrapper is what's measured, so the
                  celebration can flood out of it. */}
              <View ref={completeButtonRef} collapsable={false}>
                <AnimatedPressable
                  onPress={handleQuickComplete}
                  scaleTo={0.97}
                  accessibilityRole="button"
                  className="min-h-[42px] flex-row items-center justify-center gap-2 rounded-[14px] border border-success-300/35 bg-success-500/25 px-3 py-2"
                >
                  <Feather name="check" size={16} color={colors.success[300]} />
                  <Text style={rtl} className="shrink font-grotesk-bold text-[14px] text-success-300">
                    {t.next.markComplete}
                  </Text>
                </AnimatedPressable>
              </View>
            </>
          )}
        </Animated.View>

        {/* Advice is asked for during a session, and goes with it. */}
        {adviceShown && runningSession ? (
          <Animated.View entering={FadeIn.duration(220)} className="gap-2 rounded-[20px] border border-orange-500/30 bg-white/5 p-4">
            {advice.status === "loading" ? (
              <View className="flex-row items-center gap-2.5">
                <ActivityIndicator size="small" color={colors.orange[500]} />
                <Text className="font-grotesk-medium text-[15px] text-ink-charcoal-muted">{t.session.readingTask}</Text>
              </View>
            ) : null}
            {advice.status === "error" ? (
              <Text className="font-grotesk-medium text-[15px] text-ink-charcoal-muted" style={rtl}>
                {t.common.aiUnreachable}
              </Text>
            ) : null}
            {advice.status === "ready" ? (
              <>
                {advice.data.headline ? (
                  <HighlightedText
                    text={advice.data.headline}
                    className="font-grotesk-semibold text-[15px] leading-6 text-ink-charcoal"
                    highlightClassName="font-grotesk-bold text-orange-500"
                  />
                ) : null}
                {advice.data.detail ? (
                  <HighlightedText
                    text={advice.data.detail}
                    className="font-grotesk-regular text-[15px] leading-6 text-ink-charcoal/80"
                    highlightClassName="font-grotesk-bold text-orange-500"
                  />
                ) : null}
              </>
            ) : null}
          </Animated.View>
        ) : null}
        </Animated.View>
      </ScrollView>

      {celebrating ? <CompletedOverlay title={task.title} origin={celebrationOrigin} /> : null}

      {/* Mounted only while open — a Modal per card is expensive, and these
          cards are re-rendered on every swipe. */}
      {breakdownMounted && !preview ? (
        <BreakdownSheet
          visible={breakdownOpen}
          task={breakdownOpen ? task : breakdownClosingTask ?? task}
          status={breakdownStatus}
          onRegenerate={regenerateBreakdown}
          onToggleStep={handleToggleStep}
          onClose={closeBreakdown}
        />
      ) : null}
    </Animated.View>
  );
}
