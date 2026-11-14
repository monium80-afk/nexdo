import { useEffect } from "react";
import { Modal, Pressable, Text, useWindowDimensions, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { MAX_FONT_SCALE, useIsRtl } from "@/components/onboarding/OnboardingKit";
import { useTranslation } from "@/hooks/useTranslation";
import { PRO_FEATURES, type ProFeatureId } from "@/lib/plan";

import { useCardValue } from "./FeatureCarousel";
import { PW } from "./paywallTheme";

// One Pro feature, explained: the card that opens over the paywall when one of
// the carousel's cards is tapped (the user's call, 2026-11-14 — the cards
// themselves are now just a number and a name). The paywall dims behind it;
// a tap outside or "Got it" closes it.

/** The card's own dark, solid: the paywall's translucent card colour would go black over the dim. */
const CARD_BG = "#2B221C";

function DetailCard({ feature, onClose }: { feature: ProFeatureId; onClose: () => void }) {
  const t = useTranslation();
  const copy = t.paywall;
  const rtl = useIsRtl();
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const pro = PRO_FEATURES.find((entry) => entry.id === feature) ?? PRO_FEATURES[0];
  const value = useCardValue(pro);
  const { name, line, detail } = copy.features[pro.id];
  const align = rtl ? "right" : "left";
  const big = pro.amount !== null;

  // Pops in once: a touch smaller and clear, to full size (0.26 s).
  const pop = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) return;
    pop.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) });
  }, [pop, reduceMotion]);
  const popStyle = useAnimatedStyle(() => ({ opacity: pop.value, transform: [{ scale: 0.94 + 0.06 * pop.value }] }));

  return (
    <Animated.View
      accessibilityViewIsModal
      style={[
        { width: Math.min(width - 48, 360), borderRadius: 28, borderWidth: 1, borderColor: PW.line, backgroundColor: CARD_BG, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 20 },
        popStyle,
      ]}
    >
      {/* A blocker: a tap on the card itself shouldn't close it. */}
      <Pressable onPress={() => {}} accessible={false}>
        {big ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ fontFamily: "SpaceMono-Bold", fontSize: 10.5, lineHeight: 14, letterSpacing: 1.2, color: PW.unit, textTransform: "uppercase", textAlign: align, includeFontPadding: false }}>
            {copy.everyMonth}
          </Text>
        ) : null}
        <View style={{ flexDirection: rtl ? "row-reverse" : "row", alignItems: "baseline", gap: 8, marginTop: big ? 6 : 0 }}>
          <Text numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ flexShrink: 1, fontFamily: "SpaceGrotesk-Bold", fontSize: 44, lineHeight: 48, letterSpacing: -1.3, color: PW.peach }}>
            {value}
          </Text>
          <Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ fontFamily: "SpaceMono-Bold", fontSize: 12, lineHeight: 15, letterSpacing: 1.4, color: PW.unit, textTransform: "uppercase", includeFontPadding: false }}>
            {copy.units[pro.unit]}
          </Text>
        </View>
        <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ marginTop: 10, fontFamily: "SpaceGrotesk-Bold", fontSize: 21, lineHeight: 26, color: PW.ink, textAlign: align }}>
          {name}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ marginTop: 4, fontFamily: "SpaceGrotesk-SemiBold", fontSize: 15, lineHeight: 20, color: PW.peach, textAlign: align }}>
          {line}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ marginTop: 10, fontFamily: "SpaceGrotesk-Regular", fontSize: 14.5, lineHeight: 21, color: PW.soft, textAlign: align }}>
          {detail}
        </Text>
        <AnimatedPressable
          onPress={onClose}
          scaleTo={0.97}
          accessibilityRole="button"
          accessibilityLabel={copy.gotIt}
          style={{ marginTop: 20, height: 46, borderRadius: 23, backgroundColor: PW.glass, alignItems: "center", justifyContent: "center" }}
        >
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ fontFamily: "SpaceGrotesk-SemiBold", fontSize: 15, lineHeight: 19, color: PW.ink }}>
            {copy.gotIt}
          </Text>
        </AnimatedPressable>
      </Pressable>
    </Animated.View>
  );
}

/**
 * `open` shows it; `feature` is what it shows, kept by the caller while it
 * fades out so the card doesn't empty mid-fade.
 */
export function FeatureDetail({ open, feature, onClose }: { open: boolean; feature: ProFeatureId | null; onClose: () => void }) {
  const t = useTranslation();
  return (
    <Modal visible={open && feature !== null} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t.paywall.close}
        style={{ flex: 1, backgroundColor: "rgba(10,6,4,0.66)", alignItems: "center", justifyContent: "center", padding: 24 }}
      >
        {feature ? <DetailCard feature={feature} onClose={onClose} /> : null}
      </Pressable>
    </Modal>
  );
}
