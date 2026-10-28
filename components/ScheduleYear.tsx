import { memo, useMemo } from "react";
import { Pressable, Text, View } from "react-native";

import { gradients } from "@/constants/theme";
import { useTranslation } from "@/hooks/useTranslation";
import { daysInMonth, keyToLocalDate, pad, weekdayOf, type LocalDate } from "@/lib/localDate";
import { weekdayName } from "@/lib/recurrence";
import type { DayPlan } from "@/lib/schedule";
import type { Weekday } from "@/types/task";

/** What a day's dot says — the same colours as the week strip's. */
export type DayMark = "late" | "open" | "done";

// The weeks run Monday to Sunday, as in the week view.
const WEEK_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

/** Each day of the plans that has anything on it, and what. */
export function markDays(plans: DayPlan[], today: LocalDate): Map<LocalDate, DayMark> {
  const marks = new Map<LocalDate, DayMark>();
  for (const day of plans) {
    if (day.items.length > 0) marks.set(day.date, day.date < today ? "late" : "open");
    else if (day.done.length > 0) marks.set(day.date, "done");
  }
  return marks;
}

const MARK_DOT: Record<DayMark, string> = {
  late: "bg-overdue-500",
  open: "bg-orange-500",
  done: "bg-cream-300",
};

/**
 * One month of the year view, the width of the screen: its name, the weekday
 * initials, and its days in Monday-first rows. A day with tasks on it has a
 * dot; today is orange; the day picked in the week view is a filled orange disc.
 */
const MonthGrid = memo(function MonthGrid({
  year,
  month,
  today,
  selected,
  marks,
  onPickDay,
  onLayoutY,
}: {
  year: number;
  /** 1-based. */
  month: number;
  today: LocalDate;
  selected: LocalDate;
  marks: Map<LocalDate, DayMark>;
  onPickDay: (date: LocalDate) => void;
  /** Where the month starts in the year's column, once laid out. */
  onLayoutY?: (y: number) => void;
}) {
  const t = useTranslation();
  const first = `${year}-${pad(month)}-01`;
  const length = daysInMonth(year, month);
  // Blank cells before the 1st, so it lands under its own weekday.
  const lead = (weekdayOf(first) + 6) % 7;
  const cells: (LocalDate | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length }, (_, index) => `${year}-${pad(month)}-${pad(index + 1)}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const rows = Array.from({ length: cells.length / 7 }, (_, row) => cells.slice(row * 7, row * 7 + 7));
  const isThisMonth = today.startsWith(`${year}-${pad(month)}`);

  return (
    <View
      className="card card--cream-soft gap-2 px-3 pb-3 pt-3.5"
      style={gradients.card}
      onLayout={onLayoutY ? (event) => onLayoutY(event.nativeEvent.layout.y) : undefined}
    >
      <Text
        className={`px-1 font-grotesk-bold text-[17px] capitalize ${isThisMonth ? "text-orange-600" : "text-ink-cream"}`}
        numberOfLines={1}
      >
        {keyToLocalDate(first).toLocaleDateString(t.locale, { month: "long" })}
      </Text>
      <View className="flex-row">
        {WEEK_ORDER.map((day) => (
          <Text key={day} className="flex-1 text-center font-grotesk-semibold text-[11px] uppercase text-ink-cream-subtle">
            {weekdayName(day, t.locale, "narrow")}
          </Text>
        ))}
      </View>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} className="flex-row">
          {row.map((date, cellIndex) => {
            if (!date) return <View key={`blank-${cellIndex}`} className="h-[42px] flex-1" />;
            const isSelected = date === selected;
            const isToday = date === today;
            const mark = marks.get(date);
            return (
              <Pressable
                key={date}
                onPress={() => onPickDay(date)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={keyToLocalDate(date).toLocaleDateString(t.locale, { weekday: "long", month: "long", day: "numeric" })}
                className="h-[42px] flex-1 items-center"
              >
                <View
                  className={`h-[32px] w-[32px] items-center justify-center rounded-full ${
                    isSelected ? "bg-orange-500" : isToday ? "border-[1.5px] border-orange-500" : ""
                  }`}
                >
                  <Text
                    className={`font-grotesk-semibold text-[15px] ${
                      isSelected ? "text-on-accent" : isToday ? "text-orange-600" : "text-ink-cream"
                    }`}
                  >
                    {Number(date.slice(8))}
                  </Text>
                </View>
                {mark ? <View className={`mt-[2px] h-[5px] w-[5px] rounded-full ${MARK_DOT[mark]}`} /> : null}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
});

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

/**
 * The Schedule's year view: the twelve months one under the other, each the
 * width of the screen, to scroll through (the user's call, 2026-10-09 — two
 * to a row made the days too small), with a dot on every day that has tasks
 * due — red for tasks left late, orange for tasks to come, grey once a day's
 * are all done. Tapping a day opens that day in the week view.
 */
export function ScheduleYear({
  year,
  plans,
  today,
  selected,
  onPickDay,
  focusMonth,
  onFocusMonthY,
}: {
  year: number;
  /** The year's days, January 1 to December 31 (lib/schedule.ts). */
  plans: DayPlan[];
  today: LocalDate;
  selected: LocalDate;
  onPickDay: (date: LocalDate) => void;
  /** The month (1-based) to scroll to when the year opens. */
  focusMonth: number;
  /** Where that month starts in this column, once it's laid out. */
  onFocusMonthY: (y: number) => void;
}) {
  const marks = useMemo(() => markDays(plans, today), [plans, today]);

  return (
    <View className="gap-3">
      {MONTHS.map((month) => (
        <MonthGrid
          key={month}
          year={year}
          month={month}
          today={today}
          selected={selected}
          marks={marks}
          onPickDay={onPickDay}
          onLayoutY={month === focusMonth ? onFocusMonthY : undefined}
        />
      ))}
    </View>
  );
}
