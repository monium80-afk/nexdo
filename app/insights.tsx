import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { useMemo, useState, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { GemGlow, GemMascot } from "@/components/GemMascot";
import { colors } from "@/constants/theme";
import { shadow, SOFT_SHADOW } from "@/constants/shadow";
import { useAiLocked } from "@/hooks/useAiLocked";
import { useRtlText } from "@/hooks/useRtlText";
import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";
import { useToday } from "@/hooks/useToday";
import { useTranslation } from "@/hooks/useTranslation";
import { gemLevelFor, type GemLevel } from "@/lib/gemLevel";
import { addDaysToKey, keyToLocalDate, type LocalDate } from "@/lib/localDate";
import { buildInsights, completionDays, computePace, isOnPace, MIN_PACE_SAMPLES, paceSamples, type InsightsBar, type InsightsRange } from "@/lib/pace";
import { openPaywall } from "@/lib/paywall";
import { posthog } from "@/lib/posthog";
import { buildSchedule, buildToday } from "@/lib/schedule";
import { entriesFor, useFocusLogStore } from "@/store/useFocusLogStore";
import { useTaskStore } from "@/store/useTaskStore";
import type { Task } from "@/types/task";

// A direct link skips the tabs' sign-in check, so this page checks for itself.
export default function InsightsScreen() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/onboarding" />;
  return <InsightsView />;
}

const P = colors.palette;
const TIGHT = { includeFontPadding: false } as const;
const DIAMOND = { transform: [{ rotate: "45deg" }] };
const DARK_SHADOW = shadow("0 10px 24px rgba(34, 28, 23, 0.25)", 8);
/** On the dark card. */
const ON_DARK = "#D5C9BD";
const ON_DARK_FAINT = "#8A7F76";
const ON_DARK_RULE = "#3A322C";
/** The chart's bars: peach, this week/day in full orange, a flat line for none. */
const BAR = "#F6BC9A";
const BAR_EMPTY = "#EADFD1";
const CHART_HEIGHT = 124;
/** A day's gem, by how much of it got done (as on the Schedule's Year view). */
const GEM_COLORS: Record<GemLevel, string> = { 1: "#000000", 2: "#5C3A24", 3: "#D9561C", 4: "#FF8A3A", 5: "#FFC93F" };
const NO_TASKS = "#49423C";
const LEVELS: GemLevel[] = [1, 2, 3, 4, 5];

/** "1h 20m", "45m", "0m". */
function useBudget() {
  const t = useTranslation();
  return (minutes: number) => t.format.budget(Math.floor(minutes / 60), Math.round(minutes % 60));
}

function Eyebrow({ children, color = P.inkMuted }: { children: ReactNode; color?: string }) {
  return <Text style={[{ fontFamily: "SpaceMono-Bold", fontSize: 10, lineHeight: 13, letterSpacing: 2, color }, TIGHT]}>{children}</Text>;
}

function Gem({ level, size = 13 }: { level: GemLevel | null; size?: number }) {
  return <View style={[{ width: size, height: size, borderRadius: 2.5, backgroundColor: level ? GEM_COLORS[level] : NO_TASKS }, DIAMOND]} />;
}

/** The longest run of days in a row with a finished task. */
function bestStreak(completions: { taskId: string; userId: string | null; at: string }[], tasks: Task[]): number {
  const days = [...new Set(completionDays(completions, tasks))].sort();
  let best = 0;
  let run = 0;
  days.forEach((day, index) => {
    run = index > 0 && addDaysToKey(days[index - 1], 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return best;
}

/** Each day's gem from `from` to `until`: how much of that day's tasks got done, or null for a day without tasks. */
function dayLevels(tasks: Task[], from: LocalDate, until: LocalDate): Map<LocalDate, GemLevel | null> {
  const levels = new Map<LocalDate, GemLevel | null>();
  if (from > until) return levels;
  for (const day of buildSchedule(tasks, { now: new Date(), from, until })) {
    const total = day.items.length + day.done.length;
    levels.set(day.date, total > 0 ? gemLevelFor(day.done.length, total) : null);
  }
  return levels;
}

function RangeSwitch({ range, locked, onChange }: { range: InsightsRange; locked: boolean; onChange: (range: InsightsRange) => void }) {
  const t = useTranslation();
  const options: { value: InsightsRange; label: string }[] = [
    { value: "week", label: t.insights.week },
    { value: "all", label: t.insights.all },
  ];
  return (
    <View style={{ flexDirection: "row", height: 44, borderRadius: 22, padding: 4, backgroundColor: P.chip }} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option.value === range;
        const isLocked = locked && option.value === "all";
        return (
          <AnimatedPressable
            key={option.value}
            onPress={() => (isLocked ? openPaywall("insights") : onChange(option.value))}
            scaleTo={0.97}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={isLocked ? `${option.label} — ${t.plan.proOnly}` : option.label}
            style={{ flex: 1, borderRadius: 18, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", backgroundColor: selected ? P.ink : "transparent" }}
          >
            <Text style={[{ fontFamily: "SpaceGrotesk-Bold", fontSize: 14.5, color: selected ? "#FFFFFF" : P.ink }, TIGHT]}>{option.label}</Text>
            {isLocked ? <Feather name="lock" size={12} color={P.inkMuted} /> : null}
          </AnimatedPressable>
        );
      })}
    </View>
  );
}

/** One of the three numbers in the stats card. */
function Stat({ value, label, divider }: { value: string; label: string; divider: boolean }) {
  return (
    <View style={{ flex: 1, alignItems: "center", gap: 6, borderLeftWidth: divider ? 1 : 0, borderLeftColor: BAR_EMPTY }}>
      <Text numberOfLines={1} adjustsFontSizeToFit style={[{ fontFamily: "SpaceGrotesk-Bold", fontSize: 24, letterSpacing: -0.5, color: P.ink }, TIGHT]}>
        {value}
      </Text>
      <Text numberOfLines={1} style={[{ fontFamily: "SpaceGrotesk-Regular", fontSize: 12.5, color: P.inkMuted }, TIGHT]}>
        {label}
      </Text>
    </View>
  );
}

/** Focus time per bar: days (last 7 days) or weeks (all time); the latest in full orange. */
function FocusChart({ bars, range, total }: { bars: InsightsBar[]; range: InsightsRange; total: number }) {
  const t = useTranslation();
  const budget = useBudget();
  const max = Math.max(...bars.map((bar) => bar.focusMinutes), 0);
  const best = max > 0 ? bars.reduce((top, bar) => (bar.focusMinutes > top.focusMinutes ? bar : top), bars[0]) : null;
  const short = (key: LocalDate) => keyToLocalDate(key).toLocaleDateString(t.locale, { month: "short", day: "numeric" });
  const bestLabel = best
    ? range === "week"
      ? keyToLocalDate(best.start).toLocaleDateString(t.locale, { weekday: "short" })
      : short(best.start)
    : null;
  const totalText = t.insights.focusTotal(Math.floor(total / 60), Math.round(total % 60));
  const week = range === "week";
  const barWidth = week ? 26 : undefined;

  return (
    <View style={[{ borderRadius: 24, backgroundColor: P.paperCard, paddingTop: 18, paddingHorizontal: 16, paddingBottom: 16 }, SOFT_SHADOW]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Eyebrow>{t.insights.focusChart.toUpperCase()}</Eyebrow>
        {bestLabel ? (
          <Text numberOfLines={1} style={[{ flexShrink: 1, fontFamily: "SpaceGrotesk-Regular", fontSize: 13, color: P.inkMuted }, TIGHT]}>
            {`${week ? t.insights.bestDay : t.insights.bestWeek} · `}
            <Text style={{ fontFamily: "SpaceGrotesk-Bold", color: P.ink }}>{bestLabel}</Text>
          </Text>
        ) : null}
      </View>
      <View style={{ marginTop: 14, flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <Text style={[{ fontFamily: "SpaceGrotesk-Bold", fontSize: 30, letterSpacing: -0.8, color: P.ink }, TIGHT]}>{totalText}</Text>
        <Text style={[{ fontFamily: "SpaceGrotesk-Regular", fontSize: 13.5, color: P.inkMuted }, TIGHT]}>
          {week ? t.insights.thisWeekLower : t.insights.since(short(bars[0].start))}
        </Text>
      </View>

      <View style={{ marginTop: 20, height: CHART_HEIGHT, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: week ? 0 : 6 }}>
        {bars.map((bar, index) => {
          const latest = index === bars.length - 1;
          const height = bar.focusMinutes > 0 && max > 0 ? Math.max(14, (bar.focusMinutes / max) * CHART_HEIGHT) : 5;
          return (
            <View
              key={bar.start}
              accessibilityLabel={t.insights.barSummary(short(bar.start), budget(bar.focusMinutes), bar.tasksDone)}
              style={{
                width: barWidth,
                flex: week ? undefined : 1,
                height,
                borderRadius: week ? 13 : 9,
                backgroundColor: bar.focusMinutes === 0 ? BAR_EMPTY : latest ? P.accent : BAR,
              }}
            />
          );
        })}
      </View>

      {week ? (
        <View style={{ marginTop: 10, flexDirection: "row", justifyContent: "space-between" }}>
          {bars.map((bar, index) => (
            <Text
              key={bar.start}
              style={[
                { width: 26, textAlign: "center", fontSize: 12, fontFamily: index === bars.length - 1 ? "SpaceGrotesk-Bold" : "SpaceGrotesk-Medium", color: index === bars.length - 1 ? P.ink : P.inkMuted },
                TIGHT,
              ]}
            >
              {keyToLocalDate(bar.start).toLocaleDateString(t.locale, { weekday: "narrow" })}
            </Text>
          ))}
        </View>
      ) : (
        <View style={{ marginTop: 10, flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={[{ fontFamily: "SpaceGrotesk-Medium", fontSize: 12, color: P.inkMuted }, TIGHT]}>{short(bars[0].start)}</Text>
          {bars.length > 2 ? (
            <Text style={[{ fontFamily: "SpaceGrotesk-Medium", fontSize: 12, color: P.inkMuted }, TIGHT]}>{short(bars[Math.floor(bars.length / 2)].start)}</Text>
          ) : null}
          <Text style={[{ fontFamily: "SpaceGrotesk-Bold", fontSize: 12, color: P.ink }, TIGHT]}>{t.insights.thisWeek}</Text>
        </View>
      )}
    </View>
  );
}

/**
 * Insights (2026-11 redesign, from the user's screenshots): today's gem and
 * the days behind it, three numbers, focus time as a chart, and sessions next
 * to "your pace". Last 7 days on every plan, all of it on Pro. Built on the
 * phone from the focus log and the task list; nothing is sent anywhere.
 */
function InsightsView() {
  useStatusBarStyle("dark");
  const t = useTranslation();
  const rtl = useRtlText();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const budget = useBudget();
  const locked = useAiLocked();
  const today = useToday();
  const [range, setRange] = useState<InsightsRange>("week");

  const userId = useTaskStore((state) => state.syncUserId);
  const tasks = useTaskStore((state) => state.tasks);
  const allEntries = useFocusLogStore((state) => state.entries);
  const allCompletions = useFocusLogStore((state) => state.completions);
  const entries = useMemo(() => entriesFor(allEntries, userId), [allEntries, userId]);
  const completions = useMemo(() => entriesFor(allCompletions, userId), [allCompletions, userId]);

  const shownRange: InsightsRange = locked ? "week" : range;
  const week = shownRange === "week";
  const insights = useMemo(() => buildInsights(entries, completions, tasks, shownRange), [entries, completions, tasks, shownRange]);
  const pace = useMemo(() => computePace(entries), [entries]);
  const finishedInSession = useMemo(() => paceSamples(entries).length, [entries]);
  const longestStreak = useMemo(() => bestStreak(completions, tasks), [completions, tasks]);

  // Today's gem, as on the Today page, and the count under it.
  const todayList = useMemo(() => buildToday(tasks, { now: new Date(), today }), [tasks, today]);
  const todayTotal = todayList.done + todayList.ids.size;
  const gemLevel: GemLevel = todayTotal > 0 ? gemLevelFor(todayList.done, todayTotal) : 3;
  // How many more tasks until the gem moves up a level.
  let nextStep: { more: number; level: GemLevel } | null = null;
  for (let more = 1; todayTotal > 0 && gemLevel < 5 && more <= todayList.ids.size; more += 1) {
    const level = gemLevelFor(todayList.done + more, todayTotal);
    if (level > gemLevel) {
      nextStep = { more, level };
      break;
    }
  }
  const levelName = (level: GemLevel) =>
    [t.schedule.gemLevels.sleepy, t.schedule.gemLevels.flicker, t.schedule.gemLevels.steady, t.schedule.gemLevels.glowing, t.schedule.gemLevels.blazing][level - 1];
  const gemLine =
    todayTotal === 0
      ? t.insights.nothingDue
      : gemLevel === 5
        ? t.insights.allDone
        : nextStep
          ? t.insights.nextHint(nextStep.more, nextStep.level, levelName(nextStep.level))
          : "";

  // Every day's gem: the last 7 days, or every day since the first task was due.
  const firstDay = useMemo(() => {
    const dates = tasks.map((task) => task.deadline?.date).filter((date): date is string => !!date && date <= today);
    return dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : today;
  }, [tasks, today]);
  const levels = useMemo(
    () => dayLevels(tasks, week ? addDaysToKey(today, -6) : firstDay, today),
    [tasks, week, today, firstDay],
  );
  const levelCounts = useMemo(() => {
    const counts: Record<GemLevel, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    levels.forEach((level) => {
      if (level) counts[level] += 1;
    });
    return counts;
  }, [levels]);
  const daysCounted = LEVELS.reduce((sum, level) => sum + levelCounts[level], 0);
  const lastSeven = Array.from({ length: 7 }, (_, index) => addDaysToKey(today, index - 6));

  const handleRange = (next: InsightsRange) => {
    if (next !== range) posthog.capture("insights_range", { range: next });
    setRange(next);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: P.paper }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: insets.bottom + 28 }} showsVerticalScrollIndicator={false}>
        {/* Title, and the way out. */}
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={[{ fontFamily: "SpaceGrotesk-Bold", fontSize: 29, lineHeight: 34, letterSpacing: -0.6, color: P.ink }, TIGHT, rtl]}>{t.insights.title}</Text>
            <Text style={[{ marginTop: 4, fontFamily: "SpaceGrotesk-Regular", fontSize: 13.5, color: P.inkMuted }, TIGHT, rtl]}>{t.insights.subtitle}</Text>
          </View>
          <AnimatedPressable
            onPress={() => router.back()}
            scaleTo={0.92}
            accessibilityRole="button"
            accessibilityLabel={t.common.close}
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: P.chip, alignItems: "center", justifyContent: "center" }}
          >
            <Feather name="x" size={19} color={P.ink} />
          </AnimatedPressable>
        </View>

        <View style={{ marginTop: 16 }}>
          <RangeSwitch range={shownRange} locked={locked} onChange={handleRange} />
        </View>

        {/* Today's gem, then its days: the last seven, or how many of each so far. */}
        <View style={[{ marginTop: 14, borderRadius: 24, backgroundColor: P.ink, paddingTop: 20, paddingHorizontal: 18, paddingBottom: 18 }, DARK_SHADOW]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
            <View style={{ width: 60, height: 60, alignItems: "center", justifyContent: "center" }}>
              {gemLevel >= 3 ? (
                <View style={{ position: "absolute", left: -20, top: -20 }}>
                  <GemGlow size={100} animate={false} />
                </View>
              ) : null}
              <GemMascot level={gemLevel} width={50} animate={false} />
            </View>
            <View style={{ flex: 1, gap: 5 }}>
              <Eyebrow color="#B8ACA0">{`${t.insights.today.toUpperCase()} · ${levelName(gemLevel).toUpperCase()}`}</Eyebrow>
              {todayTotal > 0 ? (
                <Text style={[{ fontFamily: "SpaceGrotesk-Bold", fontSize: 19, lineHeight: 23, color: "#FFFFFF" }, TIGHT, rtl]}>
                  {t.insights.tasksOf(todayList.done, todayTotal)}
                </Text>
              ) : null}
              {gemLine ? (
                <Text style={[{ fontFamily: "SpaceGrotesk-Regular", fontSize: 13, lineHeight: 17, color: ON_DARK }, TIGHT, rtl]}>{gemLine}</Text>
              ) : null}
            </View>
          </View>
          <View style={{ marginTop: 18, height: 1, backgroundColor: ON_DARK_RULE }} />
          {week ? (
            <View style={{ marginTop: 16, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 6 }}>
              {lastSeven.map((date) => (
                <View key={date} style={{ alignItems: "center", gap: 10, width: 24 }}>
                  <Gem level={levels.get(date) ?? null} />
                  <Text style={[{ fontFamily: "SpaceGrotesk-Medium", fontSize: 10.5, color: ON_DARK_FAINT }, TIGHT]}>
                    {keyToLocalDate(date).toLocaleDateString(t.locale, { weekday: "narrow" })}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <View style={{ marginTop: 16 }}>
              <Eyebrow color="#B8ACA0">{`${t.insights.daysSoFar.toUpperCase()} · ${daysCounted}`}</Eyebrow>
              <View style={{ marginTop: 14, flexDirection: "row", justifyContent: "space-between" }}>
                {LEVELS.map((level) => (
                  <View key={level} style={{ flex: 1, alignItems: "center", gap: 7 }}>
                    <Gem level={level} />
                    <Text style={[{ fontFamily: "SpaceGrotesk-Bold", fontSize: 16, color: "#FFFFFF" }, TIGHT]}>{levelCounts[level]}</Text>
                    <Text numberOfLines={1} style={[{ fontFamily: "SpaceGrotesk-Regular", fontSize: 11, color: ON_DARK_FAINT }, TIGHT]}>
                      {levelName(level)}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>

        {/* Three numbers. */}
        <View style={[{ marginTop: 14, borderRadius: 24, backgroundColor: P.paperCard, paddingVertical: 16, flexDirection: "row" }, SOFT_SHADOW]}>
          <Stat value={budget(insights.focusMinutes)} label={t.insights.focusedLower} divider={false} />
          <Stat value={String(insights.tasksDone)} label={t.insights.doneLower} divider />
          <Stat
            value={t.insights.streakDays(week ? insights.streak : longestStreak)}
            label={week ? t.insights.streakLower : t.insights.bestStreak}
            divider
          />
        </View>

        <View style={{ marginTop: 14 }}>
          <FocusChart key={shownRange} bars={insights.bars} range={shownRange} total={insights.focusMinutes} />
        </View>

        {/* Sessions, and your pace. */}
        <View style={{ marginTop: 14, flexDirection: "row", gap: 11 }}>
          <View style={[{ flex: 1, borderRadius: 24, backgroundColor: P.paperCard, paddingTop: 18, paddingHorizontal: 16, paddingBottom: 18 }, SOFT_SHADOW]}>
            <Eyebrow>{t.insights.sessionsTitle.toUpperCase()}</Eyebrow>
            <Text style={[{ marginTop: 14, fontFamily: "SpaceGrotesk-Bold", fontSize: 30, letterSpacing: -0.8, color: P.ink }, TIGHT]}>{insights.sessions}</Text>
            <Text style={[{ marginTop: 10, fontFamily: "SpaceGrotesk-Regular", fontSize: 13, lineHeight: 17, color: P.inkMuted }, TIGHT, rtl]}>
              {week ? t.insights.sessionsSoFar : t.insights.sessionsTotal}
            </Text>
          </View>

          <AnimatedPressable
            onPress={locked ? () => openPaywall("insights") : undefined}
            disabled={!locked}
            scaleTo={0.98}
            style={[{ flex: 1, borderRadius: 24, backgroundColor: P.paperCard, paddingTop: 18, paddingHorizontal: 16, paddingBottom: 18 }, SOFT_SHADOW]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Eyebrow>{t.insights.pace.title.toUpperCase()}</Eyebrow>
              {locked ? <Feather name="lock" size={12} color={P.inkMuted} /> : null}
            </View>
            {locked ? (
              <Text style={[{ marginTop: 14, fontFamily: "SpaceGrotesk-Regular", fontSize: 13, lineHeight: 17, color: P.inkMuted }, TIGHT, rtl]}>
                {t.insights.pace.lockedBody}
              </Text>
            ) : pace ? (
              <>
                <Text style={[{ marginTop: 14, fontFamily: "SpaceGrotesk-Bold", fontSize: 30, letterSpacing: -0.8, color: P.ink }, TIGHT]}>
                  {t.insights.pace.factor(pace.factor.toLocaleString(t.locale, { maximumFractionDigits: 2 }))}
                </Text>
                <Text style={[{ marginTop: 10, fontFamily: "SpaceGrotesk-Regular", fontSize: 13, lineHeight: 17, color: P.inkMuted }, TIGHT, rtl]}>
                  {isOnPace(pace.factor)
                    ? t.insights.pace.onPace
                    : pace.factor > 1
                      ? t.insights.pace.slower(pace.factor.toLocaleString(t.locale, { maximumFractionDigits: 2 }))
                      : t.insights.pace.faster(pace.factor.toLocaleString(t.locale, { maximumFractionDigits: 2 }))}
                </Text>
              </>
            ) : (
              <>
                <View style={{ marginTop: 14, flexDirection: "row", gap: 5 }}>
                  {Array.from({ length: MIN_PACE_SAMPLES }, (_, index) => (
                    <View key={index} style={{ flex: 1, height: 7, borderRadius: 3.5, backgroundColor: index < finishedInSession ? P.accent : BAR_EMPTY }} />
                  ))}
                </View>
                <Text style={[{ marginTop: 12, fontFamily: "SpaceGrotesk-Regular", fontSize: 13, lineHeight: 17.5, color: P.inkMuted }, TIGHT, rtl]}>
                  <Text style={{ fontFamily: "SpaceGrotesk-Bold", color: P.ink }}>
                    {t.insights.paceProgress(Math.min(finishedInSession, MIN_PACE_SAMPLES), MIN_PACE_SAMPLES)}
                  </Text>
                  {` · ${t.insights.paceHint(MIN_PACE_SAMPLES)}`}
                </Text>
              </>
            )}
          </AnimatedPressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
