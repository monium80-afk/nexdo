import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { OnboardingLayout } from "@/components/OnboardingLayout";
import { useRtlText } from "@/hooks/useRtlText";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { posthog } from "@/lib/posthog";

// Ids only — the labels come from onboardingGoals.options, in the same order.
// Ids rather than indices so a saved answer survives the list being reordered.
const GOALS = ["forget", "overloaded", "prioritize", "procrastinate", "start", "organized"] as const;

type Goal = (typeof GOALS)[number];

/** One answer. Picked ones take an orange tint rather than a solid fill: the
 *  whole list has to stay readable however many are on. */
function GoalRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const colors = useColors();
  const rtl = useRtlText();

  return (
    <AnimatedPressable
      onPress={onPress}
      scaleTo={0.98}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      className={
        selected
          ? "flex-row items-center justify-between gap-4 rounded-2xl border border-orange-500 bg-orange-100 px-5 py-4"
          : "flex-row items-center justify-between gap-4 rounded-2xl border border-cream-300 bg-cream-50 px-5 py-4"
      }
    >
      <Text className="flex-1 font-grotesk-medium text-base text-ink-cream" style={rtl}>
        {label}
      </Text>
      {selected ? (
        <View className="h-6 w-6 items-center justify-center rounded-full bg-orange-500">
          <Feather name="check" size={14} color={colors.onAccent} />
        </View>
      ) : (
        <View className="h-6 w-6 rounded-full border-2 border-cream-300" />
      )}
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
          answers scroll while the headline and the button stay put. */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ gap: 12, paddingBottom: 4 }}
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
