import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { GemLogo } from "@/components/GemLogo";
import { OnboardingLayout } from "@/components/OnboardingLayout";
import { colors } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import type { ExtractedTaskDraft } from "@/lib/ai/types";
import { formatDuration } from "@/lib/formatDuration";
import { computePriorityScore, PRIORITY_LEVEL_IMPORTANCE } from "@/lib/scoring";
import { previewDueLabel } from "@/lib/taskMeta";
import { posthog } from "@/lib/posthog";
import { useOnboardingStore } from "@/store/useOnboardingStore";

/**
 * One extracted task, exactly as the app will score it once it is real: the
 * same computePriorityScore the task list runs on, off the same draft fields,
 * so the number here is not a preview of a different calculation.
 */
function PlanCard({ draft, now }: { draft: ExtractedTaskDraft; now: Date }) {
  const t = useTranslation();
  const rtl = useRtlText();

  const score = computePriorityScore(
    {
      dueDate: draft.dueDate,
      estimatedMinutes: draft.estimatedMinutes,
      importance: PRIORITY_LEVEL_IMPORTANCE[draft.priorityLevel],
    },
    now,
  );

  return (
    <View className="gap-2 rounded-2xl border border-cream-300 bg-cream-50 p-4">
      <View className="flex-row items-start justify-between gap-3">
        <Text className="flex-1 font-grotesk-bold text-base text-ink-cream" numberOfLines={1} style={rtl}>
          {draft.title}
        </Text>
        <View className="flex-row items-center gap-1.5 rounded-full bg-cream-200 px-3 py-1.5">
          <GemLogo size={13} />
          <Text className="font-grotesk-bold text-xs text-ink-cream">{t.onboardingPlan.score(score)}</Text>
        </View>
      </View>

      <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
        <Text
          className={
            draft.dueDate
              ? "font-grotesk-bold text-sm text-orange-500"
              : "font-grotesk-medium text-sm text-ink-cream-muted"
          }
        >
          {previewDueLabel(draft.dueDate, draft.dueHasTime, now, t)}
        </Text>
        <Text className="text-sm text-ink-cream-subtle">·</Text>
        <Text className="font-grotesk-medium text-sm text-ink-cream-muted">
          {formatDuration(draft.estimatedMinutes)}
        </Text>
      </View>
    </View>
  );
}

export default function OnboardingPlan() {
  const t = useTranslation();
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();

  const drafts = useOnboardingStore((state) => state.drafts);
  // Fixed for the life of the screen: scores and due labels both read "now",
  // and they would disagree if each re-render took a fresh reading.
  const [now] = useState(() => new Date());

  if (!isLoaded) return null;
  if (isSignedIn) return <Redirect href="/" />;

  const handleNext = () => {
    posthog.capture("onboarding_plan_continued", { task_count: drafts.length });
    router.push("/onboarding-focus");
  };

  return (
    <OnboardingLayout
      percent={75}
      eyebrow={
        <View className="flex-row items-center gap-2">
          <Feather name="check" size={16} color={colors.olive[500]} />
          <Text className="eyebrow text-olive-500">{t.onboardingPlan.extracted(drafts.length)}</Text>
        </View>
      }
      headline={t.onboardingPlan.headline}
      body={drafts.length > 0 ? t.onboardingPlan.body : t.onboardingPlan.nothingFound}
      nextLabel={t.onboardingPlan.next}
      onNext={handleNext}
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ gap: 12, paddingBottom: 4 }}
        showsVerticalScrollIndicator={false}
      >
        {drafts.map((draft, index) => (
          <PlanCard key={`${draft.title}-${index}`} draft={draft} now={now} />
        ))}
      </ScrollView>
    </OnboardingLayout>
  );
}
