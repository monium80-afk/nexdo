import { useAuth } from "@clerk/expo";
import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, Text } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { Checkbox } from "@/components/Checkbox";
import { OnboardingLayout } from "@/components/OnboardingLayout";
import { gradients } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import { posthog } from "@/lib/posthog";

// Ids only — the labels come from onboardingGoals.options, in the same order.
// Ids rather than indices so a saved answer survives the list being reordered.
const GOALS = ["forget", "overloaded", "prioritize", "procrastinate", "start", "organized"] as const;

type Goal = (typeof GOALS)[number];

const SCROLL_BLEED = { marginHorizontal: -8 };
const SCROLL_CONTENT = { gap: 12, paddingHorizontal: 8, paddingTop: 2, paddingBottom: 12 };

/** One answer, drawn as the app's option cards are (Add Task's priority): a
 *  lifted cream card at rest, an orange tint with an orange edge once picked —
 *  a tint rather than a solid fill, so the whole list stays readable however
 *  many are on. The box is the Tasks page's checkbox. */
function GoalRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const rtl = useRtlText();

  return (
    <AnimatedPressable
      onPress={onPress}
      scaleTo={0.98}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      style={selected ? undefined : gradients.card}
      className={`card flex-row items-center justify-between gap-4 px-5 py-4 ${
        selected ? "border-orange-500 bg-orange-100" : "chip--idle"
      }`}
    >
      <Text
        className={`flex-1 text-base text-ink-cream ${selected ? "font-grotesk-semibold" : "font-grotesk-medium"}`}
        style={rtl}
      >
        {label}
      </Text>
      <Checkbox checked={selected} />
    </AnimatedPressable>
  );
}

export default function OnboardingGoals() {
  const t = useTranslation();
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();

  const [selected, setSelected] = useState<Goal[]>([]);

  if (!isLoaded) return null;
  if (isSignedIn) return <Redirect href="/" />;

  const toggle = (goal: Goal) => {
    setSelected((current) =>
      current.includes(goal) ? current.filter((item) => item !== goal) : [...current, goal],
    );
  };

  const handleNext = () => {
    posthog.capture("onboarding_goals_continued", { goals: selected });
    router.push("/onboarding-dump");
  };

  return (
    <OnboardingLayout
      percent={35}
      headline={t.onboardingGoals.headline}
      body={t.onboardingGoals.body}
      nextLabel={t.onboardingGoals.continue}
      onNext={handleNext}
    >
      {/* Six rows plus the copy above them do not fit a small phone, so the
          answers scroll while the headline and the button stay put. Widened
          past the page margins and padded back, so the scroll's edges don't
          clip the cards' shadows. */}
      <ScrollView
        className="flex-1"
        style={SCROLL_BLEED}
        contentContainerStyle={SCROLL_CONTENT}
        showsVerticalScrollIndicator={false}
      >
        {GOALS.map((goal, index) => (
          <GoalRow
            key={goal}
            label={t.onboardingGoals.options[index]}
            selected={selected.includes(goal)}
            onPress={() => toggle(goal)}
          />
        ))}
      </ScrollView>
    </OnboardingLayout>
  );
}
