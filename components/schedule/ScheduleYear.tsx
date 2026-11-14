import { memo } from "react";
import { Pressable, Text, View } from "react-native";

import { CARD_SHADOW, DARK_CARD_SHADOW, TIGHT_TEXT, taskCount } from "@/components/schedule/scheduleParts";
import { useTranslation } from "@/hooks/useTranslation";
import { gemLevelFor, type GemLevel } from "@/lib/gemLevel";
import { daysInMonth, keyToLocalDate, pad, weekdayOf, type LocalDate } from "@/lib/localDate";
import type { DayPlan } from "@/lib/schedule";

/** A day's gem by how much of it got done (lib/gemLevel.ts): Sleepy, Flicker, Steady, Glowing, Blazing. */
const GEM_COLORS: Record<GemLevel, string> = {
  1: "#000000",
  2: "#5C3A24",
  3: "#D9561C",
  4: "#FF8A3A",
  5: "#FFC93F",
};
/** A day gone by with no tasks, and a day still to come — on a light card, then on this month's dark one. */
const EMPTY = { light: "#EADFD1", dark: "#49423C" } as const;
const FUTURE = { light: "#F1E7DA", dark: "#3C3630" } as const;
/** The dark gems get a grey edge on the dark card, so they still show. */
const DARK_EDGE = "#6D665F";

const DOT = 6;
const ROTATE = [{ rotate: "45deg" }];

/** One day's diamond. */
function DayGem({ color, edged, today }: { color: string; edged: boolean; today: boolean }) {
  const dot = edged ? (
    <View style={{ width: DOT + 2, height: DOT + 2, borderRadius: 2, borderWidth: 1, borderColor: DARK_EDGE, backgroundColor: color }} />
  ) : (
    <View style={{ width: DOT, height: DOT, borderRadius: 1.5, backgroundColor: color }} />
  );
  // Today: a white ring around it.
  if (today) {
    return (
      <View style={{ width: 10, height: 10, borderRadius: 2.5, borderWidth: 1, borderColor: "#FFFFFF", alignItems: "center", justifyContent: "center", transform: ROTATE }}>
        {dot}
      </View>
    );
  }
  return <View style={{ transform: ROTATE }}>{dot}</View>;
}

/** One month: its name, and a diamond for each of its days in Monday-first weeks. */
const MonthCard = memo(function MonthCard({
  year,
  month,
  plans,
  today,
  onPress,
}: {
  year: number;
  /** 1-based. */
  month: number;
  plans: Map<LocalDate, DayPlan>;
  today: LocalDate;
  onPress: () => void;
}) {
  const t = useTranslation();
  const first = `${year}-${pad(month)}-01`;
  const lead = (weekdayOf(first) + 6) % 7;
  const cells: (LocalDate | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth(year, month) }, (_, index) => `${year}-${pad(month)}-${pad(index + 1)}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, row) => cells.slice(row * 7, row * 7 + 7));
  const current = today.startsWith(`${year}-${pad(month)}`);
  const tone = current ? "dark" : "light";
  const name = keyToLocalDate(first).toLocaleDateString(t.locale, { month: "short" }).replace(/\.$/, "");

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={keyToLocalDate(first).toLocaleDateString(t.locale, { month: "long", year: "numeric" })}
      className={`flex-1 rounded-[15px] px-[8px] pb-[7.25px] pt-[10.75px] ${current ? "bg-ink" : "bg-paper-card"}`}
      style={current ? DARK_CARD_SHADOW : CARD_SHADOW}
    >
      <Text
        className={`font-mono-bold text-[9.5px] uppercase leading-[12px] tracking-[1.4px] ${current ? "text-peach-on-dark" : "text-ink-muted"}`}
        style={TIGHT_TEXT}
      >
        {name}
      </Text>
      <View className="mt-[5.45px]">
        {weeks.map((week, weekIndex) => (
          <View key={weekIndex} className="h-[10px] flex-row">
            {week.map((date, dayIndex) => {
              if (!date) return <View key={`blank-${dayIndex}`} className="flex-1" />;
              const plan = plans.get(date);
              const total = taskCount(plan);
              const level = total > 0 ? gemLevelFor(plan?.done.length ?? 0, total) : null;
              const color = date > today ? FUTURE[tone] : level ? GEM_COLORS[level] : EMPTY[tone];
              return (
                <View key={date} className="flex-1 items-center justify-center">
                  <DayGem color={color} edged={current && date < today && (level === 1 || level === 2)} today={date === today} />
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </Pressable>
  );
});

const QUARTERS = [
  [1, 2, 3],
  [4, 5, 6],
  [7, 8, 9],
  [10, 11, 12],
];

/**
 * The Year view: the twelve months as small cards, three to a row, each day
 * a diamond in the colour of the gem it earned — how much of that day's tasks
 * got done (the Today page's gem). This month's card is the dark one; days to
 * come are faded. Tapping a month opens it in the Month view.
 */
export function ScheduleYear({
  year,
  plans,
  today,
  onOpenMonth,
}: {
  year: number;
  plans: Map<LocalDate, DayPlan>;
  today: LocalDate;
  onOpenMonth: (month: number) => void;
}) {
  const t = useTranslation();
  const key: { level: GemLevel; label: string }[] = [
    { level: 1, label: t.schedule.gemLevels.sleepy },
    { level: 2, label: t.schedule.gemLevels.flicker },
    { level: 3, label: t.schedule.gemLevels.steady },
    { level: 4, label: t.schedule.gemLevels.glowing },
    { level: 5, label: t.schedule.gemLevels.blazing },
  ];

  return (
    <View>
      <View className="gap-[8.5px] px-[1px]">
        {QUARTERS.map((months) => (
          <View key={months[0]} className="flex-row gap-[9.5px]">
            {months.map((month) => (
              <MonthCard key={month} year={year} month={month} plans={plans} today={today} onPress={() => onOpenMonth(month)} />
            ))}
          </View>
        ))}
      </View>

      <View className="mt-[8.25px] h-[18px] flex-row items-center justify-between pr-[2px]" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {key.map(({ level, label }) => (
          <View key={level} className="flex-row items-center gap-[5px]">
            {/* The rotated square fills its 10-point box corner to corner. */}
            <View className="h-[10px] w-[10px] items-center justify-center">
              <View style={{ width: 8.25, height: 8.25, borderRadius: 2, backgroundColor: GEM_COLORS[level], transform: ROTATE }} />
            </View>
            <Text className="font-grotesk-regular text-[11px] leading-[18px] text-ink-muted" style={TIGHT_TEXT}>
              {label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
