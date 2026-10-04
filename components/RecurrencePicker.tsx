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
import { buildRule, describeRule, slotDeadline, toLocalDateKey, weekdayName, weekdayOf, type RuleInput } from "@/lib/recurrence";
import type { RecurrenceFrequency, TaskDeadline, Weekday } from "@/types/task";

const FREQUENCIES: (RecurrenceFrequency | "none")[] = ["none", "daily", "weekly", "monthly", "yearly"];
const WEEK_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];
const MAX_INTERVAL = 99;

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
    onChange({
      frequency,
      interval: value?.frequency === frequency ? value.interval : 1,
      weekdays: frequency === "weekly" ? (value?.weekdays?.length ? value.weekdays : [baseDay]) : undefined,
      endDate: value?.endDate,
      missed: value?.missed,
    });
  };

  const setInterval = (interval: number) => {
    if (!value) return;
    onChange({ ...value, interval: Math.min(MAX_INTERVAL, Math.max(1, interval)) });
  };

  const toggleWeekday = (day: Weekday) => {
    if (!value) return;
    const current = value.weekdays ?? [];
    const next = current.includes(day) ? current.filter((entry) => entry !== day) : [...current, day];
    // At least one day stays picked — a weekly rule with none has no occurrences.
    if (next.length === 0) return;
    onChange({ ...value, weekdays: next });
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

          {preview ? (
            <View className="gap-1">
              <Text className="font-grotesk-semibold text-sm text-orange-600" style={rtl}>
                {t.recurrence.summary(describeRule(preview, t))}
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
