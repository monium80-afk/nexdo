import { Feather } from "@expo/vector-icons";
import { useMemo, useRef, useState, type ComponentRef } from "react";
import { ScrollView, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
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

/** The days from `from` to `until`, by date; with `planAhead`, the repeats coming after today too. */
function plansBetween(tasks: Parameters<typeof buildSchedule>[0], from: LocalDate, until: LocalDate, planAhead = false): Map<LocalDate, DayPlan> {
  return new Map(buildSchedule(tasks, { now: new Date(), from, until, planAhead }).map((day) => [day.date, day]));
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

/** A round ‹ or › in the header: the week, month or year before or after. */
function StepButton({ icon, label, onPress }: { icon: "chevron-left" | "chevron-right"; label: string; onPress: () => void }) {
  return (
    <AnimatedPressable
      onPress={onPress}
      scaleTo={0.92}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-[40px] w-[40px] items-center justify-center rounded-full bg-chip"
    >
      <Feather name={icon} size={20} color={colors.palette.ink} />
    </AnimatedPressable>
  );
}

/**
 * The Calendar tab — the Schedule (redesigned 2026-11-08 from the user's
 * screenshots): Week, Month and Year views of the tasks due on each day
 * (lib/schedule.ts — a late one stays on the day it was due, in red).
 * - Week: the picked day's week as tiles; the picked day's tasks and routines.
 * - Month: the days as tiles, warmer the busier; the picked day's list.
 * - Year: each day a gem coloured by how much of it got done; a month opens
 *   in the Month view.
 * Each view moves back and forward (2026-11-14): the ‹ › in the header, or a
 * sideways swipe (left: the next one), and "Back to this …" once away.
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
  const thisMonth = Number(today.slice(5, 7));
  const [mode, setMode] = useState<ScheduleMode>("week");
  const [selected, setSelected] = useState<LocalDate>(today);
  // The year the Month and Year views show, and the Month view's month (1-based).
  const [year, setYear] = useState(thisYear);
  const [month, setMonth] = useState(thisMonth);

  // Week: the week of the picked day.
  const weekOf = weekStart(selected);
  const weekEnd = addDaysToKey(weekOf, 6);
  const week = Array.from({ length: 7 }, (_, index) => addDaysToKey(weekOf, index));
  // `today` too: what counts as "coming" moves on at midnight.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const weekPlans = useMemo(() => plansBetween(tasks, weekOf, weekEnd, true), [tasks, weekOf, weekEnd, today]);

  // Month and Year: worked out only while on screen.
  const monthFirst = `${year}-${pad(month)}-01`;
  const monthLast = `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`;
  const monthPlans = useMemo(
    () => (mode === "month" ? plansBetween(tasks, monthFirst, monthLast, true) : new Map<LocalDate, DayPlan>()),
    // `today` too: what counts as "coming" moves on at midnight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, tasks, monthFirst, monthLast, today],
  );
  const yearPlans = useMemo(
    () => (mode === "year" ? plansBetween(tasks, `${year}-01-01`, `${year}-12-31`) : new Map<LocalDate, DayPlan>()),
    [mode, tasks, year],
  );

  // The Calendar is for looking ahead: a task there can only be postponed.
  // Repeating tasks and finished ones have nothing to move, so nothing happens.
  const [postponeId, setPostponeId] = useState<string | null>(null);
  const openTask = (id: string) => {
    const task = tasks.find((entry) => entry.id === id);
    if (task && task.status === "pending" && !task.recurrence) setPostponeId(id);
  };

  // A month shown: on today if it's this month, else on its 1st.
  const showMonth = (shownYear: number, shownMonth: number) => {
    setYear(shownYear);
    setMonth(shownMonth);
    const prefix = `${shownYear}-${pad(shownMonth)}`;
    setSelected(today.startsWith(prefix) ? today : `${prefix}-01`);
  };

  // The Month view opens on the picked day's month; the Year view on its year.
  const handleModeChange = (next: ScheduleMode) => {
    if (next === "month") {
      setYear(Number(selected.slice(0, 4)));
      setMonth(Number(selected.slice(5, 7)));
    } else if (next === "year") {
      setYear(Number(selected.slice(0, 4)));
    }
    setMode(next);
  };

  // A month tapped in the year: open it.
  const handleOpenMonth = (picked: number) => {
    showMonth(year, picked);
    setMode("month");
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  // The week, month or year before (-1) or after (1). A week keeps its weekday picked.
  const step = (direction: -1 | 1) => {
    if (mode === "week") {
      setSelected((day) => addDaysToKey(day, direction * 7));
    } else if (mode === "month") {
      const index = year * 12 + (month - 1) + direction;
      showMonth(Math.floor(index / 12), (index % 12) + 1);
    } else {
      setYear(year + direction);
      setSelected(year + direction === thisYear ? today : `${year + direction}-01-01`);
    }
  };

  // Away from now: the way back, and its label.
  const away = mode === "week" ? weekOf !== weekStart(today) : mode === "month" ? year !== thisYear || month !== thisMonth : year !== thisYear;
  const backLabel = mode === "week" ? t.schedule.thisWeek : mode === "month" ? t.schedule.backToThisMonth : t.schedule.thisYear;
  const goBack = () => {
    if (mode === "week") setSelected(today);
    else if (mode === "month") showMonth(thisYear, thisMonth);
    else {
      setYear(thisYear);
      setSelected(today);
    }
  };
  const previousLabel = mode === "week" ? t.schedule.previousWeek : mode === "month" ? t.schedule.previousMonth : t.schedule.previousYear;
  const nextLabel = mode === "week" ? t.schedule.nextWeek : mode === "month" ? t.schedule.nextMonth : t.schedule.nextYear;

  // Sideways only, so the page still scrolls up and down; taps still reach the tiles.
  const swipe = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-20, 20])
    .failOffsetY([-12, 12])
    .onEnd((event) => {
      if (Math.abs(event.translationX) < 50 && Math.abs(event.velocityX) < 500) return;
      step((event.translationX || event.velocityX) < 0 ? 1 : -1);
    });

  const title =
    mode === "week"
      ? weekOf === weekStart(today)
        ? t.schedule.thisWeekTitle
        : t.schedule.weekOf(keyToLocalDate(weekOf).toLocaleDateString(t.locale, { month: "short", day: "numeric" }))
      : mode === "month"
        ? capitalize(keyToLocalDate(monthFirst).toLocaleDateString(t.locale, year === thisYear ? { month: "long" } : { month: "long", year: "numeric" }), t.locale)
        : String(year);
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
            <View className="mt-[2.6px] flex-row items-center gap-[10px]">
              <Text numberOfLines={1} className="shrink font-grotesk-regular text-[14px] leading-[18px] text-ink-muted" style={TIGHT_TEXT}>
                {subtitle}
              </Text>
              {away ? (
                <AnimatedPressable onPress={goBack} hitSlop={8} accessibilityRole="button">
                  <Text numberOfLines={1} className="font-grotesk-bold text-[14px] leading-[18px] text-accent-ink" style={TIGHT_TEXT}>
                    {backLabel}
                  </Text>
                </AnimatedPressable>
              ) : null}
            </View>
          </View>
          <View className="flex-row gap-[8px]">
            <StepButton icon="chevron-left" label={previousLabel} onPress={() => step(-1)} />
            <StepButton icon="chevron-right" label={nextLabel} onPress={() => step(1)} />
          </View>
        </View>

        <ModePills mode={mode} onChange={handleModeChange} />

        <GestureDetector gesture={swipe}>
          <View className="mt-[12.25px]">
            {mode === "week" ? (
              <ScheduleWeek week={week} plans={weekPlans} selected={selected} onSelect={setSelected} onOpenTask={openTask} />
            ) : mode === "month" ? (
              <ScheduleMonth year={year} month={month} plans={monthPlans} selected={selected} onSelect={setSelected} onOpenTask={openTask} />
            ) : (
              <ScheduleYear year={year} plans={yearPlans} today={today} onOpenMonth={handleOpenMonth} />
            )}
          </View>
        </GestureDetector>
      </ScrollView>
      <PostponeSheet taskId={postponeId} onClose={() => setPostponeId(null)} />
    </SafeAreaView>
  );
}
