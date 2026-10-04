import { useAuth } from "@clerk/expo";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { GemLogo } from "@/components/GemLogo";
import { HighlightedText } from "@/components/HighlightedText";
import { OnboardingLayout } from "@/components/OnboardingLayout";
import { gradients } from "@/constants/theme";
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

// The Next card's own shadow (NextTaskCardStack).
const CARD_SHADOW = { boxShadow: "0 26px 40px -18px rgba(30, 16, 6, 0.6)" };

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
  const due = top ? getDueInfo(top, now) : null;

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
      {top && due ? (
        // The Next card itself: its surface, rank pill, score pill and details row.
        <View
          className="gap-4 rounded-[28px] hairline-charcoal bg-charcoal-900 p-5"
          style={[gradients.charcoalCard, CARD_SHADOW]}
        >
          <View className="flex-row flex-wrap items-center justify-between gap-2">
            <View
              className="flex-row items-center gap-1.5 rounded-full py-0.5 pl-1.5 pr-2.5"
              style={gradients.rankPill}
            >
              <Ionicons name="flame" size={13} color={colors.orange[400]} />
              <Text className="font-grotesk-bold text-[13px] text-orange-300">{t.onboardingFocus.nextFocus}</Text>
            </View>
            <View className="glass flex-row items-center gap-1.5 rounded-full px-2.5 py-0.5">
              <GemLogo size={13} onDark />
              <Text className="font-grotesk-semibold text-[13px] text-ink-charcoal">
                {t.onboardingFocus.urgency(top.priorityScore)}
              </Text>
            </View>
          </View>

          <View className="gap-2.5">
            <Text className="font-grotesk-bold text-[22px] leading-[26px] tracking-tight text-ink-charcoal" style={rtl}>
              {top.title}
            </Text>
            {/* Only an overdue deadline gets a badge — solid red, as on the Next card. */}
            <View className="flex-row flex-wrap items-center gap-x-2 gap-y-2">
              <View
                className={
                  due.tone === "overdue"
                    ? "badge--overdue-solid flex-row items-center gap-1.5 rounded-[10px] px-2 py-1"
                    : "flex-row items-center gap-1.5"
                }
              >
                <Ionicons
                  name="calendar-clear-outline"
                  size={14}
                  color={due.tone === "overdue" ? colors.onAccent : colors.ink.charcoal}
                />
                <Text
                  className={
                    due.tone === "overdue"
                      ? "font-grotesk-bold text-[13px] text-on-accent"
                      : "font-grotesk-semibold text-[13px] text-ink-charcoal"
                  }
                >
                  {due.tone === "overdue" ? t.due.overdue : due.pillLabel}
                </Text>
              </View>
              <View className="h-[13px] w-px bg-white/20" />
              <View className="flex-row items-center gap-1.5">
                <Ionicons name="time-outline" size={14} color={colors.ink.charcoal} />
                <Text className="font-grotesk-semibold text-[13px] text-ink-charcoal">
                  {formatDuration(top.estimatedMinutes)}
                </Text>
              </View>
            </View>
          </View>

          <View className="glass gap-2 rounded-[18px] p-4">
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
