import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";

import {
  CalendarIcon,
  CARD_SHADOW,
  FadeUp,
  ONB,
  ONB_PROGRESS,
  OnboardingScreen,
  OnboardingTitle,
  PaperFade,
  PrimaryButton,
  rowDirection,
  useIsRtl,
} from "@/components/onboarding/OnboardingKit";
import { useLoopClock } from "@/components/onboarding/timeline";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";

// 02 · Problem (screens/02-problem.html): a long, unsorted list drifting up
// behind a soft fade. The list is there twice, so each pass (24 s, as in the
// mock) ends exactly where it began and the drift never visibly restarts. It
// keeps going while the screen is in front (asked 2026-11-12) and pauses once
// it's left. Only a transform animates; the cards are always drawn.

const SCROLL_SECONDS = 24;

function WallCard({ title, due }: { title: string; due: string }) {
  const rtl = useIsRtl();
  const rtlText = useRtlText();
  return (
    <View
      className="mb-2 gap-3 rounded-[18px] py-[14px] pl-4 pr-[14px]"
      style={[{ backgroundColor: ONB.card, alignItems: "flex-start" }, CARD_SHADOW, rowDirection(rtl)]}
    >
      <View className="h-7 w-7 rounded-full border-2 border-[#CFC4B9]" />
      <View className="flex-1 gap-1.5">
        <Text className="font-grotesk-semibold text-[17px] text-[#221C17]" style={rtlText}>
          {title}
        </Text>
        <View className="items-center gap-[5px]" style={rowDirection(rtl)}>
          <CalendarIcon />
          <Text className="font-grotesk-regular text-[14px] text-[#7A6E64]">{due}</Text>
        </View>
      </View>
    </View>
  );
}

export default function OnboardingProblem() {
  const t = useTranslation();
  const copy = t.onboardingFlow.problem;
  const router = useRouter();
  const clock = useLoopClock(SCROLL_SECONDS);
  // The list's own height, for the scroll: half of it is one full pass.
  const [listHeight, setListHeight] = useState(0);
  const [boxHeight, setBoxHeight] = useState(0);

  const scrollStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -(listHeight / 2) * (clock.value / SCROLL_SECONDS) }],
  }));

  return (
    <OnboardingScreen
      percent={ONB_PROGRESS.problem}
      onBack={() => router.back()}
      footer={<PrimaryButton label={t.onboardingFlow.continue} onPress={() => router.push("/onboarding/picks")} />}
    >
      <View style={{ flex: 1, gap: 28 }}>
        <OnboardingTitle title={copy.headline} highlight={copy.highlight} />
        <FadeUp delay={120} style={{ flex: 1 }}>
          <View className="flex-1 overflow-hidden" onLayout={(event) => setBoxHeight(event.nativeEvent.layout.height)}>
            <Animated.View style={[{ paddingVertical: 4 }, scrollStyle]} onLayout={(event) => setListHeight(event.nativeEvent.layout.height - 8)}>
              {[...copy.tasks, ...copy.tasks].map(([title, due], index) => (
                <WallCard key={`${title}-${index}`} title={title} due={due} />
              ))}
            </Animated.View>
            {/* The mock's mask: in by 14 %, solid to 55 %, gone at the foot. */}
            <PaperFade top={boxHeight * 0.14} bottom={boxHeight * 0.45} />
          </View>
        </FadeUp>
      </View>
    </OnboardingScreen>
  );
}
