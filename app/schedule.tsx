import { useAuth } from "@clerk/expo";
import { Redirect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { IconButton } from "@/components/Button";
import { DoneScheduleRow, ScheduleItemRow, formatBudget } from "@/components/ScheduleItemRow";
import { ScheduleYear } from "@/components/ScheduleYear";
import { ScreenHeader } from "@/components/ScreenHeader";
import { SectionHeader } from "@/components/SectionHeader";
import { gradients } from "@/constants/theme";
import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDuration } from "@/lib/formatDuration";
import { addDaysToKey, keyToLocalDate, toLocalDateKey, type LocalDate } from "@/lib/localDate";
import { buildSchedule, weekStart } from "@/lib/schedule";
import { useTaskStore } from "@/store/useTaskStore";

type ScheduleMode = "week" | "year";

/** "Oct 5 – 11", or "Sep 28 – Oct 4" across a month. */
function weekRange(start: LocalDate, end: LocalDate, locale: string): string {
  const from = keyToLocalDate(start);
  const to = keyToLocalDate(end);
  const left = from.toLocaleDateString(locale, { month: "short", day: "numeric" });
  const right = to.toLocaleDateString(locale, from.getMonth() === to.getMonth() ? { day: "numeric" } : { month: "short", day: "numeric" });
  return `${left} – ${right}`;
}

// A direct link skips the tabs' sign-in check, so this page checks for itself.
export default function ScheduleScreen() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/onboarding" />;
  return <ScheduleView />;
}

/** Week | Year, on the header's charcoal. */
function ModeSwitch({ mode, onChange }: { mode: ScheduleMode; onChange: (mode: ScheduleMode) => void }) {
  const t = useTranslation();
  const options: { value: ScheduleMode; label: string }[] = [
    { value: "week", label: t.schedule.week },
    { value: "year", label: t.schedule.year },
  ];
  return (
    <View className="glass flex-row rounded-full p-[3px]" accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option.value === mode;
        return (
          <AnimatedPressable
            key={option.value}
            onPress={() => onChange(option.value)}
            scaleTo={0.96}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={selected ? gradients.accent : undefined}
            className={`rounded-full px-3.5 py-1.5 ${selected ? "bg-orange-500" : ""}`}
          >
            <Text className={`font-grotesk-bold text-[13px] ${selected ? "text-on-accent" : "text-ink-charcoal-muted"}`}>
              {option.label}
            </Text>
          </AnimatedPressable>
        );
      })}
    </View>
  );
}

/**
 * The week, day by day: the tasks due on each day (lib/schedule.ts) — late
 * ones stay on the day they were due — and the ones already done. "Year"
 * widens it to the whole year as a calendar; picking a day there opens it in
 * the week. Opened from the Today page's Schedule button. Nothing here is
 * stored: change a task or tick one off, and the days are worked out again.
 */
export function ScheduleView() {
  const colors = useColors();
  useStatusBarStyle("light");
  const t = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tasks = useTaskStore((state) => state.tasks);
  const completeTask = useTaskStore((state) => state.completeTask);
  const reopenTask = useTaskStore((state) => state.reopenTask);

  const today = toLocalDateKey(new Date());
  const thisWeek = weekStart(today);
  const thisYear = Number(today.slice(0, 4));
  const [mode, setMode] = useState<ScheduleMode>("week");
  const [weekOf, setWeekOf] = useState(thisWeek);
  const [selected, setSelected] = useState<LocalDate>(today);
  const [year, setYear] = useState(thisYear);

  const week = Array.from({ length: 7 }, (_, index) => addDaysToKey(weekOf, index));
  const weekEnd = addDaysToKey(weekOf, 6);
  const days = useMemo(() => buildSchedule(tasks, { now: new Date(), from: weekOf, until: weekEnd }), [tasks, weekOf, weekEnd]);
  const plans = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);
  // The whole year, only while it's on screen.
  const yearDays = useMemo(
    () => (mode === "year" ? buildSchedule(tasks, { now: new Date(), from: `${year}-01-01`, until: `${year}-12-31` }) : []),
    [mode, tasks, year],
  );

  const showWeek = (start: LocalDate) => {
    setWeekOf(start);
    setSelected(start === thisWeek ? today : start);
  };

  // The year opens on the year of the week being looked at.
  const handleModeChange = (next: ScheduleMode) => {
    if (next === "year") setYear(Number(selected.slice(0, 4)));
    setMode(next);
  };

  // A day picked on the year's calendar: back to the week, on that day — at
  // the top of the page, not wherever the year had been scrolled to.
  const scrollRef = useRef<ScrollView>(null);
  const handlePickDay = useCallback((date: LocalDate) => {
    setWeekOf(weekStart(date));
    setSelected(date);
    setMode("week");
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, []);

  // The year is one long column of months, so it opens on the one that
  // matters: the picked day's month in its year, this month in this year,
  // January in any other.
  const focusMonth =
    year === Number(selected.slice(0, 4)) ? Number(selected.slice(5, 7)) : year === thisYear ? Number(today.slice(5, 7)) : 1;
  const handleFocusMonthY = useCallback((y: number) => {
    scrollRef.current?.scrollTo({ y: Math.max(0, y), animated: false });
  }, []);

  const shown = mode === "year" ? yearDays : days;
  const shownItems = shown.reduce((sum, day) => sum + day.items.length, 0);
  const shownMinutes = shown.reduce((sum, day) => sum + day.plannedMinutes, 0);

  const plan = plans.get(selected);
  const items = plan?.items ?? [];
  const done = plan?.done ?? [];
  const dayTitle =
    selected === today
      ? t.schedule.today
      : keyToLocalDate(selected).toLocaleDateString(t.locale, { weekday: "long", month: "short", day: "numeric" });

  const openTask = (id: string) => router.push({ pathname: "/task/[id]", params: { id } });

  // Back and forth a week at a time, or a year at a time.
  const isHome = mode === "year" ? year === thisYear : weekOf === thisWeek;
  const goHome = () => (mode === "year" ? setYear(thisYear) : showWeek(thisWeek));
  const step = (direction: 1 | -1) =>
    mode === "year" ? setYear((current) => current + direction) : showWeek(addDaysToKey(weekOf, 7 * direction));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.charcoal[900] }} edges={["top"]}>
      <ScreenHeader
        title={t.schedule.title}
        subtitle={
          shownItems === 0
            ? undefined
            : shownMinutes > 0
              ? t.schedule.summary(shownItems, formatDuration(shownMinutes))
              : t.schedule.summaryCount(shownItems)
        }
        actions={<IconButton icon="x" variant="header" onPress={() => router.back()} accessibilityLabel={t.common.close} />}
      >
        <View className="flex-row items-center justify-between gap-2">
          <View className="shrink flex-row items-center gap-2">
            <IconButton
              icon="chevron-left"
              variant="header"
              onPress={() => step(-1)}
              accessibilityLabel={mode === "year" ? t.schedule.previousYear : t.schedule.previousWeek}
            />
            <AnimatedPressable
              onPress={goHome}
              disabled={isHome}
              accessibilityRole="button"
              accessibilityLabel={isHome ? undefined : mode === "year" ? t.schedule.thisYear : t.schedule.thisWeek}
              className="shrink px-1"
            >
              <Text className="font-grotesk-bold text-[15px] text-ink-charcoal" numberOfLines={1}>
                {mode === "year" ? String(year) : weekRange(weekOf, weekEnd, t.locale)}
              </Text>
            </AnimatedPressable>
            <IconButton
              icon="chevron-right"
              variant="header"
              onPress={() => step(1)}
              accessibilityLabel={mode === "year" ? t.schedule.nextYear : t.schedule.nextWeek}
            />
          </View>
          <ModeSwitch mode={mode} onChange={handleModeChange} />
        </View>
      </ScreenHeader>

      <View className="screen-body">
        <ScrollView ref={scrollRef} contentContainerStyle={{ paddingBottom: insets.bottom + 28 }} showsVerticalScrollIndicator={false}>
          {mode === "year" ? (
            <View className="px-4 pt-4">
              {/* Keyed by year: a new year lays its months out afresh, which
                  is what scrolls it to its focus month. */}
              <ScheduleYear
                key={year}
                year={year}
                plans={yearDays}
                today={today}
                selected={selected}
                onPickDay={handlePickDay}
                focusMonth={focusMonth}
                onFocusMonthY={handleFocusMonthY}
              />
            </View>
          ) : (
          <View className="gap-4 px-4 pt-4">
            {/* The week: pick a day. A dot under each day with something on
                it — red for tasks left late, orange for tasks to come, grey
                once all of the day's are done. */}
            <View className="card card--cream-soft flex-row justify-between p-1.5" style={gradients.card}>
              {week.map((date) => {
                const isSelected = date === selected;
                const isToday = date === today;
                const day = plans.get(date);
                const hasOpen = (day?.items.length ?? 0) > 0;
                const hasLate = hasOpen && date < today;
                const hasDone = !hasOpen && (day?.done.length ?? 0) > 0;
                const label = keyToLocalDate(date);
                return (
                  <AnimatedPressable
                    key={date}
                    onPress={() => setSelected(date)}
                    scaleTo={0.94}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={label.toLocaleDateString(t.locale, { weekday: "long", month: "long", day: "numeric" })}
                    style={isSelected ? gradients.accent : undefined}
                    className={`flex-1 items-center gap-0.5 rounded-[14px] pb-2 pt-2 ${isSelected ? "glow-accent bg-orange-500" : ""}`}
                  >
                    <Text
                      className={`font-grotesk-semibold text-[11px] uppercase ${
                        isSelected ? "text-on-accent" : isToday ? "text-orange-600" : "text-ink-cream-muted"
                      }`}
                    >
                      {label.toLocaleDateString(t.locale, { weekday: "short" })}
                    </Text>
                    <Text
                      className={`font-grotesk-bold text-[17px] ${
                        isSelected ? "text-on-accent" : isToday ? "text-orange-600" : "text-ink-cream"
                      }`}
                    >
                      {label.toLocaleDateString(t.locale, { day: "numeric" })}
                    </Text>
                    <View
                      className={`mt-0.5 h-[5px] w-[5px] rounded-full ${
                        hasLate
                          ? isSelected
                            ? "bg-cream-50"
                            : "bg-overdue-500"
                          : hasOpen
                            ? isSelected
                              ? "bg-cream-50"
                              : "bg-orange-500"
                            : hasDone
                              ? isSelected
                                ? "bg-cream-50"
                                : "bg-cream-300"
                              : ""
                      }`}
                    />
                  </AnimatedPressable>
                );
              })}
            </View>

            <View className="gap-2.5">
              <View className="px-1">
                <SectionHeader
                  icon={selected === today ? "sun" : "calendar"}
                  label={dayTitle}
                  hint={plan && plan.plannedMinutes > 0 ? formatBudget(plan.plannedMinutes, t) : undefined}
                />
              </View>

              {items.map((item) => (
                <ScheduleItemRow
                  key={item.task.id}
                  item={item}
                  onPress={() => openTask(item.task.id)}
                  onComplete={() => completeTask(item.task.id)}
                />
              ))}

              {items.length === 0 && done.length === 0 ? (
                <View className="card card--cream-muted items-center px-4 py-5">
                  <Text className="font-grotesk-medium text-sm text-ink-cream-muted">{t.schedule.nothingDue}</Text>
                </View>
              ) : null}

              {done.length > 0 ? (
                <>
                  {items.length > 0 ? (
                    <View className="px-1 pt-1.5">
                      <SectionHeader icon="check" label={t.schedule.done} />
                    </View>
                  ) : null}
                  {done.map((task) => (
                    <DoneScheduleRow
                      key={task.id}
                      task={task}
                      onPress={() => openTask(task.id)}
                      onReopen={() => reopenTask(task.id)}
                    />
                  ))}
                </>
              ) : null}
            </View>
          </View>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
