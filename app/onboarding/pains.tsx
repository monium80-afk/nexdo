import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import Animated, { useAnimatedScrollHandler, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import {
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
import { CSS_EASE } from "@/components/onboarding/timeline";
import { useTranslation } from "@/hooks/useTranslation";
import { posthog } from "@/lib/posthog";
import { ONBOARDING_PAINS, useOnboardingStore, type OnboardingPain } from "@/store/useOnboardingStore";

// 04 · What brings you here? (screens/04-…html). Multi-select: a picked row
// turns dark with an orange check. The answers are saved — 11 builds its
// promise sentence from them. The rows scroll inside their own area, fading
// at the edge that has more, so none ever sits under Continue.

/** The mock's change from cream to dark: 18 % → 24 % of a 6 s loop. */
const SELECT_MS = 360;
const FILL = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } as const;
/** How tall the soft fades at the list's edges are. */
const FADE_TOP = 22;
const FADE_BOTTOM = 40;

/**
 * One answer. Its look comes from `selected` (React); the change only plays
 * as an animation for the moment after a tap — dark layer, white text and
 * tick fading or popping in — then React draws the settled look again, so a
 * stalled animation can't leave a row looking unpicked.
 */
function PainRow({ label, selected, onToggle }: { label: string; selected: boolean; onToggle: () => void }) {
  const rtl = useIsRtl();
  const reduceMotion = useReducedMotion();
  const on = useSharedValue(selected ? 1 : 0);
  const [moving, setMoving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const press = () => {
    if (!reduceMotion) {
      on.value = withTiming(selected ? 0 : 1, { duration: SELECT_MS, easing: CSS_EASE });
      setMoving(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setMoving(false), SELECT_MS + 120);
    } else {
      on.value = selected ? 0 : 1;
    }
    onToggle();
  };

  const darkAnimated = useAnimatedStyle(() => ({ opacity: on.value }));
  const ringAnimated = useAnimatedStyle(() => ({ opacity: 1 - on.value }));
  // The tick pops: 0 → 1.2 → 1 (vTick).
  const tickAnimated = useAnimatedStyle(() => {
    const v = on.value;
    const scale = v < 0.75 ? (v / 0.75) * 1.2 : 1.2 - ((v - 0.75) / 0.25) * 0.2;
    return { opacity: Math.min(1, v * 4), transform: [{ scale: Math.max(0, scale) }] };
  });
  const shown = selected ? 1 : 0;
  const darkStyle = moving ? darkAnimated : { opacity: shown };
  const ringStyle = moving ? ringAnimated : { opacity: 1 - shown };
  const tickStyle = moving ? tickAnimated : { opacity: shown, transform: [{ scale: shown }] };

  const labelStyle = { fontSize: 16, lineHeight: 20, fontFamily: "SpaceGrotesk-SemiBold", textAlign: rtl ? "right" : "left" } as const;
  return (
    <AnimatedPressable onPress={press} scaleTo={0.97} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} accessibilityLabel={label}>
      <View style={[{ minHeight: 58, borderRadius: 18, backgroundColor: ONB.card, paddingVertical: 10, paddingLeft: rtl ? 16 : 18, paddingRight: rtl ? 18 : 16, alignItems: "center", gap: 12 }, CARD_SHADOW, rowDirection(rtl)]}>
        <Animated.View style={[FILL, { borderRadius: 18, backgroundColor: ONB.ink }, darkStyle]} />
        {/* Ink text, with a white copy on top that fades in with the dark layer. */}
        <View style={{ flex: 1 }}>
          <Text maxFontSizeMultiplier={1.2} style={[labelStyle, { color: ONB.ink }]}>
            {label}
          </Text>
          <Animated.Text maxFontSizeMultiplier={1.2} style={[labelStyle, FILL, { color: "#FFFFFF" }, darkStyle]}>
            {label}
          </Animated.Text>
        </View>
        <View style={{ width: 24, height: 24 }}>
          <Animated.View style={[FILL, { borderRadius: 8, borderWidth: 2, borderColor: ONB.ring }, ringStyle]} />
          <Animated.View style={[FILL, { borderRadius: 8, backgroundColor: ONB.orange, alignItems: "center", justifyContent: "center" }, tickStyle]}>
            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M5 12.5l4.5 4.5L19 7.5" />
            </Svg>
          </Animated.View>
        </View>
      </View>
    </AnimatedPressable>
  );
}

export default function OnboardingPains() {
  const t = useTranslation();
  const copy = t.onboardingFlow.pains;
  const router = useRouter();
  const pains = useOnboardingStore((state) => state.pains);
  const setPains = useOnboardingStore((state) => state.setPains);

  // The fades show only where there's more to scroll to.
  const offset = useSharedValue(0);
  const contentHeight = useSharedValue(0);
  const boxHeight = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    offset.value = event.contentOffset.y;
  });
  const topFade = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, offset.value / FADE_TOP)) }));
  const bottomFade = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, (contentHeight.value - boxHeight.value - offset.value) / FADE_BOTTOM)),
  }));

  const toggle = (pain: OnboardingPain) => {
    void Haptics.selectionAsync().catch(() => {});
    // Kept in the screen's order, whatever order they were tapped in.
    setPains(pains.includes(pain) ? pains.filter((entry) => entry !== pain) : ONBOARDING_PAINS.filter((entry) => entry === pain || pains.includes(entry)));
  };

  return (
    <OnboardingScreen
      percent={ONB_PROGRESS.pains}
      onBack={() => router.back()}
      footer={
        <PrimaryButton
          label={t.onboardingFlow.continue}
          onPress={() => {
            posthog.capture("onboarding_pains_answered", { pains });
            router.push("/onboarding/load");
          }}
        />
      }
    >
      <View style={{ flex: 1, gap: 28 }}>
        <OnboardingTitle title={copy.headline} />
        <FadeUp delay={120} style={{ flex: 1, minHeight: 0, marginHorizontal: -6 }}>
          <Animated.ScrollView
            onScroll={onScroll}
            scrollEventThrottle={16}
            onLayout={(event) => {
              boxHeight.value = event.nativeEvent.layout.height;
            }}
            onContentSizeChange={(_, height) => {
              contentHeight.value = height;
            }}
            contentContainerStyle={{ gap: 10, paddingHorizontal: 6, paddingTop: 2, paddingBottom: 14 }}
            showsVerticalScrollIndicator={false}
          >
            {ONBOARDING_PAINS.map((pain) => (
              <PainRow key={pain} label={copy.options[pain]} selected={pains.includes(pain)} onToggle={() => toggle(pain)} />
            ))}
          </Animated.ScrollView>
          <Animated.View pointerEvents="none" style={[FILL, topFade]}>
            <PaperFade top={FADE_TOP} />
          </Animated.View>
          <Animated.View pointerEvents="none" style={[FILL, bottomFade]}>
            <PaperFade bottom={FADE_BOTTOM} />
          </Animated.View>
        </FadeUp>
      </View>
    </OnboardingScreen>
  );
}
