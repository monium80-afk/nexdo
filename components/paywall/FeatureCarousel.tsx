import { useEffect } from "react";
import { Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { cancelAnimation, useAnimatedStyle, useFrameCallback, useSharedValue, withDecay } from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { MAX_FONT_SCALE, useIsRtl, useSvgId } from "@/components/onboarding/OnboardingKit";
import { useTranslation } from "@/hooks/useTranslation";
import { PRO_FEATURES, type ProFeature, type ProFeatureId } from "@/lib/plan";

import { PW } from "./paywallTheme";

// The paywall's 7 feature cards (paywall-7b.html, m7Mq): an endless row that
// drifts left — one pass every 26 s — and can be swiped by hand. A touch
// stops the drift; it picks up again 3 s after the finger lets go. Opened
// from a locked feature, that feature's card starts at the front with a thin
// orange border. The row fades out at both screen edges.
//
// The drift runs on the UI thread (a frame callback moving one shared offset)
// and only while `moving` — the paywall in sight, Reduce Motion off. The
// cards are drawn three times over (the set before, the set, the set after),
// so wherever the offset wraps there's always a card under every pixel.

const CARD_W = 156;
const PITCH = CARD_W + 8;
/** One whole pass: 7 cards. */
const LOOP = PRO_FEATURES.length * PITCH;
const SPEED = LOOP / 26; // px per second
const LEFT = 20;
/** How long the drift waits after a touch, and before it first starts (the mock holds 6 % of a pass). */
const RESUME_MS = 3000;
const FIRST_HOLD_MS = 1500;
const EDGE = 20;

function useCardValue(feature: ProFeature) {
  const t = useTranslation();
  const copy = t.paywall;
  if (feature.amount === null) return copy.allTime;
  if (feature.unit === "sounds") return copy.allSounds(feature.amount);
  return new Intl.NumberFormat(t.locale).format(feature.amount);
}

function Card({ feature, height, highlighted, hidden }: { feature: ProFeature; height: number; highlighted: boolean; hidden: boolean }) {
  const t = useTranslation();
  const copy = t.paywall;
  const rtl = useIsRtl();
  const value = useCardValue(feature);
  const align = rtl ? "right" : "left";
  const { name, line } = copy.features[feature.id];
  return (
    <View
      accessible={!hidden}
      importantForAccessibility={hidden ? "no-hide-descendants" : "yes"}
      accessibilityElementsHidden={hidden}
      accessibilityLabel={`${name}: ${value} ${copy.units[feature.unit]}. ${line}`}
      style={{
        width: CARD_W,
        height,
        marginRight: PITCH - CARD_W,
        borderRadius: 22,
        backgroundColor: PW.card,
        borderWidth: highlighted ? 1.5 : 1,
        borderColor: highlighted ? PW.orange : "rgba(250,241,228,0.08)",
        paddingTop: highlighted ? 13.5 : 14,
        paddingHorizontal: highlighted ? 13.5 : 14,
        paddingBottom: highlighted ? 11.5 : 12,
      }}
    >
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: feature.amount === null ? 26 : 30, lineHeight: feature.amount === null ? 28 : 32, letterSpacing: feature.amount === null ? -0.78 : -0.9, color: PW.peach, textAlign: align }}
      >
        {value}
      </Text>
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{ marginTop: 2, fontFamily: "SpaceMono-Bold", fontSize: 10, lineHeight: 13, letterSpacing: 1.2, color: PW.unit, textTransform: "uppercase", textAlign: align, includeFontPadding: false }}
      >
        {copy.units[feature.unit]}
      </Text>
      <View style={{ flex: 1 }} />
      <Text numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 15, lineHeight: 19, color: PW.ink, textAlign: align }}>
        {name}
      </Text>
      <Text numberOfLines={2} maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ marginTop: 3, fontFamily: "SpaceGrotesk-Regular", fontSize: 12.5, lineHeight: 16.25, color: PW.muted, textAlign: align }}>
        {line}
      </Text>
    </View>
  );
}

/** The fade at one screen edge: the background colour melting into the row. */
function EdgeFade({ side, height }: { side: "left" | "right"; height: number }) {
  const id = useSvgId("edge");
  return (
    <Svg pointerEvents="none" width={EDGE} height={height} style={{ position: "absolute", top: 0, [side]: 0 }}>
      <Defs>
        <LinearGradient id={id} x1={side === "left" ? 0 : 1} y1={0} x2={side === "left" ? 1 : 0} y2={0}>
          <Stop offset={0} stopColor={PW.bg} />
          <Stop offset={1} stopColor={PW.bg} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect width={EDGE} height={height} fill={`url(#${id})`} />
    </Svg>
  );
}

export function FeatureCarousel({ cardHeight, highlight, moving }: { cardHeight: number; highlight: ProFeatureId | null; moving: boolean }) {
  const t = useTranslation();
  const start = Math.max(0, PRO_FEATURES.findIndex((feature) => feature.id === highlight));
  // How far the row has scrolled, in px (any number: it's wrapped when drawn).
  const offset = useSharedValue(start * PITCH);
  // Time since the row was last touched; the drift moves only once it reaches RESUME_MS.
  const idle = useSharedValue(RESUME_MS - (highlight ? RESUME_MS : FIRST_HOLD_MS));
  const touching = useSharedValue(false);
  const dragFrom = useSharedValue(0);

  const drift = useFrameCallback((frame) => {
    const dt = frame.timeSincePreviousFrame ?? 0;
    if (touching.value) return;
    if (idle.value < RESUME_MS) {
      idle.value += dt;
      return;
    }
    offset.value += (SPEED * dt) / 1000;
  }, false);

  useEffect(() => {
    drift.setActive(moving);
    return () => drift.setActive(false);
  }, [drift, moving]);

  const pan = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-14, 14])
    .onBegin(() => {
      touching.set(true);
      cancelAnimation(offset);
    })
    .onStart(() => {
      dragFrom.set(offset.value);
    })
    .onUpdate((event) => {
      offset.set(dragFrom.value - event.translationX);
    })
    .onEnd((event) => {
      offset.set(withDecay({ velocity: -event.velocityX, deceleration: 0.997 }));
    })
    .onFinalize(() => {
      touching.set(false);
      idle.set(0);
    });

  const rowStyle = useAnimatedStyle(() => {
    const wrapped = ((offset.value % LOOP) + LOOP) % LOOP;
    // The middle set sits at LEFT when the offset is 0.
    return { transform: [{ translateX: LEFT - LOOP - wrapped }] };
  });

  const sets = [0, 1, 2];
  return (
    <View accessibilityRole="list" accessibilityLabel={t.paywall.carouselLabel} style={{ height: cardHeight, overflow: "hidden" }}>
      <GestureDetector gesture={pan}>
        <View style={{ flex: 1 }}>
          <Animated.View style={[{ flexDirection: "row", width: LOOP * sets.length }, rowStyle]}>
            {sets.map((set) =>
              PRO_FEATURES.map((feature) => (
                <Card key={`${set}-${feature.id}`} feature={feature} height={cardHeight} highlighted={feature.id === highlight} hidden={set !== 1} />
              )),
            )}
          </Animated.View>
        </View>
      </GestureDetector>
      <EdgeFade side="left" height={cardHeight} />
      <EdgeFade side="right" height={cardHeight} />
    </View>
  );
}
