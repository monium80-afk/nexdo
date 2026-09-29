import { Feather, Ionicons } from "@expo/vector-icons";
import { Fragment, useState, type ReactNode } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { BreakdownSheet } from "@/components/BreakdownSheet";
import { HighlightedText } from "@/components/HighlightedText";
import { useTaskAiAssist } from "@/hooks/useTaskAiAssist";
import { useRtlText } from "@/hooks/useRtlText";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import type { Subtask, Task } from "@/types/task";

// How far apart the two things a connector joins should sit. Steps within a
// task read as one tight run; a task and its steps get more air; two whole
// task blocks get the most, so the groups stay visually separate.
const CONNECTOR_SPACING = {
  step: "items-center gap-1 py-4",
  task: "items-center gap-2.5 py-6",
  group: "items-center gap-1 py-12",
} as const;

const DOT_TONES = {
  active: "h-1 w-1 rounded-full bg-orange-500",
  done: "h-1 w-1 rounded-full bg-success-500",
  muted: "h-1 w-1 rounded-full bg-charcoal-600",
} as const;

/**
 * The dotted spine that threads a task card into its sub-tasks and one task
 * block into the next. Orange under the live card, green leading into a step
 * that's been checked off, muted everywhere else — so the eye can find
 * "where am I" and "how far have I got" while scrolling a long session.
 */
export function SessionDotConnector({
  tone = "muted",
  spacing = "step",
}: {
  tone?: keyof typeof DOT_TONES;
  spacing?: keyof typeof CONNECTOR_SPACING;
}) {
  const dotClass = DOT_TONES[tone];

  return (
    <View className={CONNECTOR_SPACING[spacing]}>
      <View className={dotClass} />
      <View className={dotClass} />
      <View className={dotClass} />
    </View>
  );
}

function ActionChip({
  icon,
  label,
  selected = false,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <AnimatedPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={
        selected
          ? "chip chip--charcoal-selected flex-row items-center gap-2 px-3.5 py-2.5"
          : "chip chip--charcoal flex-row items-center gap-2 px-3.5 py-2.5"
      }
    >
      {icon}
      <Text
        className={
          selected
            ? "font-grotesk-semibold text-sm text-orange-500"
            : "font-grotesk-semibold text-sm text-ink-charcoal"
        }
      >
        {label}
      </Text>
    </AnimatedPressable>
  );
}

function SubtaskRow({
  subtask,
  interactive,
  onPress,
}: {
  subtask: Subtask;
  /** Steps of a finished task are read-only — see completeStep(). */
  interactive: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const done = subtask.status === "completed";

  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={!interactive}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done, disabled: !interactive }}
      className="hairline-charcoal flex-row items-center gap-3 rounded-2xl bg-charcoal-800 px-4 py-2.5"
    >
      <View
        className={
          done
            ? "h-5 w-5 items-center justify-center rounded-full bg-success-500"
            : subtask.status === "current"
              ? "h-5 w-5 rounded-full border-2 border-orange-500"
              : "h-5 w-5 rounded-full border-2 border-white/20"
        }
      >
        {done ? <Feather name="check" size={12} color={colors.onAccent} /> : null}
      </View>
      <Text
        numberOfLines={1}
        className={
          done
            ? "flex-1 font-grotesk-medium text-sm text-ink-charcoal-muted line-through"
            : "flex-1 font-grotesk-medium text-sm text-ink-charcoal"
        }
      >
        {subtask.label}
      </Text>
    </AnimatedPressable>
  );
}

export function SessionRunTaskCard({
  task,
  index,
  total,
  isActive,
  isLastTask,
  availableMinutes,
  onDone,
  onFocus,
  onStuck,
  onToggleSubtask,
}: {
  task: Task;
  index: number;
  total: number;
  isActive: boolean;
  /** Nothing else is left unfinished — completing this ends the run, so the CTA says so. */
  isLastTask: boolean;
  /** The session's time budget — the AI sizes its advice and first step to it. */
  availableMinutes: number;
  onDone: () => void;
  onFocus: () => void;
  onStuck: () => void;
  onToggleSubtask: (subtaskId: string) => void;
}) {
  const colors = useColors();
  const t = useTranslation();
  const rtl = useRtlText();
  const done = task.status === "completed";
  const subtasks = task.subtasks?.slice().sort((a, b) => a.order - b.order) ?? [];
  const { advice, requestAdvice, dismissAdvice, breakdownStatus, regenerateBreakdown } = useTaskAiAssist(
    task,
    availableMinutes,
  );
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  const adviceShown = advice.status !== "idle";

  const handleToggleAdvice = () => {
    if (adviceShown) dismissAdvice();
    else requestAdvice();
  };

  const handleOpenBreakdown = () => {
    setBreakdownOpen(true);
    // Nothing left to plan around yet — have the AI draft the steps right away.
    const hasUnfinishedSteps = subtasks.some((subtask) => subtask.status !== "completed");
    if (!hasUnfinishedSteps && breakdownStatus !== "loading") regenerateBreakdown();
  };

  return (
    <View>
      <View className={isActive ? "card card--charcoal-active gap-4 p-5" : "card card--charcoal gap-3.5 p-5"}>
        {/* Only the heading is pressable, not the whole card — the CTA and
            action chips below are Pressables of their own, and nesting them
            inside a card-wide one makes taps ambiguous. */}
        <AnimatedPressable
          onPress={onFocus}
          disabled={isActive || done}
          scaleTo={isActive || done ? 1 : 0.985}
          accessibilityRole="button"
          accessibilityLabel={isActive ? task.title : t.session.switchTo(task.title)}
          className="gap-3.5"
        >
          <View className="flex-row items-center gap-2.5">
            <View
              className={
                done || isActive
                  ? "h-7 w-7 items-center justify-center rounded-lg bg-orange-500"
                  : "h-7 w-7 items-center justify-center rounded-lg bg-white/10"
              }
            >
              {done ? (
                <Feather name="check" size={14} color={colors.onAccent} />
              ) : (
                <Text
                  className={
                    isActive
                      ? "font-grotesk-bold text-xs text-on-accent"
                      : "font-grotesk-bold text-xs text-ink-charcoal-muted"
                  }
                >
                  {index + 1}
                </Text>
              )}
            </View>
            <Text className="font-grotesk-medium text-sm text-ink-charcoal-muted">{t.session.of(total)}</Text>
          </View>

          <Text
            numberOfLines={2}
            style={rtl}
            className={
              done
                ? "text-card-title text-ink-charcoal-muted line-through"
                : "text-card-title text-ink-charcoal"
            }
          >
            {task.title}
          </Text>
        </AnimatedPressable>

        {!done && adviceShown ? (
          <Animated.View
            entering={FadeIn.duration(220)}
            className="gap-3 rounded-2xl border border-orange-500/25 bg-charcoal-900 p-4"
          >
            <View className="flex-row items-center justify-between gap-2">
              <View className="flex-row items-center gap-2">
                <Ionicons name="bulb-outline" size={18} color={colors.orange[500]} />
                <Text className="font-grotesk-semibold text-[15px] text-orange-500">{t.session.aiAdvice}</Text>
              </View>
              <AnimatedPressable
                onPress={dismissAdvice}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t.session.closeAdvice}
              >
                <Feather name="x" size={18} color={colors.ink.charcoalMuted} />
              </AnimatedPressable>
            </View>

            {advice.status === "loading" ? (
              <View className="flex-row items-center gap-2.5">
                <ActivityIndicator size="small" color={colors.orange[500]} />
                <Text className="font-grotesk-medium text-[15px] text-ink-charcoal-muted">
                  {t.session.readingTask}
                </Text>
              </View>
            ) : null}

            {advice.status === "error" ? (
              <View className="gap-2.5">
                <Text className="font-grotesk-medium text-[15px] text-ink-charcoal-muted">{t.common.aiUnreachable}</Text>
                <AnimatedPressable onPress={requestAdvice} accessibilityRole="button" className="flex-row items-center gap-1.5 self-start">
                  <Feather name="rotate-ccw" size={13} color={colors.orange[500]} />
                  <Text className="font-grotesk-semibold text-sm text-orange-500">{t.common.tryAgain}</Text>
                </AnimatedPressable>
              </View>
            ) : null}

            {advice.status === "ready" ? (
              <View className="gap-2">
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
              </View>
            ) : null}
          </Animated.View>
        ) : null}

        {isActive && !done ? (
          <AnimatedPressable
            onPress={onDone}
            accessibilityRole="button"
            className="flex-row items-center justify-center gap-2.5 rounded-full bg-orange-500 px-5 py-4"
          >
            <Feather name="check" size={18} color={colors.onAccent} />
            <Text className="font-grotesk-bold text-base text-on-accent">
              {isLastTask ? t.session.finishSession : t.session.nextTask}
            </Text>
          </AnimatedPressable>
        ) : null}

        {done ? null : (
          <>
            <View className="h-px bg-white/10" />
            <View className="flex-row flex-wrap gap-2">
              <ActionChip
                icon={<Ionicons name="sparkles-outline" size={14} color={colors.orange[500]} />}
                label={t.session.aiBreakdown}
                onPress={handleOpenBreakdown}
              />
              <ActionChip
                icon={<Ionicons name="bulb-outline" size={14} color={colors.orange[500]} />}
                label={adviceShown ? t.session.hideAdvice : isActive ? t.session.takeAdvice : t.session.aiAdvice}
                selected={adviceShown}
                onPress={handleToggleAdvice}
              />
              {isActive ? (
                <ActionChip
                  icon={<Feather name="life-buoy" size={14} color={colors.orange[500]} />}
                  label={t.session.stuck}
                  onPress={onStuck}
                />
              ) : null}
            </View>
          </>
        )}
      </View>

      {subtasks.length > 0 ? (
        <>
          <SessionDotConnector
            tone={subtasks[0].status === "completed" ? "done" : isActive ? "active" : "muted"}
            spacing="task"
          />
          {subtasks.map((subtask, subtaskIndex) => (
            <Fragment key={subtask.id}>
              {subtaskIndex > 0 ? (
                <SessionDotConnector tone={subtask.status === "completed" ? "done" : "muted"} />
              ) : null}
              <SubtaskRow
                subtask={subtask}
                interactive={!done}
                onPress={() => onToggleSubtask(subtask.id)}
              />
            </Fragment>
          ))}
        </>
      ) : null}

      <BreakdownSheet
        visible={breakdownOpen && !done}
        task={task}
        status={breakdownStatus}
        onRegenerate={regenerateBreakdown}
        onToggleStep={onToggleSubtask}
        onClose={() => setBreakdownOpen(false)}
      />
    </View>
  );
}
