import { Feather } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { SetupProgressBar } from "@/components/SetupProgressBar";
import { colors } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useScreenEnterAnimation } from "@/hooks/useScreenEnterAnimation";
import { useTranslation } from "@/hooks/useTranslation";

/**
 * The frame every onboarding step shares: the setup bar and eyebrow up top,
 * the headline and its line of body copy, the step's own illustration in the
 * middle, and the continue button at the bottom. A step supplies only its
 * copy and its visual, so the chrome can never drift between screens.
 */
export function OnboardingLayout({
  percent,
  headline,
  body,
  onNext,
  children,
}: {
  percent: number;
  headline: string;
  body: string;
  onNext: () => void;
  children: ReactNode;
}) {
  const t = useTranslation();
  const rtl = useRtlText();
  const enterStyle = useScreenEnterAnimation();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream[100] }}>
      <Animated.View style={enterStyle} className="flex-1 px-6 pb-6">
        <View className="flex-row items-center gap-4">
          <View
            className="h-12 w-12 items-center justify-center rounded-[15px] bg-orange-500"
            style={{ borderCurve: "continuous" }}
          >
            <Feather name="arrow-right" size={20} color={colors.onAccent} />
          </View>
          <View className="flex-1 gap-1.5">
            <SetupProgressBar percent={percent} />
            <Text className="eyebrow text-ink-cream-muted">{t.onboarding.eyebrow}</Text>
          </View>
        </View>

        <View className="mt-7 gap-2.5">
          <Text className="font-grotesk-bold text-[23px] leading-[1.15] tracking-tight text-ink-cream" style={rtl}>
            {headline}
          </Text>
          <Text className="text-[15px] font-grotesk-regular leading-relaxed text-ink-cream-muted" style={rtl}>
            {body}
          </Text>
        </View>

        <View className="mt-6 flex-1">{children}</View>

        <View className="flex-row items-center justify-end pt-6">
          <AnimatedPressable
            onPress={onNext}
            scaleTo={0.94}
            accessibilityRole="button"
            accessibilityLabel={t.onboarding.next}
            className="h-[52px] w-[52px] items-center justify-center rounded-full bg-charcoal-900"
          >
            <Feather name="arrow-right" size={22} color={colors.onAccent} />
          </AnimatedPressable>
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}
