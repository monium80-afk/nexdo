import { useAuth } from "@clerk/expo";
import { Redirect, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { IconButton } from "@/components/Button";
import { DoneScheduleRow, ScheduleItemRow, formatBudget } from "@/components/ScheduleItemRow";
import { ScreenHeader } from "@/components/ScreenHeader";
import { SectionHeader } from "@/components/SectionHeader";
import { gradients } from "@/constants/theme";
import { useScreenEnterAnimation } from "@/hooks/useScreenEnterAnimation";
import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDuration } from "@/lib/formatDuration";
import { addDaysToKey, keyToLocalDate, toLocalDateKey, type LocalDate } from "@/lib/localDate";
import { buildSchedule, weekStart } from "@/lib/schedule";
import { useTaskStore } from "@/store/useTaskStore";

/** How far ahead the week arrows go — past this a plan is mostly guesswork. */
const MAX_WEEKS_AHEAD = 12;

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

/**
 * The week, day by day: the tasks due on each day (lib/schedule.ts) — late
 * ones stay on the day they were due — and the ones already done. Opened from
 * the Today page's Schedule button. Nothing here is stored: change a task or
 * tick one off, and the days are worked out again.
 */
export function ScheduleView() {
  const colors = useColors();
  useStatusBarStyle("light");
  const t = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const enterStyle = useScreenEnterAnimation();
  const tasks = useTaskStore((state) => state.tasks);
  const completeTask = useTaskStore((state) => state.completeTask);
  const reopenTask = useTaskStore((state) => state.reopenTask);

  const today = toLocalDateKey(new Date());
  const thisWeek = weekStart(today);
  const [weekOf, setWeekOf] = useState(thisWeek);
  const [selected, setSelected] = useState<LocalDate>(today);

  const week = Array.from({ length: 7 }, (_, index) => addDaysToKey(weekOf, index));
  const weekEnd = addDaysToKey(weekOf, 6);
  const days = useMemo(() => buildSchedule(tasks, { now: new Date(), from: weekOf, until: weekEnd }), [tasks, weekOf, weekEnd]);
  const plans = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);

  const showWeek = (start: LocalDate) => {
    setWeekOf(start);
    setSelected(start === thisWeek ? today : start);
  };
  const lastWeek = addDaysToKey(thisWeek, 7 * MAX_WEEKS_AHEAD);

  const weekItems = days.reduce((sum, day) => sum + day.items.length, 0);
  const weekMinutes = days.reduce((sum, day) => sum + day.plannedMinutes, 0);

  const plan = plans.get(selected);
  const items = plan?.items ?? [];
  const done = plan?.done ?? [];
  const dayTitle =
    selected === today
      ? t.schedule.today
      : keyToLocalDate(selected).toLocaleDateString(t.locale, { weekday: "long", month: "short", day: "numeric" });

  const openTask = (id: string) => router.push({ pathname: "/task/[id]", params: { id } });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.charcoal[900] }} edges={["top"]}>
      <ScreenHeader
        title={t.schedule.title}
        subtitle={weekItems > 0 ? t.schedule.summary(weekItems, formatDuration(weekMinutes)) : undefined}
        actions={<IconButton icon="x" variant="header" onPress={() => router.back()} accessibilityLabel={t.common.close} />}
      >
        <View className="flex-row items-center gap-2">
            <IconButton
              icon="chevron-left"
              variant="header"
              onPress={() => showWeek(addDaysToKey(weekOf, -7))}
              accessibilityLabel={t.schedule.previousWeek}
            />
            <AnimatedPressable
              onPress={() => showWeek(thisWeek)}
              disabled={weekOf === thisWeek}
              accessibilityRole="button"
              accessibilityLabel={weekOf === thisWeek ? undefined : t.schedule.thisWeek}
              className="px-1"
            >
              <Text className="font-grotesk-bold text-[15px] text-ink-charcoal" numberOfLines={1}>
                {weekRange(weekOf, weekEnd, t.locale)}
              </Text>
            </AnimatedPressable>
            <IconButton
              icon="chevron-right"
              variant="header"
              onPress={() => showWeek(addDaysToKey(weekOf, 7))}
              disabled={weekOf >= lastWeek}
              accessibilityLabel={t.schedule.nextWeek}
            />
        </View>
      </ScreenHeader>

      <View className="screen-body">
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 28 }} showsVerticalScrollIndicator={false}>
          <Animated.View style={enterStyle} className="gap-4 px-4 pt-4">
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
          </Animated.View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
