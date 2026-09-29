import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, View, type ViewProps } from "react-native";
import Animated, { FadeIn, FadeOut, ZoomIn, useReducedMotion, type AnimatedProps } from "react-native-reanimated";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { BreakdownSheet } from "@/components/BreakdownSheet";
import { GemLogo } from "@/components/GemLogo";
import { HighlightedText } from "@/components/HighlightedText";
import { MOTION } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useSessionCountdown } from "@/hooks/useSessionCountdown";
import { useTaskAiAssist } from "@/hooks/useTaskAiAssist";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDuration } from "@/lib/formatDuration";
import { getDueInfo } from "@/lib/taskMeta";
import { useSessionStore, type ActiveSession } from "@/store/useSessionStore";
import { useTaskStore } from "@/store/useTaskStore";
import type { Task } from "@/types/task";

// A task with no estimate still needs a timer length.
const FALLBACK_SESSION_MINUTES = 25;

// The hairline the card draws above and below its content — the stack sizes
// cards from the height their content reports, and this is what the card's own
// box adds on top of it. Its shadow lives on the stack, not here: the card
// clips itself to the height it is given, and a clipping view on iOS cuts off
// its own shadow with it.
const CARD_BORDERS = 2;

// How long the "task complete" overlay holds the card before the task is
// actually marked done. Long enough to land, short enough not to be in the way.
const CELEBRATION_MS = 1100;

export type CardBounds = { x: number; y: number; width: number; height: number };

/** The task's plan while a session runs on it — every step, each one tickable. */
function MicroStepsChecklist({ task, onToggleStep }: { task: Task; onToggleStep: (stepId: string) => void }) {
  const colors = useColors();
  const rtl = useRtlText();
  const steps = task.subtasks?.slice().sort((a, b) => a.order - b.order) ?? [];
  const doneCount = steps.filter((step) => step.status === "completed").length;

  return (
    <View className="gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
      {/* Flex ratios rather than a percentage width — RN takes fractional flex directly. */}
      <View className="h-1.5 flex-row overflow-hidden rounded-full bg-white/10">
        <View className="rounded-full bg-orange-500" style={{ flex: doneCount }} />
        <View style={{ flex: steps.length - doneCount }} />
      </View>

      <View className="gap-2.5">
        {steps.map((step) => {
          const done = step.status === "completed";
          return (
            <AnimatedPressable
              key={step.id}
              onPress={() => onToggleStep(step.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: done }}
              className="flex-row items-center gap-3"
            >
              <View
                className={
                  done
                    ? "h-5 w-5 items-center justify-center rounded-md bg-orange-500"
                    : step.status === "current"
                      ? "h-5 w-5 rounded-md border-2 border-orange-500"
                      : "h-5 w-5 rounded-md border-2 border-white/20"
                }
              >
                {done ? <Feather name="check" size={12} color={colors.onAccent} /> : null}
              </View>
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
    <View className="gap-3 rounded-2xl border border-white/10 bg-black/40 p-4">
      <Text
        className="text-center font-grotesk-bold text-[44px] leading-[52px] tracking-tight"
        style={{ color: countdown.isOvertime ? colors.orange[500] : colors.ink.charcoal }}
      >
        {countdown.clock}
      </Text>

      <View className="h-1 flex-row overflow-hidden rounded-full bg-white/10">
        <View className="rounded-full bg-orange-500" style={{ flex: countdown.progress }} />
        <View style={{ flex: 1 - countdown.progress }} />
      </View>

      <View className="flex-row gap-2.5">
        <AnimatedPressable
          onPress={countdown.isRunning ? pause : resume}
          accessibilityRole="button"
          className="flex-1 flex-row items-center justify-center gap-2 rounded-[16px] bg-white/10 px-2.5 py-3"
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
          style={{ backgroundColor: colors.success[500] }}
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
        className="flex-row items-center justify-center gap-2 rounded-[16px] border border-white/10 px-2.5 py-2.5"
      >
        <Feather name="x" size={14} color={colors.ink.charcoalMuted} />
        <Text className="shrink font-grotesk-semibold text-sm text-ink-charcoal-muted">
          {t.session.cancelSession}
        </Text>
      </AnimatedPressable>
    </View>
  );
}

/**
 * What the card becomes for a moment once its task is finished. A completed
 * task drops straight out of the Next queue, so without this the card would
 * simply vanish under the finger that finished it — this is the beat that
 * says "that one's done" before the next task slides in.
 */
function CompletedOverlay({ title }: { title: string }) {
  const colors = useColors();
  const t = useTranslation();
  const rtl = useRtlText();
  const reduceMotion = useReducedMotion();

  return (
    <Animated.View
      entering={FadeIn.duration(MOTION.duration.short)}
      accessibilityLiveRegion="polite"
      className="absolute bottom-0 left-0 right-0 top-0 items-center justify-center gap-4 bg-charcoal-900 px-8"
    >
      <Animated.View
        entering={reduceMotion ? ZoomIn.duration(0) : ZoomIn.springify().damping(11).stiffness(150)}
        className="h-20 w-20 items-center justify-center rounded-full"
        style={{ backgroundColor: colors.success[500] }}
      >
        <Feather name="check" size={38} color={colors.onAccent} />
      </Animated.View>

      <Animated.View
        entering={reduceMotion ? FadeIn.duration(0) : FadeIn.delay(MOTION.duration.short).duration(MOTION.duration.standard)}
        className="items-center gap-1.5"
      >
        <Text className="font-grotesk-bold text-[22px] tracking-tight text-ink-charcoal">{t.next.taskComplete}</Text>
        <Text
          numberOfLines={2}
          style={rtl}
          className="text-center font-grotesk-medium text-sm text-ink-charcoal-muted"
        >
          {title}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

/** One card of the Next page's stack — a task's essentials, a session button and the AI helpers. */
export function NextTaskCard({
  task,
  rank,
  preview = false,
  focusMode = false,
  style,
  onMeasure,
  onBoundsChange,
  onStart,
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
  /** The height this card's content wants, so the stack can size it. */
  onMeasure?: (height: number) => void;
  onBoundsChange?: (bounds: CardBounds) => void;
  onStart: (plannedMinutes: number, bounds?: CardBounds) => void;
  onDetails: () => void;
}) {
  const colors = useColors();
  const cardRef = useRef<View>(null);
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
  const runningSession = session?.taskIds.includes(task.id) ? session : undefined;
  const hasRunningSession = Boolean(runningSession);
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
  const pendingCelebrationTaskIds = useRef(new Set<string>());
  const celebrating = celebratedTaskId === task.id;

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

  /** Update task state immediately while the focus card holds its brief completion response. */
  const celebrate = (finish: () => void) => {
    if (celebrating || pendingCelebrationTaskIds.current.has(task.id)) return;
    pendingCelebrationTaskIds.current.add(task.id);
    setCelebratedTaskId(task.id);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    finish();
    setTimeout(() => {
      try {
        // Only this task's own session ends with it — by now the user could
        // have swiped on and started another one.
        if (useSessionStore.getState().session?.taskIds.includes(task.id)) leaveSession();
      } finally {
        pendingCelebrationTaskIds.current.delete(task.id);
        setCelebratedTaskId((current) => (current === task.id ? null : current));
      }
    }, CELEBRATION_MS);
  };

  const handleComplete = () => celebrate(() => completeTask(task.id));

  // Ticking the last open step finishes the whole task (see completeStep), so
  // that tap gets the same send-off as the Complete button. Ticked from inside the
  // AI Breakdown sheet, the sheet gets out of the way so the card can show it.
  const handleToggleStep = (stepId: string) => {
    const steps = task.subtasks ?? [];
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
      className={focusMode ? "flex-1" : "overflow-hidden rounded-[24px] hairline-charcoal bg-charcoal-900"}
      style={[style, focusMode ? { flex: 1 } : undefined]}
    >
      {/* Dimming and sizing a waiting card is the parent's job, so both can
          ease as that card moves up the stack. The content keeps the height it
          asks for and is clipped to whatever the card is given. */}
      <ScrollView
        scrollEnabled={focusMode}
        nestedScrollEnabled={focusMode}
        style={focusMode ? { flex: 1 } : undefined}
        contentContainerStyle={{ flexGrow: focusMode ? 1 : undefined, gap: 18, padding: 20, paddingBottom: focusMode ? 32 : 20 }}
        onContentSizeChange={(_, height) => {
          if (!focusMode) onMeasure?.(height + CARD_BORDERS);
        }}
        showsVerticalScrollIndicator={false}
      >
        <View>
          {/* Where the task sits in the queue — worth knowing, but it stays
              quieter than the title and the deadline under it. */}
          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-row items-center gap-1.5">
              <Ionicons name={task.pinnedAt ? "bookmark" : "flame"} size={13} color={colors.orange[500]} />
              <Text className="font-grotesk-semibold text-[13px] text-ink-charcoal-muted">
                {task.pinnedAt ? t.next.pinned : t.next.priorityRank(rank)}
              </Text>
            </View>
            <View className="flex-row items-center gap-1.5">
              <GemLogo size={13} onDark />
              <Text className="font-grotesk-semibold text-[13px] text-ink-charcoal-muted">
                {t.tasks.score(task.priorityScore)}
              </Text>
            </View>
          </View>

          <AnimatedPressable onPress={onDetails} scaleTo={0.99} accessibilityRole="button" className="mt-3">
            <Text
              numberOfLines={4}
              style={rtl}
              className="font-grotesk-semibold text-[22px] leading-[26px] tracking-tight text-ink-charcoal"
            >
              {task.title}
            </Text>
          </AnimatedPressable>

          {/* Deadline and length — what decides whether this fits right now.
              Plain icon + text; only an overdue deadline earns a tint. */}
          <View className="mt-2.5 flex-row flex-wrap items-center gap-x-4 gap-y-2">
            {isOverdue ? (
              <View className="flex-row items-center gap-1.5 rounded-lg bg-overdue-500/20 px-2 py-1">
                <Ionicons name="calendar-clear-outline" size={14} color={colors.overdue[300]} />
                <Text className="font-grotesk-semibold text-[13px] text-overdue-300">{due.pillLabel}</Text>
              </View>
            ) : (
              <View className="flex-row items-center gap-1.5">
                <Ionicons name="calendar-clear-outline" size={14} color={colors.ink.charcoalMuted} />
                <Text
                  className={
                    due.tone === "muted"
                      ? "font-grotesk-medium text-[13px] text-ink-charcoal-muted"
                      : "font-grotesk-medium text-[13px] text-ink-charcoal"
                  }
                >
                  {due.label}
                </Text>
              </View>
            )}
            <View className="flex-row items-center gap-1.5">
              <Ionicons name="time-outline" size={14} color={colors.ink.charcoalMuted} />
              <Text className="font-grotesk-medium text-[13px] text-ink-charcoal">{formatDuration(plannedMinutes)}</Text>
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

        <View className="gap-[10px]">
          <Animated.View
            key={runningSession ? "session-controls" : "start-controls"}
            entering={reduceMotion ? FadeIn.duration(0) : FadeIn.duration(MOTION.duration.short)}
            exiting={reduceMotion ? FadeOut.duration(0) : FadeOut.duration(MOTION.duration.short)}
          >
            {runningSession ? (
              <SessionPanel session={runningSession} onComplete={handleComplete} onCancel={handleCancelSession} />
            ) : (
              <AnimatedPressable
                onPress={handleStart}
                accessibilityRole="button"
                accessibilityLabel={t.next.startSessionFor(formatDuration(plannedMinutes))}
                className="min-h-[44px] flex-row items-center justify-center gap-3 rounded-[14px] bg-orange-500 px-4 py-1.5"
              >
                <View className="h-[28px] w-[28px] items-center justify-center rounded-full bg-white/20">
                  {/* Nudged right: a triangle's visual centre sits left of its box. */}
                  <Ionicons name="play" size={13} color={colors.onAccent} style={{ marginLeft: 2 }} />
                </View>
                <Text style={rtl} className="font-grotesk-bold text-[15px] text-on-accent">
                  {t.next.startSessionLabel}
                </Text>
              </AnimatedPressable>
            )}
          </Animated.View>

          {/* The AI helpers — one quiet surface each, orange only on the icon. */}
          <View className="flex-row gap-[10px]">
            <AnimatedPressable
              onPress={handleOpenBreakdown}
              accessibilityRole="button"
              accessibilityLabel={t.session.aiBreakdown}
              className="min-h-[40px] flex-1 flex-row items-center justify-center gap-2 rounded-[12px] bg-white/10 px-3 py-2"
            >
              <Ionicons name="list-outline" size={16} color={colors.orange[500]} />
              <Text className="shrink font-grotesk-semibold text-[13px] text-ink-charcoal">{t.next.breakDown}</Text>
            </AnimatedPressable>
            <AnimatedPressable
              onPress={adviceShown ? dismissAdvice : requestAdvice}
              accessibilityRole="button"
              accessibilityLabel={t.session.aiAdvice}
              accessibilityState={{ selected: adviceShown }}
              className={
                adviceShown
                  ? "min-h-[40px] flex-1 flex-row items-center justify-center gap-2 rounded-[12px] bg-orange-500/15 px-3 py-2"
                  : "min-h-[40px] flex-1 flex-row items-center justify-center gap-2 rounded-[12px] bg-white/10 px-3 py-2"
              }
            >
              <Ionicons name="bulb-outline" size={15} color={colors.orange[500]} />
              <Text className="shrink font-grotesk-semibold text-[13px] text-ink-charcoal">{t.next.getAdvice}</Text>
            </AnimatedPressable>
          </View>
        </View>

        {adviceShown ? (
          <Animated.View entering={FadeIn.duration(220)} className="gap-2 rounded-2xl border border-orange-500/25 bg-white/5 p-4">
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
      </ScrollView>

      {celebrating ? <CompletedOverlay title={task.title} /> : null}

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
