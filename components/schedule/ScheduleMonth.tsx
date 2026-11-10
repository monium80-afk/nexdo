import { Fragment } from "react";
import { Pressable, Text, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import {
  CARD_SHADOW,
  TIGHT_TEXT,
  dayEntries,
  lengthLabel,
  taskCount,
  timeLabel,
  type DayEntry,
} from "@/components/schedule/scheduleParts";
import { useTranslation } from "@/hooks/useTranslation";
import { daysInMonth, keyToLocalDate, pad, weekdayOf, type LocalDate } from "@/lib/localDate";
import { weekdayName } from "@/lib/recurrence";
import type { DayPlan } from "@/lib/schedule";
import type { Weekday } from "@/types/task";

// The weeks run Monday to Sunday, as in the Week view.
const WEEK_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

/** A day's tile by how many tasks it has: none, 1–2, 3–4, 5–6, 7 or more. */
const BUSY_FILL = ["transparent", "#FCE9DC", "#F9C9A9", "#F59A62", "#F26A2E"] as const;
/** The count under the day's number, on each of those. */
const BUSY_COUNT = ["#7A6E64", "#7A6E64", "#9A5A35", "#6E3517", "#FFE1D2"] as const;
/** The key under the month: an empty tile, then the four. */
const KEY_FILLS = ["#FCF7EF", "#FCE9DC", "#F9C9A9", "#F59A62", "#F26A2E"] as const;

function busyLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 4) return 2;
  if (count <= 6) return 3;
  return 4;
}

/** One line of the picked day's card: time, title, and how long it takes. */
function MonthRow({ entry, onPress }: { entry: DayEntry; onPress: () => void }) {
  const t = useTranslation();
  const length = lengthLabel(entry.minutes, t);
  return (
    <AnimatedPressable onPress={onPress} scaleTo={0.98} accessibilityRole="button" className="h-[43.5px] flex-row items-center">
      <Text
        numberOfLines={1}
        className={`w-[74px] font-mono-bold text-[11px] leading-[14px] tracking-[0.5px] ${entry.overdue ? "text-alert" : "text-ink-muted"}`}
        style={TIGHT_TEXT}
      >
        {timeLabel(entry, t)}
      </Text>
      <Text
        numberOfLines={1}
        className={`flex-1 font-grotesk-medium text-[15.5px] leading-[20px] ${entry.done ? "text-[#A79C92] line-through" : "text-ink"}`}
        style={TIGHT_TEXT}
      >
        {entry.task.title}
      </Text>
      {length ? (
        <Text className="ml-[8px] font-grotesk-regular text-[12.75px] leading-[16px] text-ink-muted" style={TIGHT_TEXT}>
          {length}
        </Text>
      ) : null}
    </AnimatedPressable>
  );
}

/**
 * The Month view: the month's days as tiles, warmer the more tasks a day
 * has, with a key under them; then the picked day (outlined) and its list.
 */
export function ScheduleMonth({
  year,
  month,
  plans,
  selected,
  onSelect,
  onOpenTask,
}: {
  year: number;
  /** 1-based. */
  month: number;
  plans: Map<LocalDate, DayPlan>;
  selected: LocalDate;
  onSelect: (date: LocalDate) => void;
  onOpenTask: (id: string) => void;
}) {
  const t = useTranslation();
  const first = `${year}-${pad(month)}-01`;
  // Blank tiles before the 1st, so it lands under its own weekday.
  const lead = (weekdayOf(first) + 6) % 7;
  const cells: (LocalDate | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth(year, month) }, (_, index) => `${year}-${pad(month)}-${pad(index + 1)}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const rows = Array.from({ length: cells.length / 7 }, (_, row) => cells.slice(row * 7, row * 7 + 7));

  const { tasks, routines } = dayEntries(plans.get(selected));
  const entries = [...tasks, ...routines];
  const picked = keyToLocalDate(selected);

  return (
    <View>
      <View className="rounded-[21px] bg-paper-card px-[10px] pb-[10px] pt-[14.7px]" style={CARD_SHADOW}>
        {/* The weekday letters: evenly across the card, a touch left of the tiles under them, as in the design. */}
        <View className="-ml-[0.9px] mr-[0.9px] flex-row">
          {WEEK_ORDER.map((day) => (
            <Text key={day} className="flex-1 text-center font-mono-bold text-[10px] leading-[12px] text-ink-muted" style={TIGHT_TEXT}>
              {weekdayName(day, t.locale, "narrow")}
            </Text>
          ))}
        </View>

        <View className="mt-[6.3px] gap-[3.5px]">
          {rows.map((row, rowIndex) => (
            <View key={rowIndex} className="flex-row gap-[3.5px]">
              {row.map((date, cellIndex) => {
                if (!date) return <View key={`blank-${cellIndex}`} className="h-[49.5px] flex-1" />;
                const count = taskCount(plans.get(date));
                const level = busyLevel(count);
                const isPicked = date === selected;
                return (
                  <Pressable
                    key={date}
                    onPress={() => onSelect(date)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isPicked }}
                    accessibilityLabel={`${keyToLocalDate(date).toLocaleDateString(t.locale, { weekday: "long", month: "long", day: "numeric" })}, ${t.format.taskCount(count)}`}
                    className="h-[49.5px] flex-1 items-center rounded-[11.5px] pt-[8.3px]"
                    style={{ backgroundColor: BUSY_FILL[level] }}
                  >
                    <Text
                      className={`font-grotesk-bold text-[15px] leading-[20px] tracking-[-0.3px] ${level === 4 ? "text-white" : "text-ink"}`}
                      style={TIGHT_TEXT}
                    >
                      {Number(date.slice(8))}
                    </Text>
                    {count > 0 ? (
                      <Text className="mt-[2.9px] font-mono-bold text-[10px] leading-[12px]" style={[TIGHT_TEXT, { color: BUSY_COUNT[level] }]}>
                        {count}
                      </Text>
                    ) : null}
                    {/* The picked day: outlined, over its own colour. */}
                    {isPicked ? <View pointerEvents="none" className="absolute inset-0 rounded-[11.5px] border-2 border-ink" /> : null}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>

        <View className="mt-[8px] h-[15.5px] flex-row items-center justify-end gap-[4.25px]" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text className="font-grotesk-regular text-[11.5px] leading-[16px] text-ink-muted" style={TIGHT_TEXT}>
            {t.schedule.fewerTasks}
          </Text>
          {KEY_FILLS.map((fill) => (
            <View key={fill} className="h-[15.5px] w-[15.5px] rounded-[3.5px] border border-[#EADFD1]" style={{ backgroundColor: fill }} />
          ))}
          <Text className="font-grotesk-regular text-[11.5px] leading-[16px] text-ink-muted" style={TIGHT_TEXT}>
            {t.schedule.moreTasks}
          </Text>
        </View>
      </View>

      <View className="mt-[19.15px] flex-row items-baseline gap-[8px]">
        <Text className="font-grotesk-bold text-[16px] leading-[22px] text-ink" style={TIGHT_TEXT}>
          {picked.toLocaleDateString(t.locale, { weekday: "long" })}
        </Text>
        <Text className="font-grotesk-regular text-[13px] leading-[22px] text-ink-muted" style={TIGHT_TEXT}>
          {picked.toLocaleDateString(t.locale, { month: "short", day: "numeric" })}
        </Text>
      </View>

      {entries.length > 0 ? (
        <View className="mt-[8.35px] rounded-[21px] bg-paper-card px-[14px]" style={CARD_SHADOW}>
          {entries.map((entry, index) => (
            <Fragment key={entry.task.id}>
              {index > 0 ? <View className="h-[1px] bg-chip" /> : null}
              <MonthRow entry={entry} onPress={() => onOpenTask(entry.task.id)} />
            </Fragment>
          ))}
        </View>
      ) : (
        <Text className="mt-[9.35px] font-grotesk-regular text-[14px] leading-[18px] text-ink-muted" style={TIGHT_TEXT}>
          {t.schedule.nothingDue}
        </Text>
      )}
    </View>
  );
}
