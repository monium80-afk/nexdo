import { Feather, Ionicons } from "@expo/vector-icons";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useState, type ReactNode } from "react";
import { Alert, Platform, Text, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/useTranslation";
import type { TaskPriorityLevel } from "@/types/task";

export type DeadlineValue = "today" | "tomorrow" | "friday" | "weekend" | "nextWeek" | "none";

// Chip labels live in the translations: form.durationOptions / form.deadlines.
export const DURATION_OPTIONS: number[] = [15, 30, 45, 60, 90, 120, 180];

export const DEADLINE_OPTIONS: DeadlineValue[] = ["today", "tomorrow", "friday", "weekend", "nextWeek", "none"];

// "This Friday"/"This Weekend" resolve to the nearest upcoming Fri/Sat, today included.
export function computeDeadlineDate(value: DeadlineValue): Date | undefined {
  const now = new Date();

  switch (value) {
    case "today": {
      const date = new Date(now);
      date.setHours(18, 0, 0, 0);
      // Chosen after 6pm, a flat 18:00 is already behind us and the task would
      // be created overdue. The end of the day is still today, and isn't.
      if (date.getTime() <= now.getTime()) date.setHours(23, 59, 0, 0);
      return date;
    }
    case "tomorrow": {
      const date = new Date(now);
      date.setDate(date.getDate() + 1);
      date.setHours(18, 0, 0, 0);
      return date;
    }
    case "friday": {
      const date = new Date(now);
      const daysUntilFriday = (5 - date.getDay() + 7) % 7;
      date.setDate(date.getDate() + daysUntilFriday);
      date.setHours(18, 0, 0, 0);
      if (daysUntilFriday === 0 && date.getTime() <= now.getTime()) date.setDate(date.getDate() + 7);
      return date;
    }
    case "weekend": {
      const date = new Date(now);
      const daysUntilSaturday = (6 - date.getDay() + 7) % 7;
      date.setDate(date.getDate() + daysUntilSaturday);
      date.setHours(12, 0, 0, 0);
      if (daysUntilSaturday === 0 && date.getTime() <= now.getTime()) date.setDate(date.getDate() + 7);
      return date;
    }
    case "nextWeek": {
      const date = new Date(now);
      date.setDate(date.getDate() + 7);
      date.setHours(18, 0, 0, 0);
      return date;
    }
    case "none":
    default:
      return undefined;
  }
}

export function SectionHeader({
  icon,
  label,
  action,
}: {
  icon: ReactNode;
  label: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View className="flex-row items-center justify-between">
      <View className="flex-row items-center gap-2">
        {icon}
        <Text className="eyebrow text-ink-cream">{label}</Text>
      </View>
      {action ? (
        <AnimatedPressable onPress={action.onPress} hitSlop={8}>
          <Text className="font-grotesk-semibold text-sm text-orange-500">{action.label}</Text>
        </AnimatedPressable>
      ) : null}
    </View>
  );
}

export function DurationChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <AnimatedPressable
      onPress={onPress}
      className={
        selected
          ? "rounded-2xl border border-orange-500 bg-orange-500 px-3.5 py-2"
          : "rounded-2xl border border-cream-300 bg-cream-50 px-3.5 py-2"
      }
    >
      <Text
        className={
          selected ? "font-grotesk-bold text-sm text-cream-50" : "font-grotesk-medium text-sm text-ink-cream"
        }
      >
        {label}
      </Text>
    </AnimatedPressable>
  );
}

export function DeadlineChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <AnimatedPressable
      onPress={onPress}
      className={
        selected
          ? "rounded-2xl border border-charcoal-900 bg-charcoal-900 px-3.5 py-2"
          : "rounded-2xl border border-cream-300 bg-cream-50 px-3.5 py-2"
      }
    >
      <Text
        className={
          selected ? "font-grotesk-bold text-sm text-ink-charcoal" : "font-grotesk-medium text-sm text-ink-cream"
        }
      >
        {label}
      </Text>
    </AnimatedPressable>
  );
}

// Each level keeps its own color whether picked or not, so the three read
// apart at a glance: high = overdue red, medium = amber, low = olive.
const PRIORITY_STYLES: Record<TaskPriorityLevel, { idle: string; selected: string; text: string; color: string }> = {
  high: {
    idle: "flex-1 gap-2 rounded-2xl border border-overdue-500/40 bg-overdue-100 p-3.5",
    selected: "flex-1 gap-2 rounded-2xl border-2 border-overdue-500 bg-overdue-500 p-3.5",
    text: "font-grotesk-bold text-sm text-overdue-500",
    color: colors.overdue[500],
  },
  medium: {
    idle: "flex-1 gap-2 rounded-2xl border border-amber-500/40 bg-amber-100 p-3.5",
    selected: "flex-1 gap-2 rounded-2xl border-2 border-amber-500 bg-amber-500 p-3.5",
    text: "font-grotesk-bold text-sm text-amber-500",
    color: colors.amber[500],
  },
  low: {
    idle: "flex-1 gap-2 rounded-2xl border border-olive-500/40 bg-olive-100 p-3.5",
    selected: "flex-1 gap-2 rounded-2xl border-2 border-olive-500 bg-olive-500 p-3.5",
    text: "font-grotesk-bold text-sm text-olive-500",
    color: colors.olive[500],
  },
};

const PRIORITY_ICONS: Record<TaskPriorityLevel, keyof typeof Ionicons.glyphMap> = {
  high: "flame",
  medium: "alert-circle",
  low: "leaf",
};

export function PriorityCard({
  level,
  title,
  selected,
  onPress,
}: {
  level: TaskPriorityLevel;
  title: string;
  selected: boolean;
  onPress: () => void;
}) {
  const style = PRIORITY_STYLES[level];

  return (
    <AnimatedPressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      className={selected ? style.selected : style.idle}
    >
      <Ionicons name={PRIORITY_ICONS[level]} size={18} color={selected ? colors.cream[50] : style.color} />
      <Text className={selected ? "font-grotesk-bold text-sm text-cream-50" : style.text}>{title}</Text>
    </AnimatedPressable>
  );
}

/**
 * A calendar for the deadline. iOS shows it inline; Android opens its native
 * date dialog, then the time dialog, and shows the result as a tappable row.
 */
export function DeadlineDatePicker({ value, onChange }: { value: Date; onChange: (date: Date) => void }) {
  const t = useTranslation();
  // Android opens onto the date dialog immediately and only commits once a valid
  // time has been picked. Keep the selected date pending until the final deadline
  // is valid, so cancelling the time picker leaves the current value alone.
  const [androidPicker, setAndroidPicker] = useState<"date" | "time" | null>("date");
  const [pendingDate, setPendingDate] = useState<Date | null>(null);

  const handleChange = (event: DateTimePickerEvent, selected?: Date) => {
    const mode = androidPicker;
    if (Platform.OS === "android") setAndroidPicker(null);
    if (event.type === "dismissed" || !selected) {
      if (Platform.OS === "android") {
        setPendingDate(null);
      }
      return;
    }

    if (Platform.OS === "android") {
      const baseDate = pendingDate ?? value;

      if (mode === "date") {
        const nextPending = new Date(baseDate);
        nextPending.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
        setPendingDate(nextPending);
        setAndroidPicker("time");
        return;
      }

      const next = new Date(baseDate);
      next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
      if (next.getTime() < Date.now()) {
        // Said out loud rather than swallowed: the dialog closing with the row
        // unchanged reads as the app having ignored the tap.
        setPendingDate(null);
        Alert.alert(t.form.deadlineInPast);
        return;
      }

      setPendingDate(null);
      onChange(next);
      return;
    }

    const next = new Date(value);
    next.setTime(selected.getTime());
    onChange(next);
  };

  if (Platform.OS === "ios") {
    return (
      <View className="overflow-hidden rounded-2xl border border-cream-300 bg-cream-50 px-2">
        <DateTimePicker
          value={value}
          mode="datetime"
          display="inline"
          minimumDate={new Date()}
          accentColor={colors.orange[500]}
          themeVariant="light"
          onChange={handleChange}
        />
      </View>
    );
  }

  const label = `${value.toLocaleDateString(t.locale, { weekday: "short", month: "short", day: "numeric" })} · ${value.toLocaleTimeString(t.locale, { hour: "2-digit", minute: "2-digit" })}`;

  return (
    <>
      <AnimatedPressable
        onPress={() => setAndroidPicker("date")}
        className="flex-row items-center gap-3 rounded-2xl border border-orange-500 bg-orange-100 px-4 py-3.5"
      >
        <Feather name="calendar" size={16} color={colors.orange[600]} />
        <Text className="flex-1 font-grotesk-semibold text-sm text-orange-600">{label}</Text>
        <Text className="font-grotesk-semibold text-xs text-orange-600">{t.form.changeDate}</Text>
      </AnimatedPressable>
      {androidPicker ? (
        <DateTimePicker
          value={pendingDate ?? value}
          mode={androidPicker}
          display="default"
          minimumDate={androidPicker === "date" ? new Date() : undefined}
          onChange={handleChange}
        />
      ) : null}
    </>
  );
}
