import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { GemLogo } from "@/components/GemLogo";
import { MetaPill } from "@/components/MetaPill";
import { OnboardingLayout } from "@/components/OnboardingLayout";
import { gradients } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import type { ExtractedTaskDraft } from "@/lib/ai/types";
import { formatDuration } from "@/lib/formatDuration";
import { computePriorityScore, PRIORITY_LEVEL_IMPORTANCE } from "@/lib/scoring";
import { previewDueLabel } from "@/lib/taskMeta";
import { posthog } from "@/lib/posthog";
import { useOnboardingStore } from "@/store/useOnboardingStore";

const SCROLL_BLEED = { marginHorizontal: -8 };
const SCROLL_CONTENT = { gap: 12, paddingHorizontal: 8, paddingTop: 2, paddingBottom: 12 };

/**
 * One extracted task, exactly as the app will score it once it is real: the
 * same computePriorityScore the task list runs on, off the same draft fields,
 * so the number here is not a preview of a different calculation. Drawn as
 * the AI chat's proposed-task card is — the Tasks page's surface and details
 * row — so it reads as what will land in the list.
 */
function PlanCard({ draft, now }: { draft: ExtractedTaskDraft; now: Date }) {
  const colors = useColors();
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
    <View className="card card--cream-soft gap-1.5 p-4" style={gradients.card}>
      <Text className="font-grotesk-bold text-base text-ink-cream" numberOfLines={1} style={rtl}>
        {draft.title}
      </Text>

      <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1">
        <MetaPill
          icon={<Feather name="calendar" size={13} color={draft.dueDate ? colors.orange[500] : colors.ink.creamSubtle} />}
          label={previewDueLabel(draft.dueDate, draft.dueHasTime, now, t)}
          labelClassName={
            draft.dueDate
              ? "font-grotesk-semibold text-sm text-ink-cream"
              : "font-grotesk-medium text-sm text-ink-cream-muted"
          }
        />
        <MetaPill
          icon={<GemLogo size={12} />}
          label={t.onboardingPlan.score(score)}
          labelClassName="font-grotesk-semibold text-sm text-ink-cream-muted"
        />
        <MetaPill
          icon={<Feather name="clock" size={13} color={colors.ink.creamMuted} />}
          label={formatDuration(draft.estimatedMinutes)}
          labelClassName="font-grotesk-medium text-sm text-ink-cream-muted"
        />
      </View>
    </View>
  );
}

export default function OnboardingPlan() {
  const colors = useColors();
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
          <Feather name="check" size={16} color={colors.success[500]} />
          <Text className="eyebrow text-success-500">{t.onboardingPlan.extracted(drafts.length)}</Text>
        </View>
      }
      headline={t.onboardingPlan.headline}
      body={drafts.length > 0 ? t.onboardingPlan.body : t.onboardingPlan.nothingFound}
      nextLabel={t.onboardingPlan.next}
      onNext={handleNext}
    >
      {/* Widened past the page margins and padded back, so the scroll's
          edges don't clip the cards' shadows. */}
      <ScrollView
        className="flex-1"
        style={SCROLL_BLEED}
        contentContainerStyle={SCROLL_CONTENT}
        showsVerticalScrollIndicator={false}
      >
        {drafts.map((draft, index) => (
          <PlanCard key={`${draft.title}-${index}`} draft={draft} now={now} />
        ))}
      </ScrollView>
    </OnboardingLayout>
  );
}
