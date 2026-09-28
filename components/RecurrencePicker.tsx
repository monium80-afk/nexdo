import { Feather } from "@expo/vector-icons";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Platform, Text, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { DeadlineChip, SectionHeader } from "@/components/TaskFormFields";
import { colors } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import { formatWhen } from "@/lib/operationMessages";
import { buildRule, describeRule, slotDueDate, toLocalDateKey, weekdayName, type RuleInput } from "@/lib/recurrence";
import type { RecurrenceFrequency, Weekday } from "@/types/task";

const FREQUENCIES: (RecurrenceFrequency | "none")[] = ["none", "daily", "weekly", "monthly", "yearly"];
const WEEK_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];
const MAX_INTERVAL = 99;

function keyToDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * The repeat settings for a task: how often, which weekdays, and an optional
 * last day. `dueDate` is the deadline the task would have, which sets the
 * time of day and — unless weekdays are picked — the day the pattern follows;
 * the caption shows the first occurrence that works out to.
 */
export function RecurrencePicker({
  value,
  onChange,
  dueDate,
}: {
  value: RuleInput | null;
  onChange: (value: RuleInput | null) => void;
  dueDate: string | undefined;
}) {
  const t = useTranslation();
  const rtl = useRtlText();
  const [endPickerOpen, setEndPickerOpen] = useState(false);

  const now = new Date();
  const preview = value ? buildRule(value, dueDate, now) : null;

  const selectFrequency = (frequency: RecurrenceFrequency | "none") => {
    if (frequency === "none") {
      onChange(null);
      return;
    }
    // Weekly starts on the deadline's own weekday, so the picker never opens empty.
    const baseDay = dueDate ? new Date(dueDate) : now;
    onChange({
      frequency,
      interval: value?.frequency === frequency ? value.interval : 1,
      weekdays: frequency === "weekly" ? (value?.weekdays?.length ? value.weekdays : [baseDay.getDay() as Weekday]) : undefined,
      endDate: value?.endDate,
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
      <SectionHeader icon={<Feather name="repeat" size={14} color={colors.orange[500]} />} label={t.recurrence.title} />

      <View className="flex-row flex-wrap gap-2">
        {FREQUENCIES.map((frequency) => (
          <DeadlineChip
            key={frequency}
            label={t.recurrence.frequencies[frequency]}
            selected={frequency === "none" ? !value : value?.frequency === frequency}
            onPress={() => selectFrequency(frequency)}
          />
        ))}
      </View>

      {value ? (
        <View className="gap-4 rounded-2xl border border-cream-300 bg-cream-50 p-4">
          <View className="flex-row items-center gap-3">
            <Text className="font-grotesk-semibold text-sm text-ink-cream">{t.recurrence.every}</Text>
            <View className="flex-row items-center gap-2">
              <AnimatedPressable
                onPress={() => setInterval(interval - 1)}
                disabled={interval <= 1}
                accessibilityRole="button"
                accessibilityLabel={t.recurrence.decrease}
                className="h-9 w-9 items-center justify-center rounded-xl border border-cream-300 bg-cream-100"
                style={interval <= 1 ? { opacity: 0.4 } : undefined}
              >
                <Feather name="minus" size={16} color={colors.ink.cream} />
              </AnimatedPressable>
              <Text className="min-w-[28px] text-center font-grotesk-bold text-base text-ink-cream">{interval}</Text>
              <AnimatedPressable
                onPress={() => setInterval(interval + 1)}
                accessibilityRole="button"
                accessibilityLabel={t.recurrence.increase}
                className="h-9 w-9 items-center justify-center rounded-xl border border-cream-300 bg-cream-100"
              >
                <Feather name="plus" size={16} color={colors.ink.cream} />
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
                          ? "h-10 w-10 items-center justify-center rounded-full bg-orange-500"
                          : "h-10 w-10 items-center justify-center rounded-full border border-cream-300 bg-cream-100"
                      }
                    >
                      <Text
                        className={
                          selected ? "font-grotesk-bold text-xs text-on-accent" : "font-grotesk-medium text-xs text-ink-cream"
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
              <DeadlineChip
                label={t.recurrence.endsNever}
                selected={!value.endDate}
                onPress={() => {
                  onChange({ ...value, endDate: undefined });
                  setEndPickerOpen(false);
                }}
              />
              <DeadlineChip
                label={
                  value.endDate
                    ? keyToDate(value.endDate).toLocaleDateString(t.locale, { month: "short", day: "numeric", year: "numeric" })
                    : t.recurrence.endsOn
                }
                selected={!!value.endDate}
                onPress={() => setEndPickerOpen((open) => !open)}
              />
            </View>
            {endPickerOpen ? (
              <DateTimePicker
                value={value.endDate ? keyToDate(value.endDate) : new Date(now.getFullYear(), now.getMonth() + 1, now.getDate())}
                mode="date"
                display={Platform.OS === "ios" ? "inline" : "default"}
                minimumDate={now}
                accentColor={colors.orange[500]}
                themeVariant="light"
                onChange={handleEndChange}
              />
            ) : null}
          </View>

          {preview ? (
            <View className="gap-1">
              <Text className="font-grotesk-semibold text-sm text-orange-600" style={rtl}>
                {t.recurrence.summary(describeRule(preview, t))}
              </Text>
              <Text className="font-grotesk-medium text-xs text-ink-cream-muted" style={rtl}>
                {t.recurrence.firstOn(formatWhen(slotDueDate(preview, preview.anchorDate), t))}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
