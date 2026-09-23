import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Platform, Text, View, type ViewProps } from "react-native";
import Animated, { FadeIn, ZoomIn, type AnimatedProps } from "react-native-reanimated";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { BreakdownSheet } from "@/components/BreakdownSheet";
import { GemLogo } from "@/components/GemLogo";
import { HighlightedText } from "@/components/HighlightedText";
import { colors } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useSessionCountdown } from "@/hooks/useSessionCountdown";
import { useTaskAiAssist } from "@/hooks/useTaskAiAssist";
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

const START_BUTTON_GLOW = Platform.select({
  ios: { shadowColor: colors.orange[500], shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.45, shadowRadius: 16 },
});

/** The task's plan while a session runs on it — every step, each one tickable. */
function MicroStepsChecklist({ task, onToggleStep }: { task: Task; onToggleStep: (stepId: string) => void }) {
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
                {done ? <Feather name="check" size={12} color={colors.cream[50]} /> : null}
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
          <Feather name="check" size={16} color={colors.cream[50]} />
          <Text className="shrink font-grotesk-bold text-sm text-cream-50">{t.session.complete}</Text>
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
  const t = useTranslation();
  const rtl = useRtlText();

  return (
    <Animated.View
      entering={FadeIn.duration(160)}
      accessibilityLiveRegion="polite"
      className="absolute bottom-0 left-0 right-0 top-0 items-center justify-center gap-4 bg-charcoal-900 px-8"
    >
      <Animated.View
        entering={ZoomIn.springify().damping(11).stiffness(150)}
        className="h-20 w-20 items-center justify-center rounded-full"
        style={{ backgroundColor: colors.success[500] }}
      >
        <Feather name="check" size={38} color={colors.cream[50]} />
      </Animated.View>

      <Animated.View entering={FadeIn.delay(150).duration(260)} className="items-center gap-1.5">
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
  style,
  onMeasure,
  onStart,
  onDetails,
}: {
  task: Task;
  rank: number;
  /** A card waiting in the stack — dimmed and not interactive. */
  preview?: boolean;
  /** The height the stack gives this card, as an animated style. */
  style?: AnimatedProps<ViewProps>["style"];
  /** The height this card's content wants, so the stack can size it. */
  onMeasure?: (height: number) => void;
  onStart: (plannedMinutes: number) => void;
  onDetails: () => void;
}) {
  const t = useTranslation();
  const rtl = useRtlText();
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
  const hasSteps = (task.subtasks?.length ?? 0) > 0;

  const [breakdownOpen, setBreakdownOpen] = useState(false);
  // Which task is being celebrated, rather than a plain flag: the stack keeps
  // a fixed set of cards mounted and rotates the tasks through them, so a card
  // can be handed a different task mid-celebration. The overlay belongs to the
  // task that earned it, not to this card.
  const [celebratedTaskId, setCelebratedTaskId] = useState<string | null>(null);
  const pendingCelebrationTaskIds = useRef(new Set<string>());
  const celebrating = celebratedTaskId === task.id;

  /**
   * Plays the completion overlay, then applies the change. It has to be this
   * way round: the moment the task counts as completed it leaves the Next
   * queue and this card is gone with it. `finish` closes over the task it was
   * created for, so a swipe mid-overlay can't redirect the write.
   */
  const celebrate = (finish: () => void) => {
    if (celebrating || pendingCelebrationTaskIds.current.has(task.id)) return;
    pendingCelebrationTaskIds.current.add(task.id);
    setCelebratedTaskId(task.id);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setTimeout(() => {
      try {
        finish();
        // Only this task's own session ends with it — by now the user could
        // have swiped on and started another one.
        if (useSessionStore.getState().session?.taskIds.includes(task.id)) leaveSession();
      } finally {
        pendingCelebrationTaskIds.current.delete(task.id);
      }
    }, CELEBRATION_MS);
  };

  const handleComplete = () => celebrate(() => completeTask(task.id));

  // Ticking the last open step finishes the whole task (see completeStep), so
  // that tap gets the same send-off as the Complete button — the step is
  // written once the overlay has played, not before it. Ticked from inside the
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
    setBreakdownOpen(false);
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

  const handleOpenBreakdown = () => {
    setBreakdownOpen(true);
    // No steps yet — have the AI draft them right away.
    const hasUnfinishedSteps = (task.subtasks ?? []).some((subtask) => subtask.status !== "completed");
    if (!hasUnfinishedSteps && breakdownStatus !== "loading") regenerateBreakdown();
  };

  return (
    <Animated.View
      pointerEvents={preview ? "none" : "auto"}
      className="overflow-hidden rounded-[28px] border border-white/10 bg-charcoal-900"
      style={style}
    >
      {/* Dimming and sizing a waiting card is the parent's job, so both can
          ease as that card moves up the stack. The content keeps the height it
          asks for and is clipped to whatever the card is given. */}
      <View
        className="gap-4 p-5"
        onLayout={(event) => onMeasure?.(event.nativeEvent.layout.height + CARD_BORDERS)}
      >
        <View className="gap-2">
          <View className="flex-row items-center gap-1.5 self-start rounded-full bg-orange-500 px-3 py-1.5">
            <Ionicons name="flame" size={14} color={colors.cream[50]} />
            <Text className="font-grotesk-bold text-sm text-cream-50">{t.next.priorityRank(rank)}</Text>
          </View>

          <View className="flex-row flex-wrap gap-2">
            <View className="flex-row items-center gap-1.5 rounded-full border border-white/10 bg-black/40 px-3 py-1.5">
              <GemLogo size={13} onDark />
              <Text className="font-grotesk-bold text-sm text-ink-charcoal">{t.tasks.score(task.priorityScore)}</Text>
            </View>
          </View>

          <View className="flex-row flex-wrap gap-2">
            <View
              className={
                isOverdue
                  ? "flex-row items-center gap-1.5 rounded-xl border border-overdue-500/60 px-2.5 py-1"
                  : "flex-row items-center gap-1.5 rounded-xl border border-white/15 px-2.5 py-1"
              }
            >
              <Feather name="calendar" size={12} color={isOverdue ? colors.overdue[500] : colors.ink.charcoalMuted} />
              <Text
                className={
                  isOverdue
                    ? "font-grotesk-medium text-xs text-overdue-500"
                    : "font-grotesk-medium text-xs text-ink-charcoal-muted"
                }
              >
                {isOverdue ? due.pillLabel : due.label}
              </Text>
            </View>
            <View className="flex-row items-center gap-1.5 rounded-xl border border-orange-500/40 bg-orange-500/15 px-2.5 py-1">
              <Feather name="clock" size={12} color={colors.orange[500]} />
              <Text className="font-grotesk-semibold text-xs text-orange-500">{formatDuration(plannedMinutes)}</Text>
            </View>
          </View>
        </View>

        <AnimatedPressable onPress={onDetails} scaleTo={0.99} accessibilityRole="button">
          <Text
            numberOfLines={3}
            style={rtl}
            className="font-grotesk-bold text-[26px] leading-[32px] tracking-tight text-ink-charcoal"
          >
            {task.title}
          </Text>
        </AnimatedPressable>

        {runningSession && hasSteps ? <MicroStepsChecklist task={task} onToggleStep={handleToggleStep} /> : null}

        <View className="h-px bg-white/10" />

        <View className="gap-2.5">
          {runningSession ? (
            <SessionPanel session={runningSession} onComplete={handleComplete} onCancel={handleCancelSession} />
          ) : (
            <AnimatedPressable
              onPress={() => onStart(plannedMinutes)}
              accessibilityRole="button"
              className="flex-row items-center justify-center gap-2.5 rounded-[20px] bg-orange-500 px-4 py-3.5"
              style={START_BUTTON_GLOW}
            >
              <Ionicons name="play" size={18} color={colors.cream[50]} />
              <Text numberOfLines={1} className="shrink font-grotesk-bold text-base text-cream-50">
                {t.next.startSessionFor(formatDuration(plannedMinutes))}
              </Text>
            </AnimatedPressable>
          )}

          <View className="flex-row gap-2.5">
            <AnimatedPressable
              onPress={handleOpenBreakdown}
              accessibilityRole="button"
              className="flex-1 flex-row items-center justify-center gap-2 rounded-[16px] border border-white/10 bg-white/5 px-2.5 py-2.5"
            >
              <MaterialCommunityIcons name="playlist-plus" size={18} color={colors.orange[500]} />
              <Text className="shrink font-grotesk-bold text-sm text-ink-charcoal">{t.session.aiBreakdown}</Text>
            </AnimatedPressable>
            <AnimatedPressable
              onPress={adviceShown ? dismissAdvice : requestAdvice}
              accessibilityRole="button"
              accessibilityState={{ selected: adviceShown }}
              className={
                adviceShown
                  ? "flex-1 flex-row items-center justify-center gap-2 rounded-[16px] border border-orange-500/60 bg-orange-500/15 px-2.5 py-2.5"
                  : "flex-1 flex-row items-center justify-center gap-2 rounded-[16px] border border-white/10 bg-white/5 px-2.5 py-2.5"
              }
            >
              <Ionicons name="bulb-outline" size={17} color={colors.orange[500]} />
              <Text className="shrink font-grotesk-bold text-sm text-ink-charcoal">{t.session.aiAdvice}</Text>
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
      </View>

      {celebrating ? <CompletedOverlay title={task.title} /> : null}

      {/* Mounted only while open — a Modal per card is expensive, and these
          cards are re-rendered on every swipe. */}
      {breakdownOpen && !preview ? (
        <BreakdownSheet
          visible={breakdownOpen}
          task={task}
          status={breakdownStatus}
          onRegenerate={regenerateBreakdown}
          onToggleStep={handleToggleStep}
          onClose={() => setBreakdownOpen(false)}
        />
      ) : null}
    </Animated.View>
  );
}
