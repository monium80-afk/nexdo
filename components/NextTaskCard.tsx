import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useState } from "react";
import { ActivityIndicator, Platform, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { BreakdownSheet } from "@/components/BreakdownSheet";
import { GemLogo } from "@/components/GemLogo";
import { HighlightedText } from "@/components/HighlightedText";
import { getCategoryTint } from "@/constants/categories";
import { colors } from "@/constants/theme";
import { useSessionCountdown } from "@/hooks/useSessionCountdown";
import { useTaskAiAssist } from "@/hooks/useTaskAiAssist";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDuration } from "@/lib/formatDuration";
import { getDueInfo } from "@/lib/taskMeta";
import { useCategory } from "@/store/useCategoryStore";
import { useSessionStore, type ActiveSession } from "@/store/useSessionStore";
import { useTaskStore } from "@/store/useTaskStore";
import type { Task } from "@/types/task";

// A task with no estimate still needs a timer length.
const FALLBACK_SESSION_MINUTES = 25;
// How much of the plan the card shows while a session runs, and how much
// time the "+5 min" button buys.
const VISIBLE_STEPS = 3;
const EXTEND_MINUTES = 5;

// iOS only, deliberately. Android draws an elevation shadow as a hard grey
// rectangle once the view it belongs to is partly transparent — and the card
// fades as it slides under the returning one mid-swipe, so the shadow showed
// as a box behind it and greyed its inside through it. The card's hairline
// border carries the depth on Android instead.
const CARD_SHADOW = Platform.select({
  ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 18 }, shadowOpacity: 0.28, shadowRadius: 28 },
});

const START_BUTTON_GLOW = Platform.select({
  ios: { shadowColor: colors.orange[500], shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.45, shadowRadius: 16 },
});

/** The task's plan while a session runs on it — the first few steps, tickable in order. */
function MicroStepsChecklist({ task }: { task: Task }) {
  const t = useTranslation();
  const completeStep = useTaskStore((state) => state.completeStep);
  const steps = task.subtasks?.slice().sort((a, b) => a.order - b.order) ?? [];
  const doneCount = steps.filter((step) => step.status === "completed").length;
  const shown = steps.slice(0, VISIBLE_STEPS);
  const hiddenCount = steps.length - shown.length;

  return (
    <View className="gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-row items-center gap-2">
          <MaterialCommunityIcons name="playlist-plus" size={16} color={colors.orange[500]} />
          <Text className="eyebrow text-ink-charcoal-muted">{t.session.microSteps}</Text>
        </View>
        <Text className="font-grotesk-medium text-xs text-ink-charcoal-muted">
          {t.session.stepsDone(doneCount, steps.length)}
        </Text>
      </View>

      {/* Flex ratios rather than a percentage width — RN takes fractional flex directly. */}
      <View className="h-1.5 flex-row overflow-hidden rounded-full bg-white/10">
        <View className="rounded-full bg-orange-500" style={{ flex: doneCount }} />
        <View style={{ flex: steps.length - doneCount }} />
      </View>

      <View className="gap-2.5">
        {shown.map((step) => {
          const done = step.status === "completed";
          // Steps are worked in order, so only the current one can be ticked.
          const interactive = step.status === "current";
          return (
            <AnimatedPressable
              key={step.id}
              onPress={() => completeStep(task.id, step.id)}
              disabled={!interactive}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: done, disabled: !interactive }}
              className="flex-row items-center gap-3"
            >
              <View
                className={
                  done
                    ? "h-5 w-5 items-center justify-center rounded-md bg-orange-500"
                    : interactive
                      ? "h-5 w-5 rounded-md border-2 border-orange-500"
                      : "h-5 w-5 rounded-md border-2 border-white/20"
                }
              >
                {done ? <Feather name="check" size={12} color={colors.cream[50]} /> : null}
              </View>
              <Text
                numberOfLines={1}
                className={
                  done
                    ? "flex-1 font-grotesk-medium text-sm text-ink-charcoal-muted line-through"
                    : "flex-1 font-grotesk-medium text-sm text-ink-charcoal"
                }
              >
                {step.label}
              </Text>
              <Text className="font-grotesk-medium text-xs text-ink-charcoal-muted">
                {formatDuration(step.estimatedMinutes)}
              </Text>
            </AnimatedPressable>
          );
        })}
        {hiddenCount > 0 ? (
          <Text className="font-grotesk-medium text-xs text-ink-charcoal-muted">{t.session.moreSteps(hiddenCount)}</Text>
        ) : null}
      </View>
    </View>
  );
}

/** The running clock, in place of the "Start Session" button. */
function SessionPanel({ session, onComplete }: { session: ActiveSession; onComplete: () => void }) {
  const t = useTranslation();
  const countdown = useSessionCountdown(session);
  const pause = useSessionStore((state) => state.pause);
  const resume = useSessionStore((state) => state.resume);
  const resetTimer = useSessionStore((state) => state.resetTimer);
  const extendMinutes = useSessionStore((state) => state.extendMinutes);

  return (
    <View className="gap-3 rounded-2xl border border-white/10 bg-black/40 p-4">
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-row items-center gap-2">
          <View className="h-2.5 w-2.5 rounded-full bg-success-500" />
          <Text className="eyebrow text-orange-500">{t.session.inProgress}</Text>
        </View>
        <View className="flex-row items-center gap-2">
          <AnimatedPressable
            onPress={() => extendMinutes(EXTEND_MINUTES)}
            accessibilityRole="button"
            className="rounded-full bg-white/10 px-3 py-1.5"
          >
            <Text className="font-grotesk-bold text-xs text-ink-charcoal">{t.session.addMinutes(EXTEND_MINUTES)}</Text>
          </AnimatedPressable>
          <AnimatedPressable
            onPress={resetTimer}
            accessibilityRole="button"
            accessibilityLabel={t.session.restartA11y}
            className="rounded-full bg-white/10 px-3 py-1.5"
          >
            <Text className="font-grotesk-bold text-xs text-ink-charcoal-muted">{t.session.resetTimer}</Text>
          </AnimatedPressable>
        </View>
      </View>

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
    </View>
  );
}

/** One card of the Next page's stack — a task's essentials, a session button and the AI helpers. */
export function NextTaskCard({
  task,
  rank,
  preview = false,
  onStart,
  onDetails,
}: {
  task: Task;
  rank: number;
  /** The card peeking behind the stack — dimmed and not interactive. */
  preview?: boolean;
  onStart: (plannedMinutes: number) => void;
  onDetails: () => void;
}) {
  const t = useTranslation();
  const category = useCategory(task.category);
  const categoryTint = getCategoryTint(category.color);
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

  const handleComplete = () => {
    completeTask(task.id);
    leaveSession();
  };

  const { advice, requestAdvice, dismissAdvice, breakdownStatus, regenerateBreakdown } = useTaskAiAssist(
    task,
    plannedMinutes,
  );
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const adviceShown = advice.status !== "idle";

  const handleOpenBreakdown = () => {
    setBreakdownOpen(true);
    // No steps yet — have the AI draft them right away.
    const hasUnfinishedSteps = (task.subtasks ?? []).some((subtask) => subtask.status !== "completed");
    if (!hasUnfinishedSteps && breakdownStatus !== "loading") regenerateBreakdown();
  };

  return (
    <View
      pointerEvents={preview ? "none" : "auto"}
      className={
        preview
          ? "flex-1 overflow-hidden rounded-[28px] border border-white/10 bg-charcoal-900 p-5"
          : "rounded-[28px] border border-white/10 bg-charcoal-900 p-5"
      }
      style={preview ? undefined : CARD_SHADOW}
    >
      {/* Dimming the card under the stack is the parent's job, so it can fade
          up as that card becomes the top one. */}
      <View className="gap-4">
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
            <View className="flex-row items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
              <View className="h-2 w-2 rounded-full" style={{ backgroundColor: categoryTint[500] }} />
              <Text className="font-grotesk-semibold text-sm text-ink-charcoal">{category.label}</Text>
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
          <Text numberOfLines={3} className="font-grotesk-bold text-[26px] leading-[32px] tracking-tight text-ink-charcoal">
            {task.title}
          </Text>
        </AnimatedPressable>

        {runningSession && hasSteps ? <MicroStepsChecklist task={task} /> : null}

        <View className="h-px bg-white/10" />

        <View className="gap-2.5">
          {runningSession ? (
            <SessionPanel session={runningSession} onComplete={handleComplete} />
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
              <Text className="font-grotesk-medium text-[15px] text-ink-charcoal-muted">{t.common.aiUnreachable}</Text>
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

      {/* Mounted only while open — a Modal per card is expensive, and these
          cards are re-rendered on every swipe. */}
      {breakdownOpen && !preview ? (
        <BreakdownSheet
          visible={breakdownOpen}
          task={task}
          status={breakdownStatus}
          onRegenerate={regenerateBreakdown}
          onToggleStep={(subtaskId) => completeStep(task.id, subtaskId)}
          onClose={() => setBreakdownOpen(false)}
        />
      ) : null}
    </View>
  );
}
