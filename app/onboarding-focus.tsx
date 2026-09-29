import { useAuth } from "@clerk/expo";
import { Feather, Ionicons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { HighlightedText } from "@/components/HighlightedText";
import { OnboardingLayout } from "@/components/OnboardingLayout";
import { useRtlText } from "@/hooks/useRtlText";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { generateAdvice } from "@/lib/ai/generateAdvice";
import { formatDuration } from "@/lib/formatDuration";
import { posthog } from "@/lib/posthog";
import { rankTasksForNext } from "@/lib/scoring";
import { getDueInfo } from "@/lib/taskMeta";
import { buildTask } from "@/store/useTaskStore";
import { useOnboardingStore } from "@/store/useOnboardingStore";

export default function OnboardingFocus() {
  const colors = useColors();
  const t = useTranslation();
  const rtl = useRtlText();
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();

  const drafts = useOnboardingStore((state) => state.drafts);
  // Fixed for the life of the screen: the ranking, the scores and the deadline
  // labels all read "now", and they would disagree if each took its own.
  const [now] = useState(() => new Date());

  // Built but never saved. buildTask is exactly what the store runs on a new
  // task — complexity, steps, scores — so ranking these through
  // rankTasksForNext is the app's real decision, not a stand-in for it. Memoed
  // because every build mints fresh ids, and a new identity each render would
  // send the advice request round again.
  const ranked = useMemo(
    () =>
      rankTasksForNext(
        drafts.map((draft) =>
          buildTask(
            {
              title: draft.title,
              estimatedMinutes: draft.estimatedMinutes,
              dueDate: draft.dueDate,
              // The same deadline useAuthSync saves: a time only if one was said.
              dueHasTime: draft.dueHasTime ?? false,
              priorityLevel: draft.priorityLevel,
              // Kept: when the AI grouped linked items under one task, that is
              // the plan the advice should reason about. Ids only have to be
              // unique within the task, and each draft builds its own.
              steps: draft.steps?.map((step, index) => ({
                id: `onboarding-step-${index}`,
                label: step.title,
                estimatedMinutes: step.estimatedMinutes,
              })),
            },
            now,
          ),
        ),
        now,
      ),
    [drafts, now],
  );
  const top = ranked[0];

  // A tip that makes the task easier to do, not a reason it was picked — the
  // urgency pill already covers that. Only the headline: that's the AI's whole
  // advice, while the offline fallback's second line is its priority score.
  const [adviceText, setAdviceText] = useState<string | null>(null);

  useEffect(() => {
    if (!top) return;
    let cancelled = false;
    generateAdvice(top)
      .then((advice) => {
        if (!cancelled) setAdviceText(advice.headline);
      })
      .catch((error) => {
        // generateAdvice already falls back to its own heuristic, so this only
        // fires on something unexpected — the box just stays on the loader.
        console.warn("[onboarding-focus] advice failed", error);
      });
    return () => {
      cancelled = true;
    };
  }, [top]);

  if (!isLoaded) return null;
  if (isSignedIn) return <Redirect href="/" />;

  const handleNext = () => {
    posthog.capture("onboarding_focus_accepted", { had_pick: Boolean(top) });
    router.push("/(auth)/sign-up");
  };

  return (
    <OnboardingLayout
      percent={85}
      eyebrow={t.onboardingFocus.eyebrow}
      headline={t.onboardingFocus.headline}
      body={top ? t.onboardingFocus.body : t.onboardingFocus.nothing}
      nextLabel={t.onboardingFocus.next}
      onNext={handleNext}
    >
      {top ? (
        <View className="gap-4 rounded-[20px] border border-orange-500 bg-charcoal-900 p-5">
          <View className="flex-row flex-wrap items-center justify-between gap-2">
            <View className="flex-row items-center gap-2 rounded-full bg-orange-500 px-4 py-2">
              <Feather name="zap" size={14} color={colors.onAccent} />
              <Text className="eyebrow text-on-accent">{t.onboardingFocus.nextFocus}</Text>
            </View>
            <View className="rounded-full border border-orange-500/70 bg-orange-500/15 px-3.5 py-2">
              <Text className="font-grotesk-bold text-xs text-orange-500">
                {t.onboardingFocus.urgency(top.priorityScore)}
              </Text>
            </View>
          </View>

          <View className="gap-2">
            <Text className="font-grotesk-bold text-2xl text-ink-charcoal" style={rtl}>
              {top.title}
            </Text>
            <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1.5">
              <View className="flex-row items-center gap-1.5">
                <Feather name="calendar" size={13} color={colors.orange[500]} />
                <Text className="font-grotesk-bold text-sm text-orange-500">{getDueInfo(top, now).pillLabel}</Text>
              </View>
              <Text className="text-sm text-ink-charcoal-muted">·</Text>
              <View className="flex-row items-center gap-1.5">
                <Feather name="clock" size={13} color={colors.ink.charcoalMuted} />
                <Text className="font-grotesk-medium text-sm text-ink-charcoal-muted">
                  {formatDuration(top.estimatedMinutes)}
                </Text>
              </View>
            </View>
          </View>

          <View className="card--charcoal-inset gap-2 rounded-2xl border p-4">
            <View className="flex-row items-center gap-2">
              {/* The same bulb the session card uses for AI advice, so this
                  reads as the assistant speaking rather than a new thing. */}
              <Ionicons name="bulb-outline" size={15} color={colors.orange[500]} />
              <Text className="eyebrow text-orange-500">{t.onboardingFocus.advice}</Text>
            </View>
            {adviceText ? (
              <HighlightedText
                text={adviceText}
                className="font-grotesk-regular text-[15px] leading-relaxed text-ink-charcoal-muted"
                highlightClassName="font-grotesk-bold text-ink-charcoal"
              />
            ) : (
              <View className="flex-row items-center gap-2 py-1">
                <ActivityIndicator size="small" color={colors.orange[500]} />
                <Text className="font-grotesk-medium text-sm text-ink-charcoal-muted">
                  {t.onboardingFocus.thinking}
                </Text>
              </View>
            )}
          </View>
        </View>
      ) : null}
    </OnboardingLayout>
  );
}
