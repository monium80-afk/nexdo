import { useMemo, useRef, useState, type ComponentRef } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { PostponeSheet } from "@/components/schedule/PostponeSheet";
import { ScheduleMonth } from "@/components/schedule/ScheduleMonth";
import { ScheduleWeek } from "@/components/schedule/ScheduleWeek";
import { ScheduleYear } from "@/components/schedule/ScheduleYear";
import { TIGHT_TEXT, capitalize, taskCount } from "@/components/schedule/scheduleParts";
import { useTabBarHeight } from "@/components/TabBar";
import { colors } from "@/constants/theme";
import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";
import { useToday } from "@/hooks/useToday";
import { useTranslation } from "@/hooks/useTranslation";
import { addDaysToKey, daysInMonth, keyToLocalDate, pad, type LocalDate } from "@/lib/localDate";
import { buildSchedule, weekStart, type DayPlan } from "@/lib/schedule";
import { useTaskStore } from "@/store/useTaskStore";

type ScheduleMode = "week" | "month" | "year";

/** "Oct 5 – 11", or "Oct 26 – Nov 1" across a month. */
function weekRange(start: LocalDate, end: LocalDate, locale: string): string {
  const from = keyToLocalDate(start);
  const to = keyToLocalDate(end);
  const left = from.toLocaleDateString(locale, { month: "short", day: "numeric" });
  const right = to.toLocaleDateString(locale, from.getMonth() === to.getMonth() ? { day: "numeric" } : { month: "short", day: "numeric" });
  return `${left} – ${right}`;
}

/** The days from `from` to `until`, by date. */
function plansBetween(tasks: Parameters<typeof buildSchedule>[0], from: LocalDate, until: LocalDate): Map<LocalDate, DayPlan> {
  return new Map(buildSchedule(tasks, { now: new Date(), from, until }).map((day) => [day.date, day]));
}

/** Week | Month | Year: the picked one dark, the others on the chip colour. */
function ModePills({ mode, onChange }: { mode: ScheduleMode; onChange: (mode: ScheduleMode) => void }) {
  const t = useTranslation();
  const options: { value: ScheduleMode; label: string }[] = [
    { value: "week", label: t.schedule.week },
    { value: "month", label: t.schedule.month },
    { value: "year", label: t.schedule.year },
  ];
  return (
    <View className="mt-[13.3px] flex-row gap-[8px]" accessibilityRole="tablist">
      {options.map((option) => {
        const picked = option.value === mode;
        return (
          <AnimatedPressable
            key={option.value}
            onPress={() => onChange(option.value)}
            scaleTo={0.96}
            accessibilityRole="tab"
            accessibilityState={{ selected: picked }}
            className={`h-[40px] justify-center rounded-full px-[16.5px] pt-[2px] ${picked ? "bg-ink" : "bg-chip"}`}
          >
            <Text
              className={`text-[14px] leading-[18px] ${picked ? "font-grotesk-bold tracking-[-0.3px] text-white" : "font-grotesk-medium tracking-[-0.2px] text-ink"}`}
              style={TIGHT_TEXT}
            >
              {option.label}
            </Text>
          </AnimatedPressable>
        );
      })}
    </View>
  );
}

/**
 * The Calendar tab — the Schedule (redesigned 2026-11-08 from the user's
 * screenshots): Week, Month and Year views of the tasks due on each day
 * (lib/schedule.ts — a late one stays on the day it was due, in red).
 * - Week: this week's days as tiles; the picked day's tasks and routines.
 * - Month: the days as tiles, warmer the busier; the picked day's list.
 * - Year: each day a gem coloured by how much of it got done; a month opens
 *   in the Month view.
 * Nothing here is stored: change a task or tick one off, and the days are
 * worked out again.
 */
export default function CalendarTab() {
  useStatusBarStyle("dark");
  const t = useTranslation();
  const tabBarHeight = useTabBarHeight();
  const tasks = useTaskStore((state) => state.tasks);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);

  // The day the page is for; it moves on at midnight and on coming back to the app.
  const today = useToday();
  const thisYear = Number(today.slice(0, 4));
  const [mode, setMode] = useState<ScheduleMode>("week");
  const [selected, setSelected] = useState<LocalDate>(today);
  // The month the Month view shows (1-based), in this year.
  const [month, setMonth] = useState(Number(today.slice(5, 7)));

  // Week: the week of the picked day.
  const weekOf = weekStart(selected);
  const weekEnd = addDaysToKey(weekOf, 6);
  const week = Array.from({ length: 7 }, (_, index) => addDaysToKey(weekOf, index));
  const weekPlans = useMemo(() => plansBetween(tasks, weekOf, weekEnd), [tasks, weekOf, weekEnd]);

  // Month and Year: worked out only while on screen.
  const monthFirst = `${thisYear}-${pad(month)}-01`;
  const monthLast = `${thisYear}-${pad(month)}-${pad(daysInMonth(thisYear, month))}`;
  const monthPlans = useMemo(
    () => (mode === "month" ? plansBetween(tasks, monthFirst, monthLast) : new Map<LocalDate, DayPlan>()),
    [mode, tasks, monthFirst, monthLast],
  );
  const yearPlans = useMemo(
    () => (mode === "year" ? plansBetween(tasks, `${thisYear}-01-01`, `${thisYear}-12-31`) : new Map<LocalDate, DayPlan>()),
    [mode, tasks, thisYear],
  );

  // The Calendar is for looking ahead: a task there can only be postponed.
  // Repeating tasks and finished ones have nothing to move, so nothing happens.
  const [postponeId, setPostponeId] = useState<string | null>(null);
  const openTask = (id: string) => {
    const task = tasks.find((entry) => entry.id === id);
    if (task && task.status === "pending" && !task.recurrence) setPostponeId(id);
  };

  // The Month view opens on the picked day's month, when that's in this year.
  const handleModeChange = (next: ScheduleMode) => {
    if (next === "month" && selected.startsWith(String(thisYear))) setMonth(Number(selected.slice(5, 7)));
    setMode(next);
  };

  // A month tapped in the year: open it, on today if it's this month, else on its 1st.
  const handleOpenMonth = (picked: number) => {
    setMonth(picked);
    setSelected(today.startsWith(`${thisYear}-${pad(picked)}`) ? today : `${thisYear}-${pad(picked)}-01`);
    setMode("month");
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const title =
    mode === "week"
      ? weekOf === weekStart(today)
        ? t.schedule.thisWeekTitle
        : t.schedule.weekOf(keyToLocalDate(weekOf).toLocaleDateString(t.locale, { month: "short", day: "numeric" }))
      : mode === "month"
        ? capitalize(keyToLocalDate(monthFirst).toLocaleDateString(t.locale, { month: "long" }), t.locale)
        : String(thisYear);
  const monthTotal = useMemo(() => [...monthPlans.values()].reduce((sum, day) => sum + taskCount(day), 0), [monthPlans]);
  const subtitle =
    mode === "week" ? weekRange(weekOf, weekEnd, t.locale) : mode === "month" ? t.schedule.monthTasks(monthTotal) : t.schedule.yearSubtitle;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.palette.paper }} edges={["top"]}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: tabBarHeight + 28 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row items-center justify-between gap-3 pt-[9.6px]">
          <View className="shrink">
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              className="font-grotesk-bold text-[30px] leading-[36px] tracking-[-0.6px] text-ink"
              style={TIGHT_TEXT}
            >
              {title}
            </Text>
            <Text numberOfLines={1} className="mt-[2.6px] font-grotesk-regular text-[14px] leading-[18px] text-ink-muted" style={TIGHT_TEXT}>
              {subtitle}
            </Text>
          </View>
        </View>

        <ModePills mode={mode} onChange={handleModeChange} />

        <View className="mt-[12.25px]">
          {mode === "week" ? (
            <ScheduleWeek week={week} plans={weekPlans} selected={selected} onSelect={setSelected} onOpenTask={openTask} />
          ) : mode === "month" ? (
            <ScheduleMonth year={thisYear} month={month} plans={monthPlans} selected={selected} onSelect={setSelected} onOpenTask={openTask} />
          ) : (
            <ScheduleYear year={thisYear} plans={yearPlans} today={today} onOpenMonth={handleOpenMonth} />
          )}
        </View>
      </ScrollView>
      <PostponeSheet taskId={postponeId} onClose={() => setPostponeId(null)} />
    </SafeAreaView>
  );
}
