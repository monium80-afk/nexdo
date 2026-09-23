import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { Platform, StyleSheet, Text, View } from "react-native";

import { GemLogo } from "@/components/GemLogo";
import { OnboardingLayout } from "@/components/OnboardingLayout";
import { colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/useTranslation";
import { posthog } from "@/lib/posthog";

// Positions only — the note labels come from onboarding.stickyNotes, in the same order.
const STICKY_NOTES = [
  { style: { top: 0, left: -6 }, rotate: "-7deg" },
  { style: { top: 0, right: -10 }, rotate: "4deg" },
  { style: { bottom: 0, left: -8 }, rotate: "3deg" },
  { style: { bottom: 0, right: -4 }, rotate: "-5deg" },
] as const;

export default function Onboarding() {
  const t = useTranslation();
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) return null;
  if (isSignedIn) return <Redirect href="/" />;

  const handleNext = () => {
    posthog.capture("onboarding_get_started_tapped");
    router.push("/onboarding-sort");
  };

  return (
    <OnboardingLayout
      centered
      mark={
        <View
          className="h-16 w-16 items-center justify-center rounded-[16px] border border-cream-300 bg-cream-50"
          style={[{ borderCurve: "continuous" }, styles.logoShadow]}
        >
          <GemLogo size={40} />
        </View>
      }
      percent={0}
      headline={t.onboarding.headline}
      body={t.onboarding.body}
      nextLabel={t.onboarding.getStarted}
      onNext={handleNext}
    >
      <View className="flex-1 items-center justify-center">
        <View className="relative w-[84%] pb-[26px] pt-[26px]">
          {STICKY_NOTES.map((note, index) => (
            <View
              key={index}
              className="absolute rounded-full bg-cream-200 px-4 py-2"
              style={{
                ...note.style,
                transform: [{ rotate: note.rotate }],
              }}
            >
              <Text className="text-xs font-grotesk-regular text-ink-cream-muted">
                {t.onboarding.stickyNotes[index]}
              </Text>
            </View>
          ))}

          {/* mx-3 rather than a narrower wrapper: the sticky notes are placed
              against the wrapper, so narrowing that would pull them in too. */}
          <View className="card--charcoal mx-3 gap-2 rounded-[20px] p-5" style={styles.cardGlow}>
            {/* The badge utility is a full pill; this one is squarer, so its
                classes are spelled out rather than fighting that radius. */}
            <View className="flex-row items-center self-start rounded-lg bg-orange-500 px-2.5 py-1">
              <Text className="text-xs font-grotesk-bold tracking-wide text-on-accent">
                {t.onboarding.nextUp}
              </Text>
            </View>

            <Text className="font-grotesk-bold text-base text-ink-charcoal">
              {t.onboarding.sampleTask}
            </Text>

            <View className="flex-row items-center gap-2">
              <Feather name="calendar" size={12} color={colors.orange[500]} />
              <Text className="font-grotesk-medium text-xs text-orange-500">
                {t.onboarding.dueTomorrow}
              </Text>
              <Text className="text-xs text-ink-charcoal-muted">·</Text>
              <Feather name="clock" size={12} color={colors.ink.charcoalMuted} />
              <Text className="font-grotesk-regular text-xs text-ink-charcoal-muted">~45m</Text>
            </View>

            <View className="h-2 overflow-hidden rounded-full bg-charcoal-600">
              <View className="h-full w-[65%] rounded-full bg-orange-500" />
            </View>
          </View>
        </View>
      </View>
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  logoShadow: Platform.select({
    ios: {
      shadowColor: colors.ink.cream,
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.08,
      shadowRadius: 8,
    },
    android: { shadowColor: colors.ink.cream, elevation: 3 },
    default: {},
  }),
  cardGlow: Platform.select({
    ios: {
      shadowColor: colors.orange[500],
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.5,
      shadowRadius: 28,
    },
    android: {
      shadowColor: colors.orange[500],
      elevation: 20,
    },
    default: {},
  }),
});
