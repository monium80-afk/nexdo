import { useAuth } from "@clerk/expo";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { Text, View } from "react-native";

import { GemLogo } from "@/components/GemLogo";
import { OnboardingLayout } from "@/components/OnboardingLayout";
import { gradients } from "@/constants/theme";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { posthog } from "@/lib/posthog";

// Positions only — the note labels come from onboarding.stickyNotes, in the same order.
const STICKY_NOTES = [
  { style: { top: 0, left: -6 }, rotate: "-7deg" },
  { style: { top: 0, right: -10 }, rotate: "4deg" },
  { style: { bottom: 0, left: -8 }, rotate: "3deg" },
  { style: { bottom: 0, right: -4 }, rotate: "-5deg" },
] as const;

// The Next card's own shadow (NextTaskCardStack), so the sample reads as that card.
const CARD_SHADOW = { boxShadow: "0 26px 40px -18px rgba(30, 16, 6, 0.6)" };

export default function Onboarding() {
  const t = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) return null;
  if (isSignedIn) return <Redirect href="/" />;

  const handleNext = () => {
    posthog.capture("onboarding_get_started_tapped");
    router.push("/onboarding-sort");
  };

  // For someone who already has an account: straight to log in, without the
  // setup steps. Pushed, so back brings them to this screen again.
  const handleLogIn = () => {
    posthog.capture("onboarding_login_tapped");
    router.push("/(auth)/sign-in");
  };

  return (
    <OnboardingLayout
      centered
      mark={
        <View
          className="card card--cream h-16 w-16 items-center justify-center rounded-[18px]"
          style={[{ borderCurve: "continuous" }, gradients.card]}
        >
          <GemLogo size={40} />
        </View>
      }
      percent={0}
      headline={t.onboarding.headline}
      body={t.onboarding.body}
      nextLabel={t.onboarding.getStarted}
      onNext={handleNext}
      secondaryAction={{ label: t.onboarding.haveAccount, onPress: handleLogIn }}
    >
      <View className="flex-1 items-center justify-center">
        <View className="relative w-[84%] pb-[26px] pt-[26px]">
          {/* Flat, with no shadow: Android drew a tilted note's soft shadow as
              a hard grey square around it (seen on the user's phone, 10-07). */}
          {STICKY_NOTES.map((note, index) => (
            <View
              key={index}
              className="absolute rounded-full border border-cream-300 bg-cream-50 px-4 py-2"
              style={{
                ...note.style,
                transform: [{ rotate: note.rotate }],
              }}
            >
              <Text className="text-xs font-grotesk-medium text-ink-cream-muted">
                {t.onboarding.stickyNotes[index]}
              </Text>
            </View>
          ))}

          {/* A small Next card: the same surface, rank pill and details row.
              mx-3 rather than a narrower wrapper: the sticky notes are placed
              against the wrapper, so narrowing that would pull them in too. */}
          <View
            className="mx-3 gap-2 rounded-[24px] hairline-charcoal bg-charcoal-900 p-5"
            style={[gradients.charcoalCard, CARD_SHADOW]}
          >
            <View
              className="flex-row items-center gap-1 self-start rounded-full py-0.5 pl-1.5 pr-2.5"
              style={gradients.rankPill}
            >
              <Ionicons name="flame" size={11} color={colors.orange[400]} />
              <Text className="font-grotesk-bold text-xs text-orange-300">{t.onboarding.nextUp}</Text>
            </View>

            <Text className="font-grotesk-bold text-base text-ink-charcoal">
              {t.onboarding.sampleTask}
            </Text>

            <View className="flex-row items-center gap-2">
              <View className="flex-row items-center gap-1">
                <Ionicons name="calendar-clear-outline" size={12} color={colors.ink.charcoal} />
                <Text className="font-grotesk-semibold text-xs text-ink-charcoal">{t.onboarding.dueTomorrow}</Text>
              </View>
              <View className="h-[11px] w-px bg-white/20" />
              <View className="flex-row items-center gap-1">
                <Ionicons name="time-outline" size={12} color={colors.ink.charcoal} />
                <Text className="font-grotesk-semibold text-xs text-ink-charcoal">~45m</Text>
              </View>
            </View>

            <View className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <View className="h-full w-[65%] rounded-full bg-orange-500" style={gradients.accent} />
            </View>
          </View>
        </View>
      </View>
    </OnboardingLayout>
  );
}
