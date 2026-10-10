import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { Checkbox } from "@/components/Checkbox";
import { gradients } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { deadlineToLocalDate } from "@/lib/deadline";
import type { Translations } from "@/lib/i18n";
import { toLocalDateKey } from "@/lib/localDate";
import { describeRule } from "@/lib/recurrence";
import type { ScheduleItem } from "@/lib/schedule";
import { getDueInfo } from "@/lib/taskMeta";
import type { Task } from "@/types/task";

// How long the ticked box shows before the item is completed and leaves the
// open list — long enough to see the tick land.
const CHECK_HOLD_MS = 450;

/** "1h 30m" — the compact length the time tile and a day's load use. */
export function formatBudget(minutes: number, t: Translations): string {
  return t.format.budget(Math.floor(minutes / 60), Math.round(minutes % 60));
}

/**
 * One line of a day on the Schedule: a tile with the user's time (or the
 * work's length), the task, how late it is or how it repeats, and a checkbox.
 * The row opens the task; the box completes it — drawn ticked at once,
 * completed a beat later, like TaskCard.
 */
export function ScheduleItemRow({
  item,
  onPress,
  onComplete,
}: {
  item: ScheduleItem;
  onPress: () => void;
  onComplete: () => void;
}) {
  const t = useTranslation();
  const colors = useColors();
  const rtl = useRtlText();
  const reduceMotion = useReducedMotion();
  const budget = (minutes: number) => formatBudget(minutes, t);
  const [ticking, setTicking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(onComplete);
  useEffect(() => {
    latest.current = onComplete;
  });
  // Leaving mid-tick still completes it: the tap was real.
  useEffect(
    () => () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      latest.current();
    },
    [],
  );

  const handleToggle = () => {
    // A second tap during the tick takes it back before it lands.
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      setTicking(false);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (reduceMotion) {
      onComplete();
      return;
    }
    setTicking(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      latest.current();
      setTicking(false);
    }, CHECK_HOLD_MS);
  };

  const { task } = item;
  const time = item.time && task.deadline ? formatTime(task, t.locale) : undefined;
  // Beside the Overdue pill, how late: "Due yesterday" — or, for a time that
  // passed earlier today (whose label is just "Overdue"), that time.
  const dueLabel = getDueInfo(task).pillLabel;
  const lateBy =
    dueLabel !== t.due.overdue ? dueLabel : task.deadline?.time ? t.due.dueTodayBy(formatTime(task, t.locale)) : "";
  const step = currentStep(task);
  // Under the title, when there's something worth saying: how late it is
  // (beside the Overdue pill), how it repeats, or the step it's on.
  const note = item.overdue
    ? lateBy
    : task.recurrence
      ? describeRule(task.recurrence.rule, t)
      : step
        ? t.schedule.stepOf(step.number, step.total, step.label)
        : "";

  return (
    <AnimatedPressable
      onPress={onPress}
      scaleTo={0.98}
      style={gradients.card}
      className="card card--cream-soft flex-row items-center gap-3 py-3 pl-3 pr-4"
    >
      {/* A task with no duration has no length to show: a dash, unless it has a time. */}
      <View className="min-w-[60px] items-center rounded-[13px] bg-cream-200 px-2 py-1.5">
        <Text className="font-grotesk-bold text-[14px] leading-[18px] text-ink-cream">
          {time ?? (item.minutes > 0 ? budget(item.minutes) : "–")}
        </Text>
        {time && item.minutes > 0 ? (
          <Text className="font-grotesk-medium text-[11px] text-ink-cream-muted">{budget(item.minutes)}</Text>
        ) : null}
      </View>

      <View className="flex-1 gap-1">
        <Text className="font-grotesk-bold text-[16px] leading-[21px] tracking-tight text-ink-cream" style={rtl} numberOfLines={2}>
          {task.title}
        </Text>
        {item.overdue || note ? (
          <View className="flex-row items-center gap-1.5">
            {item.overdue ? (
              <View className="badge--overdue-solid rounded-full px-2 py-[1px]">
                <Text className="font-grotesk-bold text-[11px] text-on-accent">{t.due.overdue}</Text>
              </View>
            ) : task.recurrence ? (
              <Feather name="repeat" size={12} color={colors.orange[500]} />
            ) : null}
            <Text className="shrink font-grotesk-medium text-[13px] text-ink-cream-muted" numberOfLines={1}>
              {note}
            </Text>
          </View>
        ) : null}
      </View>

      <AnimatedPressable
        onPress={handleToggle}
        hitSlop={12}
        accessibilityRole="checkbox"
        accessibilityLabel={task.title}
        accessibilityState={{ checked: ticking }}
      >
        <Checkbox checked={ticking} tone={item.overdue ? "overdue" : "default"} />
      </AnimatedPressable>
    </AnimatedPressable>
  );
}

/**
 * A finished task that was due on the day being looked at: flat, ticked, its
 * title struck. Beside it, when it was done — the time, or the date when that
 * was another day. Unticking reopens it.
 */
export function DoneScheduleRow({ task, onPress, onReopen }: { task: Task; onPress: () => void; onReopen: () => void }) {
  const t = useTranslation();
  const rtl = useRtlText();
  const doneAt = task.completedAt ? new Date(task.completedAt) : null;
  const at = !doneAt
    ? ""
    : toLocalDateKey(doneAt) === task.deadline?.date
      ? doneAt.toLocaleTimeString(t.locale, { hour: "numeric", minute: "2-digit" })
      : doneAt.toLocaleDateString(t.locale, { month: "short", day: "numeric" });
  return (
    <AnimatedPressable onPress={onPress} scaleTo={0.98} className="card card--cream-muted flex-row items-center gap-3 py-2.5 pl-3 pr-4">
      <View className="min-w-[60px] items-center px-2">
        <Text className="font-grotesk-semibold text-[13px] text-ink-cream-muted">{at}</Text>
      </View>
      <Text className="flex-1 font-grotesk-semibold text-[15px] text-ink-cream-muted line-through" style={rtl} numberOfLines={2}>
        {task.title}
      </Text>
      <AnimatedPressable
        onPress={onReopen}
        hitSlop={12}
        accessibilityRole="checkbox"
        accessibilityLabel={task.title}
        accessibilityState={{ checked: true }}
      >
        <Checkbox checked />
      </AnimatedPressable>
    </AnimatedPressable>
  );
}

/** The plan's step to do now, and where it sits in the plan — or null for a task without one left. */
function currentStep(task: Task): { label: string; number: number; total: number } | null {
  const steps = (task.subtasks ?? []).slice().sort((a, b) => a.order - b.order);
  const open = steps.filter((step) => step.status !== "completed");
  const step = open.find((entry) => entry.id === task.currentStepId) ?? open[0];
  return step ? { label: step.label, number: steps.indexOf(step) + 1, total: steps.length } : null;
}

function formatTime(task: Task, locale: string): string {
  return deadlineToLocalDate(task.deadline!).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}
