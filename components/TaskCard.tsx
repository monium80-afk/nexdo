import { Feather, Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { GemLogo } from "@/components/GemLogo";
import { MetaPill } from "@/components/MetaPill";
import { getCategoryTint } from "@/constants/categories";
import { colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDuration } from "@/lib/formatDuration";
import { getDeadlineUrgency, getDueInfo, type DeadlineUrgency } from "@/lib/taskMeta";
import { useCategory } from "@/store/useCategoryStore";
import type { Task } from "@/types/task";

// The deadline tag's icon and text: red when it's close, yellow within the week, green after that.
const DEADLINE_TAG_COLORS: Record<DeadlineUrgency, { icon: string; label: string }> = {
  close: { icon: colors.overdue[500], label: "text-overdue-500" },
  normal: { icon: colors.amber[500], label: "text-amber-500" },
  far: { icon: colors.olive[500], label: "text-olive-500" },
};

type TaskCardProps = {
  task: Task;
  onPress: () => void;
  onToggle: () => void;
};

export function TaskCard({ task, onPress, onToggle }: TaskCardProps) {
  const t = useTranslation();
  const category = useCategory(task.category);
  const categoryTint = getCategoryTint(category.color);
  const due = getDueInfo(task);
  const isCompleted = task.status === "completed";
  const isOverdue = due.tone === "overdue";
  // A finished task's tag reads "Completed" rather than a deadline, so it stays neutral.
  const deadlineColors = isCompleted ? undefined : DEADLINE_TAG_COLORS[getDeadlineUrgency(task)];

  const cardVariant = isOverdue ? "card--overdue" : isCompleted ? "card--cream-muted" : "card--cream";

  return (
    <AnimatedPressable onPress={onPress} scaleTo={0.98} className={`card ${cardVariant} gap-3 p-5`}>
      <View className="flex-row items-start gap-3">
        <AnimatedPressable
          onPress={onToggle}
          hitSlop={8}
          className={
            isCompleted
              ? "h-6 w-6 items-center justify-center rounded-lg bg-orange-500"
              : isOverdue
                ? "h-6 w-6 rounded-lg border-2 border-overdue-500"
                : "h-6 w-6 rounded-lg border-2 border-cream-300"
          }
        >
          {isCompleted ? <Feather name="check" size={14} color={colors.cream[50]} /> : null}
        </AnimatedPressable>

        <View className="flex-1 flex-row items-start justify-between gap-2">
          <Text
            style={{ marginTop: -2 }}
            className={
              isCompleted
                ? "flex-1 font-grotesk-bold text-[17px] leading-[22px] text-ink-cream-muted line-through"
                : "flex-1 font-grotesk-bold text-[17px] leading-[22px] text-ink-cream"
            }
          >
            {task.title}
          </Text>
          <View className="pt-0.5">
            {isCompleted ? (
              <Ionicons name="checkmark-circle" size={18} color={colors.olive[500]} />
            ) : isOverdue ? (
              <View className="rounded bg-overdue-500 px-1.5 py-0.5">
                <Text className="font-grotesk-bold text-[10px] tracking-wider text-cream-50">{t.tasks.overdueBadge}</Text>
              </View>
            ) : (
              <Feather name="chevron-right" size={18} color={colors.ink.creamMuted} />
            )}
          </View>
        </View>
      </View>

      {/* One wrapping row so every pill is the same size with the same gap
          between them, across and down. */}
      <View className="flex-row flex-wrap gap-2">
        <MetaPill icon={<GemLogo size={13} />} label={t.tasks.score(task.priorityScore)} />
        <MetaPill
          icon={<Feather name="calendar" size={13} color={deadlineColors?.icon ?? colors.ink.creamMuted} />}
          label={isOverdue ? due.pillLabel : due.label}
          labelClassName={`font-grotesk-bold ${deadlineColors?.label ?? "text-ink-cream"}`}
        />
        <MetaPill
          icon={<Feather name="clock" size={13} color={colors.ink.creamMuted} />}
          label={formatDuration(task.estimatedMinutes)}
        />
        <MetaPill
          icon={<View className="h-2 w-2 rounded-full" style={{ backgroundColor: categoryTint[500] }} />}
          label={category.label}
          tint={categoryTint}
        />
      </View>
    </AnimatedPressable>
  );
}
