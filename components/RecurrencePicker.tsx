import { Feather } from "@expo/vector-icons";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Platform, Text, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { Chip } from "@/components/Chip";
import { SectionHeader } from "@/components/SectionHeader";
import { useRtlText } from "@/hooks/useRtlText";
import { useColors, useThemeScheme } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDeadline, makeDeadline, type DeadlineInput } from "@/lib/deadline";
import { pad } from "@/lib/localDate";
import {
  buildRule,
  defaultRecurrenceKind,
  describeRule,
  ruleTime,
  slotDeadline,
  toLocalDateKey,
  weekdayName,
  weekdayOf,
  type RuleInput,
} from "@/lib/recurrence";
import type { RecurrenceFrequency, RecurrenceKind, TaskDeadline, Weekday } from "@/types/task";

const FREQUENCIES: (RecurrenceFrequency | "none")[] = ["none", "daily", "weekly", "monthly", "yearly"];
const WEEK_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];
const MAX_INTERVAL = 99;
/** Where the time wheel starts for a repeat that has no time yet — a morning, not an hour from now. */
const DEFAULT_REPEAT_TIME = "09:00";

function keyToDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * The repeat settings for a task: how often, which weekdays, an optional last
 * day, and what happens to a missed occurrence. `deadline` is the deadline
 * the task would have, which sets the time of day (none for a date-only one)
 * and — unless weekdays are picked — the day the pattern follows; the caption
 * shows the first occurrence that works out to.
 */
export function RecurrencePicker({
  value,
  onChange,
  deadline,
  nested = false,
}: {
  value: RuleInput | null;
  onChange: (value: RuleInput | null) => void;
  deadline: TaskDeadline | DeadlineInput | undefined;
  /**
   * Inside a card that already has its own "Repeats" title (Task Details):
   * no title of its own, and the options sit in an inset rather than a
   * second card.
   */
  nested?: boolean;
}) {
  const colors = useColors();
  const scheme = useThemeScheme();
  const t = useTranslation();
  const rtl = useRtlText();
  const [endPickerOpen, setEndPickerOpen] = useState(false);
  const [androidTimeOpen, setAndroidTimeOpen] = useState(false);

  const now = new Date();
  const due = makeDeadline(deadline);
  const preview = value ? buildRule(value, due, now) : null;

  const selectFrequency = (frequency: RecurrenceFrequency | "none") => {
    if (frequency === "none") {
      onChange(null);
      return;
    }
    // Weekly starts on the deadline's own weekday, so the picker never opens empty.
    const baseDay = due ? weekdayOf(due.date) : (now.getDay() as Weekday);
    // No kind: a new rhythm gets the default for it (lib/recurrence.ts
    // defaultRecurrenceKind) until the user picks one below.
    onChange({
      frequency,
      interval: value?.frequency === frequency ? value.interval : 1,
      weekdays: frequency === "weekly" ? (value?.weekdays?.length ? value.weekdays : [baseDay]) : undefined,
      endDate: value?.endDate,
      missed: value?.missed,
      time: value?.time,
    });
  };

  // Routine or repeating task: the one picked, or the default for how often
  // it comes round — every 3 days or more often is a routine.
  const kind: RecurrenceKind | undefined = value
    ? (value.kind ?? defaultRecurrenceKind({ frequency: value.frequency, interval: value.interval ?? 1, weekdays: value.weekdays }))
    : undefined;

  // The time every occurrence is due: the one picked here, or else the
  // deadline's (lib/recurrence.ts ruleTime) — none means any time on the day.
  const effectiveTime = value ? ruleTime(value, due) : undefined;
  const timeAsDate = (() => {
    const [hour, minute] = (effectiveTime ?? DEFAULT_REPEAT_TIME).split(":").map(Number);
    return new Date(2024, 0, 1, hour, minute);
  })();
  const timeLabel = timeAsDate.toLocaleTimeString(t.locale, { hour: "numeric", minute: "2-digit" });

  const setTime = (selected: Date) => {
    if (!value) return;
    onChange({ ...value, time: `${pad(selected.getHours())}:${pad(selected.getMinutes())}` });
  };

  const handleAndroidTime = (event: DateTimePickerEvent, selected?: Date) => {
    setAndroidTimeOpen(false);
    if (event.type === "dismissed" || !selected) return;
    setTime(selected);
  };

  // "Set a time": iOS shows its compact wheel at once, on 9:00; Android opens
  // its clock dialog, and nothing changes unless a time is picked there.
  const handleSetTime = () => {
    if (Platform.OS === "android") {
      setAndroidTimeOpen(true);
      return;
    }
    setTime(timeAsDate);
  };

  // A different rhythm goes back to that rhythm's default kind.
  const setInterval = (interval: number) => {
    if (!value) return;
    onChange({ ...value, interval: Math.min(MAX_INTERVAL, Math.max(1, interval)), kind: undefined });
  };

  const toggleWeekday = (day: Weekday) => {
    if (!value) return;
    const current = value.weekdays ?? [];
    const next = current.includes(day) ? current.filter((entry) => entry !== day) : [...current, day];
    // At least one day stays picked — a weekly rule with none has no occurrences.
    if (next.length === 0) return;
    onChange({ ...value, weekdays: next, kind: undefined });
  };

  const handleEndChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === "android") setEndPickerOpen(false);
    if (event.type === "dismissed" || !selected || !value) return;
    onChange({ ...value, endDate: toLocalDateKey(selected) });
  };

  const interval = value?.interval ?? 1;

  return (
    <View className="gap-3">
      {nested ? null : <SectionHeader icon="repeat" label={t.recurrence.title} />}

      <View className="flex-row flex-wrap gap-2">
        {FREQUENCIES.map((frequency) => (
          <Chip
            key={frequency}
            label={t.recurrence.frequencies[frequency]}
            selected={frequency === "none" ? !value : value?.frequency === frequency}
            onPress={() => selectFrequency(frequency)}
            accessibilityRole="radio"
          />
        ))}
      </View>

      {value ? (
        <View className={nested ? "card card--cream-inset gap-4 p-[14px]" : "card card--cream-soft gap-4 p-[16px]"}>
          <View className="flex-row items-center gap-3">
            <Text className="font-grotesk-semibold text-sm text-ink-cream">{t.recurrence.every}</Text>
            {/* Round steppers in the idle chip's colours, like every other control here. */}
            <View className="flex-row items-center gap-2">
              <AnimatedPressable
                onPress={() => setInterval(interval - 1)}
                disabled={interval <= 1}
                accessibilityRole="button"
                accessibilityLabel={t.recurrence.decrease}
                className={`h-[34px] w-[34px] items-center justify-center rounded-full border border-cream-200 bg-cream-50 ${interval <= 1 ? "opacity-40" : ""}`}
              >
                <Feather name="minus" size={15} color={colors.ink.cream} />
              </AnimatedPressable>
              <Text className="min-w-[28px] text-center font-grotesk-bold text-base text-ink-cream">{interval}</Text>
              <AnimatedPressable
                onPress={() => setInterval(interval + 1)}
                accessibilityRole="button"
                accessibilityLabel={t.recurrence.increase}
                className="h-[34px] w-[34px] items-center justify-center rounded-full border border-cream-200 bg-cream-50"
              >
                <Feather name="plus" size={15} color={colors.ink.cream} />
              </AnimatedPressable>
            </View>
            <Text className="font-grotesk-medium text-sm text-ink-cream">{t.recurrence.unit(value.frequency, interval)}</Text>
          </View>

          {value.frequency === "weekly" ? (
            <View className="gap-2">
              <Text className="eyebrow text-ink-cream-muted">{t.recurrence.onDays}</Text>
              <View className="flex-row justify-between">
                {WEEK_ORDER.map((day) => {
                  const selected = value.weekdays?.includes(day) ?? false;
                  return (
                    <AnimatedPressable
                      key={day}
                      onPress={() => toggleWeekday(day)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      accessibilityLabel={weekdayName(day, t.locale, "long")}
                      className={
                        selected
                          ? "h-[36px] w-[36px] items-center justify-center rounded-full border border-orange-500 bg-orange-100"
                          : "h-[36px] w-[36px] items-center justify-center rounded-full border border-cream-200 bg-cream-50"
                      }
                    >
                      <Text
                        className={
                          selected ? "font-grotesk-bold text-sm text-orange-600" : "font-grotesk-semibold text-sm text-ink-cream"
                        }
                      >
                        {weekdayName(day, t.locale, "narrow")}
                      </Text>
                    </AnimatedPressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {/* A routine sits under the cards on Today and just passes if it's
              missed; a repeating task is one of the cards, like any task. */}
          <View className="gap-2">
            <Text className="eyebrow text-ink-cream-muted">{t.recurrence.kindTitle}</Text>
            <View className="flex-row flex-wrap gap-2">
              {(["routine", "task"] as const).map((option) => (
                <Chip
                  key={option}
                  label={t.recurrence.kinds[option]}
                  selected={kind === option}
                  onPress={() => onChange({ ...value, kind: option })}
                  accessibilityRole="radio"
                />
              ))}
            </View>
            <Text className="font-grotesk-medium text-sm text-ink-cream-muted" style={rtl}>
              {kind === "routine" ? t.recurrence.routineHint : t.recurrence.taskHint}
            </Text>
          </View>

          {/* What time each one is due — or any time on its day. */}
          <View className="gap-2">
            <Text className="eyebrow text-ink-cream-muted">{t.recurrence.timeOfDay}</Text>
            <View className="flex-row flex-wrap items-center gap-2">
              <Chip
                label={t.recurrence.anyTime}
                selected={!effectiveTime}
                onPress={() => onChange({ ...value, time: null })}
                accessibilityRole="radio"
              />
              {effectiveTime && Platform.OS === "ios" ? (
                <DateTimePicker
                  value={timeAsDate}
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
                  label={effectiveTime ? timeLabel : t.recurrence.setTime}
                  selected={!!effectiveTime}
                  icon={(color) => <Feather name="clock" size={14} color={color} />}
                  onPress={handleSetTime}
                  accessibilityRole="radio"
                />
              )}
            </View>
            {androidTimeOpen ? (
              <DateTimePicker value={timeAsDate} mode="time" display="default" onChange={handleAndroidTime} />
            ) : null}
          </View>

          <View className="gap-2">
            <Text className="eyebrow text-ink-cream-muted">{t.recurrence.ends}</Text>
            <View className="flex-row flex-wrap gap-2">
              <Chip
                label={t.recurrence.endsNever}
                selected={!value.endDate}
                onPress={() => {
                  onChange({ ...value, endDate: undefined });
                  setEndPickerOpen(false);
                }}
                accessibilityRole="radio"
              />
              <Chip
                label={
                  value.endDate
                    ? keyToDate(value.endDate).toLocaleDateString(t.locale, { month: "short", day: "numeric", year: "numeric" })
                    : t.recurrence.endsOn
                }
                selected={!!value.endDate}
                onPress={() => setEndPickerOpen((open) => !open)}
                accessibilityRole="radio"
              />
            </View>
            {endPickerOpen ? (
              <DateTimePicker
                value={value.endDate ? keyToDate(value.endDate) : new Date(now.getFullYear(), now.getMonth() + 1, now.getDate())}
                mode="date"
                display={Platform.OS === "ios" ? "inline" : "default"}
                minimumDate={now}
                accentColor={colors.orange[500]}
                themeVariant={scheme}
                onChange={handleEndChange}
              />
            ) : null}
          </View>

          {/* Only for a repeating task: a missed routine always just passes. */}
          {kind === "routine" ? null : (
          <View className="gap-2">
            <Text className="eyebrow text-ink-cream-muted">{t.recurrence.ifMissed}</Text>
            <View className="flex-row flex-wrap gap-2">
              <Chip
                label={t.recurrence.missedKeep}
                selected={value.missed !== "skip"}
                onPress={() => onChange({ ...value, missed: undefined })}
                accessibilityRole="radio"
              />
              <Chip
                label={t.recurrence.missedSkip}
                selected={value.missed === "skip"}
                onPress={() => onChange({ ...value, missed: "skip" })}
                accessibilityRole="radio"
              />
            </View>
            <Text className="font-grotesk-medium text-sm text-ink-cream-muted" style={rtl}>
              {value.missed === "skip" ? t.recurrence.missedSkipHint : t.recurrence.missedKeepHint}
            </Text>
          </View>
          )}

          {preview ? (
            <View className="gap-1">
              <Text className="font-grotesk-semibold text-sm text-orange-600" style={rtl}>
                {t.recurrence.summary(describeRule(preview, t, { withTime: true }))}
              </Text>
              <Text className="font-grotesk-medium text-sm text-ink-cream-muted" style={rtl}>
                {t.recurrence.firstOn(formatDeadline(slotDeadline(preview, preview.anchorDate), t.locale))}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
