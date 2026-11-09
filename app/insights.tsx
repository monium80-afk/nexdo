import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { IconButton } from "@/components/Button";
import { ScreenHeader } from "@/components/ScreenHeader";
import { gradients } from "@/constants/theme";
import { useAiLocked } from "@/hooks/useAiLocked";
import { useRtlText } from "@/hooks/useRtlText";
import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { keyToLocalDate, toLocalDateKey } from "@/lib/localDate";
import {
  buildInsights,
  computePace,
  isOnPace,
  MIN_PACE_SAMPLES,
  paceSamples,
  type InsightsBar,
  type InsightsRange,
  type Pace,
  type PaceFactor,
} from "@/lib/pace";
import { openPaywall } from "@/lib/paywall";
import { posthog } from "@/lib/posthog";
import { entriesFor, useFocusLogStore } from "@/store/useFocusLogStore";
import { useTaskStore } from "@/store/useTaskStore";

// A direct link skips the tabs' sign-in check, so this page checks for itself.
export default function InsightsScreen() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/onboarding" />;
  return <InsightsView />;
}

const CHART_HEIGHT = 132;

/** "1h 20m", "45m", "0m". */
function useBudget() {
  const t = useTranslation();
  return (minutes: number) => t.format.budget(Math.floor(minutes / 60), Math.round(minutes % 60));
}

function RangeSwitch({
  range,
  locked,
  onChange,
}: {
  range: InsightsRange;
  locked: boolean;
  onChange: (range: InsightsRange) => void;
}) {
  const t = useTranslation();
  const colors = useColors();
  const options: { value: InsightsRange; label: string }[] = [
    { value: "week", label: t.insights.week },
    { value: "all", label: t.insights.all },
  ];
  return (
    <View className="glass flex-row self-start rounded-full p-[3px]" accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option.value === range;
        const isLocked = locked && option.value === "all";
        return (
          <AnimatedPressable
            key={option.value}
            onPress={() => (isLocked ? openPaywall("insights") : onChange(option.value))}
            scaleTo={0.96}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={isLocked ? `${option.label} — ${t.plan.proOnly}` : option.label}
            style={selected ? gradients.accent : undefined}
            className={`flex-row items-center gap-1.5 rounded-full px-3.5 py-1.5 ${selected ? "bg-orange-500" : ""}`}
          >
            <Text className={`font-grotesk-bold text-[13px] ${selected ? "text-on-accent" : "text-ink-charcoal-muted"}`}>
              {option.label}
            </Text>
            {isLocked ? <Feather name="lock" size={11} color={colors.ink.charcoalMuted} /> : null}
          </AnimatedPressable>
        );
      })}
    </View>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <View className="card card--cream-soft flex-1 gap-1 px-3.5 py-3" style={gradients.card}>
      <Text className="eyebrow text-ink-cream-muted" numberOfLines={1}>
        {label}
      </Text>
      <Text className="font-grotesk-bold text-[22px] leading-[28px] tracking-tight text-ink-cream" numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

/**
 * Focus minutes per bar — one series, so one colour and no legend. Tap a bar
 * to read it; the latest is picked to begin with.
 */
function FocusChart({ bars, range }: { bars: InsightsBar[]; range: InsightsRange }) {
  const t = useTranslation();
  const rtl = useRtlText();
  const budget = useBudget();
  const [picked, setPicked] = useState(bars.length - 1);
  const index = Math.min(picked, bars.length - 1);
  const bar = bars[index];
  const max = Math.max(...bars.map((entry) => entry.focusMinutes), 0);
  const today = toLocalDateKey(new Date());

  const dateLabel = (entry: InsightsBar) =>
    range === "week"
      ? entry.start === today
        ? t.insights.today
        : keyToLocalDate(entry.start).toLocaleDateString(t.locale, { weekday: "short", month: "short", day: "numeric" })
      : t.insights.weekOf(keyToLocalDate(entry.start).toLocaleDateString(t.locale, { month: "short", day: "numeric" }));

  return (
    <View className="card card--cream-soft gap-3 p-4" style={gradients.card}>
      <View className="gap-1">
        <Text className="eyebrow text-ink-cream-muted" style={rtl}>
          {t.insights.focusChart}
        </Text>
        <Text className="font-grotesk-semibold text-[14px] text-ink-cream" style={rtl}>
          {t.insights.barSummary(dateLabel(bar), budget(bar.focusMinutes), bar.tasksDone)}
        </Text>
      </View>

      <View>
        {max > 0 ? (
          <Text className="pb-1 font-grotesk-medium text-[11px] text-ink-cream-subtle">{budget(max)}</Text>
        ) : null}
        <View className="flex-row items-end gap-1.5 border-b border-cream-300" style={{ height: CHART_HEIGHT }}>
          {bars.map((entry, barIndex) => {
            const height = max > 0 ? Math.max(entry.focusMinutes > 0 ? 6 : 3, (entry.focusMinutes / max) * CHART_HEIGHT) : 3;
            const selected = barIndex === index;
            return (
              <AnimatedPressable
                key={entry.start}
                onPress={() => setPicked(barIndex)}
                scaleTo={0.96}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={t.insights.barSummary(dateLabel(entry), budget(entry.focusMinutes), entry.tasksDone)}
                // The whole column is the target, not just the bar.
                className="h-full flex-1 justify-end"
              >
                <View
                  className={`rounded-t-[4px] ${
                    entry.focusMinutes === 0 ? "bg-cream-300" : selected ? "bg-orange-500" : "bg-orange-300"
                  }`}
                  style={{ height }}
                />
              </AnimatedPressable>
            );
          })}
        </View>
        {range === "week" ? (
          <View className="mt-1.5 flex-row gap-1.5">
            {bars.map((entry, barIndex) => (
              <Text
                key={entry.start}
                numberOfLines={1}
                className={`flex-1 text-center text-[11px] ${
                  barIndex === index ? "font-grotesk-bold text-ink-cream" : "font-grotesk-medium text-ink-cream-muted"
                }`}
              >
                {keyToLocalDate(entry.start).toLocaleDateString(t.locale, { weekday: "narrow" })}
              </Text>
            ))}
          </View>
        ) : (
          <View className="mt-1.5 flex-row justify-between">
            <Text className="font-grotesk-medium text-[11px] text-ink-cream-muted">
              {keyToLocalDate(bars[0].start).toLocaleDateString(t.locale, { month: "short", day: "numeric" })}
            </Text>
            <Text className="font-grotesk-medium text-[11px] text-ink-cream-muted">{t.insights.today}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

/** "1.4" — a factor as it's read out. */
function factorText(factor: number, locale: string): string {
  return factor.toLocaleString(locale, { maximumFractionDigits: 2 });
}

function PaceLine({ label, pace }: { label: string; pace: PaceFactor | undefined }) {
  const t = useTranslation();
  const rtl = useRtlText();
  if (!pace) return null;
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="shrink font-grotesk-medium text-[13.5px] text-ink-cream-muted" style={rtl}>
        {label}
      </Text>
      <Text className="font-grotesk-bold text-[13.5px] text-ink-cream">
        {isOnPace(pace.factor) ? t.insights.pace.bucketOnPace : t.insights.pace.factor(factorText(pace.factor, t.locale))}
      </Text>
    </View>
  );
}

/** How long tasks really take next to the time they're given (Pro). */
function PaceCard({ pace, finished, locked }: { pace: Pace | null; finished: number; locked: boolean }) {
  const t = useTranslation();
  const rtl = useRtlText();
  const colors = useColors();

  return (
    <View className="card card--cream-soft gap-3 p-4" style={gradients.card}>
      <View className="flex-row items-center gap-2">
        <Feather name="activity" size={14} color={colors.orange[500]} />
        <Text className="eyebrow flex-1 text-ink-cream-muted" style={rtl}>
          {t.insights.pace.title}
        </Text>
        {locked ? <Feather name="lock" size={12} color={colors.ink.creamMuted} /> : null}
      </View>

      {locked ? (
        <>
          <Text className="font-grotesk-medium text-[14px] leading-[20px] text-ink-cream" style={rtl}>
            {t.insights.pace.lockedBody}
          </Text>
          <AnimatedPressable
            onPress={() => openPaywall("insights")}
            accessibilityRole="button"
            className="self-start rounded-full border border-orange-500 bg-orange-100 px-3.5 py-1.5"
          >
            <Text className="font-grotesk-bold text-[13px] text-orange-600">{t.plan.seePro}</Text>
          </AnimatedPressable>
        </>
      ) : !pace ? (
        <>
          <Text className="font-grotesk-medium text-[14px] leading-[20px] text-ink-cream" style={rtl}>
            {t.insights.pace.learning(Math.min(finished, MIN_PACE_SAMPLES), MIN_PACE_SAMPLES)}
          </Text>
          <View className="h-2 overflow-hidden rounded-full bg-cream-200">
            <View
              className="h-full rounded-full bg-orange-500"
              style={{ width: `${(Math.min(finished, MIN_PACE_SAMPLES) / MIN_PACE_SAMPLES) * 100}%` }}
            />
          </View>
        </>
      ) : (
        <>
          <View className="flex-row items-end gap-3">
            <Text className="font-grotesk-bold text-[40px] leading-[44px] tracking-tight text-ink-cream">
              {t.insights.pace.factor(factorText(pace.factor, t.locale))}
            </Text>
            <Text className="shrink pb-1 font-grotesk-medium text-[14px] leading-[20px] text-ink-cream" style={rtl}>
              {isOnPace(pace.factor)
                ? t.insights.pace.onPace
                : pace.factor > 1
                  ? t.insights.pace.slower(factorText(pace.factor, t.locale))
                  : t.insights.pace.faster(factorText(pace.factor, t.locale))}
            </Text>
          </View>
          {pace.short || pace.long ? (
            <View className="gap-2 border-t border-cream-200 pt-3">
              <PaceLine label={t.insights.pace.short} pace={pace.short} />
              <PaceLine label={t.insights.pace.long} pace={pace.long} />
            </View>
          ) : null}
          <Text className="font-grotesk-medium text-[12.5px] leading-[18px] text-ink-cream-muted" style={rtl}>
            {t.insights.pace.adjusting}
          </Text>
        </>
      )}
    </View>
  );
}

/**
 * Insights: time focused, tasks done and the run of days with something
 * done — the last 7 days on every plan, all of it on Pro — and "your pace"
 * (Pro): how long tasks really take next to the time they're given. Built on
 * the phone from the focus log (store/useFocusLogStore.ts); no AI, nothing
 * sent anywhere. Opened from Today's progress card and from Settings.
 */
function InsightsView() {
  useStatusBarStyle("light");
  const colors = useColors();
  const t = useTranslation();
  const rtl = useRtlText();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const budget = useBudget();
  const locked = useAiLocked();
  const [range, setRange] = useState<InsightsRange>("week");

  const userId = useTaskStore((state) => state.syncUserId);
  const tasks = useTaskStore((state) => state.tasks);
  const allEntries = useFocusLogStore((state) => state.entries);
  const allCompletions = useFocusLogStore((state) => state.completions);
  const entries = useMemo(() => entriesFor(allEntries, userId), [allEntries, userId]);
  const completions = useMemo(() => entriesFor(allCompletions, userId), [allCompletions, userId]);

  const shownRange: InsightsRange = locked ? "week" : range;
  const insights = useMemo(
    () => buildInsights(entries, completions, tasks, shownRange),
    [entries, completions, tasks, shownRange],
  );
  const pace = useMemo(() => computePace(entries), [entries]);
  const finishedInSession = useMemo(() => paceSamples(entries).length, [entries]);
  const empty = insights.sessions === 0 && insights.tasksDone === 0;

  const handleRange = (next: InsightsRange) => {
    if (next !== range) posthog.capture("insights_range", { range: next });
    setRange(next);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.charcoal[900] }} edges={["top"]}>
      <ScreenHeader
        title={t.insights.title}
        subtitle={t.insights.subtitle}
        actions={<IconButton icon="x" variant="header" onPress={() => router.back()} accessibilityLabel={t.common.close} />}
      >
        <RangeSwitch range={shownRange} locked={locked} onChange={handleRange} />
      </ScreenHeader>

      <View className="screen-body">
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 28 }} showsVerticalScrollIndicator={false}>
          <View className="gap-4 px-4 pt-4">
            <View className="flex-row gap-2.5">
              <StatTile label={t.insights.focused} value={budget(insights.focusMinutes)} />
              <StatTile label={t.insights.done} value={String(insights.tasksDone)} />
              <StatTile label={t.insights.streak} value={t.insights.streakDays(insights.streak)} />
            </View>

            {empty ? (
              <View className="card card--cream-muted items-center gap-2 px-5 py-5">
                <Feather name="clock" size={18} color={colors.ink.creamMuted} />
                <Text className="text-center font-grotesk-medium text-sm leading-5 text-ink-cream-muted" style={rtl}>
                  {t.insights.empty}
                </Text>
              </View>
            ) : (
              <FocusChart key={shownRange} bars={insights.bars} range={shownRange} />
            )}

            {insights.bestTime || insights.sessions > 0 ? (
              <View className="card card--cream-soft flex-row items-center gap-3 px-4 py-3.5" style={gradients.card}>
                <Feather name={insights.bestTime === "night" || insights.bestTime === "evening" ? "moon" : "sun"} size={16} color={colors.orange[500]} />
                <Text className="flex-1 font-grotesk-medium text-[14px] leading-[20px] text-ink-cream" style={rtl}>
                  {insights.bestTime ? t.insights.bestTime[insights.bestTime] : t.insights.sessions(insights.sessions)}
                </Text>
              </View>
            ) : null}

            <PaceCard pace={pace} finished={finishedInSession} locked={locked} />
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
