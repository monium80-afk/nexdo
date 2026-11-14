import { Feather } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { AppIcon } from "@/components/icons/AppIcons";
import { colors } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import { formatTaskLength } from "@/lib/formatDuration";
import { describeRule } from "@/lib/recurrence";
import { getDueInfo } from "@/lib/taskMeta";
import type { Task } from "@/types/task";

/**
 * A task as Magic mic shows it (the 2026-11 redesign, Final-Mic.html): a
 * compact light card — the round box, the title, then when and how long. A
 * size down from the mockup, like the rest of the redesign on the phone.
 * `highlighted`: an updated task, edged in peach.
 */
export function MicTaskCard({
  task,
  highlighted = false,
  onToggle,
}: {
  task: Task;
  highlighted?: boolean;
  onToggle?: () => void;
}) {
  const t = useTranslation();
  const rtl = useRtlText();
  const due = getDueInfo(task);
  const done = task.status === "completed";
  const overdue = due.tone === "overdue";
  const today = due.tone === "today";
  const dueColor = overdue ? colors.palette.alert : today ? colors.palette.accentInk : colors.palette.inkMuted;

  return (
    <View
      className="flex-row items-start gap-[11px] rounded-[16px] border-[1.5px] bg-paper-card py-[12px] pl-[14px] pr-[12px]"
      style={{ borderColor: highlighted ? "#F0B89C" : "transparent" }}
    >
      <AnimatedPressable
        onPress={onToggle}
        disabled={!onToggle}
        hitSlop={8}
        scaleTo={0.9}
        accessibilityRole="checkbox"
        accessibilityLabel={task.title}
        accessibilityState={{ checked: done }}
        className={`h-[25px] w-[25px] items-center justify-center rounded-full border-2 ${done ? "border-accent bg-accent" : "border-ring-soft"}`}
      >
        {done ? <AppIcon name="check" size={13} strokeWidth={3.2} color="#FFFFFF" /> : null}
      </AnimatedPressable>
      <View className="flex-1 gap-[5px]">
        <View className="flex-row items-start">
          <Text
            numberOfLines={2}
            style={rtl}
            className={`flex-shrink font-grotesk-semibold text-[15px] leading-[19px] ${done ? "text-ink-muted line-through" : "text-ink"}`}
          >
            {task.title}
          </Text>
          {/* A repeating task (a routine or a recurring task): arrows after its name, as on the Tasks page. */}
          {task.recurrence ? (
            <View className="ml-[6px] mt-[3px]" accessibilityLabel={describeRule(task.recurrence.rule, t)}>
              <Feather name="repeat" size={13} color={done ? colors.palette.inkMuted : colors.palette.accent} />
            </View>
          ) : null}
        </View>
        <View className="flex-row flex-wrap items-center gap-x-[12px] gap-y-[3px]">
          {task.deadline ? (
            <View className="flex-row items-center gap-[4px]">
              <AppIcon name="calendar" size={13} strokeWidth={2} color={dueColor} />
              <Text
                numberOfLines={1}
                className={`text-[12.5px] ${overdue ? "font-grotesk-bold text-alert" : today ? "font-grotesk-semibold text-accent-ink" : "font-grotesk-regular text-ink-muted"}`}
              >
                {overdue ? t.due.overdue : due.pillLabel}
              </Text>
            </View>
          ) : null}
          <View className="flex-row items-center gap-[4px]">
            <AppIcon name="clock" size={13} strokeWidth={2} color={colors.palette.inkMuted} />
            <Text className="font-grotesk-regular text-[12.5px] text-ink-muted">{formatTaskLength(task.estimatedMinutes)}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
