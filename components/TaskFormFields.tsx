import { Feather, Ionicons } from "@expo/vector-icons";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Platform, Text, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { Chip } from "@/components/Chip";
import { colors, gradients } from "@/constants/theme";
import { useThemeScheme } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { showAlert } from "@/lib/alert";
import { deadlineToLocalDate, makeDeadline, type DeadlineInput } from "@/lib/deadline";
import { pad, toLocalDateKey } from "@/lib/localDate";
import type { TaskDeadline, TaskPriorityLevel } from "@/types/task";

export type DeadlineValue = "today" | "tomorrow" | "friday" | "none";

/**
 * "No duration": a task that isn't one sitting of work — a goal kept up
 * through the day ("drink 2 L of water", "no sugar today"). Saved as 0
 * minutes; its focus session counts up instead of down (useSessionCountdown).
 */
export const NO_DURATION = 0;

// Chip labels live in the translations: form.durationOptions / form.deadlines.
// "No duration" last, like "No deadline" among the deadline chips.
export const DURATION_OPTIONS: number[] = [15, 30, 45, 60, 90, 120, 180, NO_DURATION];

/** The longest title the AI is sent in full (MAX_TITLE_LENGTH in lib/serverRequest.ts). */
export const MAX_TASK_TITLE_LENGTH = 200;
/** Digits a custom length may have: up to 9,999 minutes, under what the AI routes accept. */
export const MAX_CUSTOM_MINUTES_DIGITS = 4;

// "This weekend" and "Next week" were removed (2026-10-08): neither said
// which day the task would land on. Any other day is on the calendar.
export const DEADLINE_OPTIONS: DeadlineValue[] = ["today", "tomorrow", "friday", "none"];

/**
 * The day a deadline chip stands for — a date-only deadline: the chips name a
 * day, never a time, so none is invented. "This Friday" is the nearest
 * upcoming Friday, today included. Undefined for "No deadline".
 */
export function computeDeadline(value: DeadlineValue, now: Date = new Date()): DeadlineInput | undefined {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (value) {
    case "today":
      break;
    case "tomorrow":
      date.setDate(date.getDate() + 1);
      break;
    case "friday":
      date.setDate(date.getDate() + ((5 - date.getDay() + 7) % 7));
      break;
    case "none":
    default:
      return undefined;
  }
  return { date: toLocalDateKey(date) };
}

/** What the calendar is showing: a day, and whether a time was added to it. */
export type DeadlineDraft = { date: Date; hasTime: boolean };

/** The deadline a calendar pick stands for — its day, and its time only if one was added. */
export function draftToDeadline(draft: DeadlineDraft): DeadlineInput {
  return {
    date: toLocalDateKey(draft.date),
    time: draft.hasTime ? `${pad(draft.date.getHours())}:${pad(draft.date.getMinutes())}` : undefined,
  };
}

/** The calendar's starting point for a deadline (or tomorrow, date-only, without one). */
export function deadlineToDraft(deadline: TaskDeadline | DeadlineInput | undefined): DeadlineDraft {
  if (deadline) {
    const made = makeDeadline(deadline);
    if (made) return { date: deadlineToLocalDate(made), hasTime: !!made.time };
  }
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(0, 0, 0, 0);
  return { date, hasTime: false };
}

// Each level keeps its own colour on its icon whether picked or not, so the
// three read apart at a glance: high = overdue red, medium = amber, low =
// olive. Picked, the card takes that colour's tint and edge — the same way
// the task list tints a deadline that's due — with the label kept dark.
const PRIORITY_STYLES: Record<TaskPriorityLevel, { selected: string; color: string }> = {
  high: { selected: "border-overdue-500 bg-overdue-100", color: colors.overdue[500] },
  medium: { selected: "border-amber-500 bg-amber-100", color: colors.amber[500] },
  low: { selected: "border-olive-500 bg-olive-100", color: colors.olive[500] },
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
      style={selected ? undefined : gradients.card}
      className={`card flex-1 gap-2 p-[14px] ${selected ? style.selected : "chip--idle"}`}
    >
      <Ionicons name={PRIORITY_ICONS[level]} size={18} color={style.color} />
      <Text className={selected ? "font-grotesk-bold text-sm text-ink-cream" : "font-grotesk-semibold text-sm text-ink-cream"}>
        {title}
      </Text>
    </AnimatedPressable>
  );
}

function isInPast(draft: DeadlineDraft): boolean {
  if (draft.hasTime) return draft.date.getTime() < Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return draft.date.getTime() < today.getTime();
}

/**
 * A calendar for the deadline. It picks a day; a time is only part of the
 * deadline once "Add a time" is used, so a picked day never turns into that
 * day at some hour nobody chose. iOS shows the calendar inline; Android opens
 * its native dialogs and shows the result as a tappable row.
 */
export function DeadlineDatePicker({ value, onChange }: { value: DeadlineDraft; onChange: (next: DeadlineDraft) => void }) {
  const scheme = useThemeScheme();
  const t = useTranslation();
  // Android opens onto the date dialog straight away — the reason this
  // calendar was opened — and the time dialog only when asked for.
  const [androidPicker, setAndroidPicker] = useState<"date" | "time" | null>("date");

  const commit = (next: DeadlineDraft) => {
    if (isInPast(next)) {
      // Said out loud rather than swallowed: the dialog closing with the row
      // unchanged reads as the app having ignored the tap.
      showAlert(t.form.deadlineInPast);
      return;
    }
    onChange(next);
  };

  const setDay = (selected: Date) => {
    const date = new Date(value.date);
    date.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
    commit({ date, hasTime: value.hasTime });
  };

  const setTime = (selected: Date) => {
    const date = new Date(value.date);
    date.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    commit({ date, hasTime: true });
  };

  const addTime = () => {
    // Starts on the next full hour of that day, as a reasonable place for the wheel.
    const date = new Date(value.date);
    const now = new Date();
    date.setHours(Math.min(23, now.getHours() + 1), 0, 0, 0);
    // Today after 23:00 there's no next hour: the next five minutes instead
    // (at most 23:59), so the time still left today can be picked.
    if (date.getTime() <= now.getTime()) {
      date.setHours(now.getHours(), Math.min(59, Math.ceil((now.getMinutes() + 1) / 5) * 5), 0, 0);
    }
    if (Platform.OS === "android") {
      onChange({ date, hasTime: value.hasTime });
      setAndroidPicker("time");
      return;
    }
    commit({ date, hasTime: true });
  };

  const removeTime = () => {
    const date = new Date(value.date);
    date.setHours(0, 0, 0, 0);
    onChange({ date, hasTime: false });
  };

  const handleAndroidChange = (event: DateTimePickerEvent, selected?: Date) => {
    const mode = androidPicker;
    setAndroidPicker(null);
    if (event.type === "dismissed" || !selected) return;
    if (mode === "date") setDay(selected);
    else setTime(selected);
  };

  const timeLabel = value.date.toLocaleTimeString(t.locale, { hour: "numeric", minute: "2-digit" });
  const timeControls = value.hasTime ? (
    <View className="flex-row flex-wrap items-center gap-2">
      {Platform.OS === "ios" ? (
        <DateTimePicker
          value={value.date}
          mode="time"
          display="compact"
          accentColor={colors.orange[500]}
          themeVariant={scheme}
          onChange={(event, selected) => {
            if (event.type !== "dismissed" && selected) setTime(selected);
          }}
        />
      ) : (
        <Chip
          label={timeLabel}
          selected
          icon={(color) => <Feather name="clock" size={14} color={color} />}
          onPress={() => setAndroidPicker("time")}
        />
      )}
      <Chip label={t.form.removeTime} onPress={removeTime} />
    </View>
  ) : (
    <View className="flex-row">
      <Chip label={t.form.addTime} icon={(color) => <Feather name="clock" size={14} color={color} />} onPress={addTime} />
    </View>
  );

  if (Platform.OS === "ios") {
    return (
      <View className="gap-3">
        <View className="input overflow-hidden border-cream-200 px-2">
          <DateTimePicker
            value={value.date}
            mode="date"
            display="inline"
            minimumDate={new Date()}
            accentColor={colors.orange[500]}
            themeVariant={scheme}
            onChange={(event, selected) => {
              if (event.type !== "dismissed" && selected) setDay(selected);
            }}
          />
        </View>
        {timeControls}
      </View>
    );
  }

  const dayLabel = value.date.toLocaleDateString(t.locale, { weekday: "short", month: "short", day: "numeric" });
  const label = value.hasTime ? `${dayLabel} · ${timeLabel}` : dayLabel;

  return (
    <View className="gap-3">
      {/* A field showing the picked date, in the picked-chip colours: it's the choice in force. */}
      <AnimatedPressable
        onPress={() => setAndroidPicker("date")}
        accessibilityRole="button"
        className="min-h-[44px] flex-row items-center gap-2 rounded-[14px] border border-orange-500 bg-orange-100 px-4"
      >
        <Feather name="calendar" size={14} color={colors.orange[600]} />
        <Text className="flex-1 font-grotesk-bold text-sm text-orange-600">{label}</Text>
        <Text className="font-grotesk-semibold text-sm text-orange-600">{t.form.changeDate}</Text>
      </AnimatedPressable>
      {timeControls}
      {androidPicker ? (
        <DateTimePicker
          value={value.date}
          mode={androidPicker}
          display="default"
          minimumDate={androidPicker === "date" ? new Date() : undefined}
          onChange={handleAndroidChange}
        />
      ) : null}
    </View>
  );
}
