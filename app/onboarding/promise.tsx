import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";

import {
  ABOVE_SHADOW,
  FadeUp,
  FitBox,
  MAX_FONT_SCALE,
  ONB,
  ONB_PROGRESS,
  OnboardingScreen,
  OnboardingTitle,
  PrimaryButton,
  useSvgId,
} from "@/components/onboarding/OnboardingKit";
import { CSS_EASE } from "@/components/onboarding/timeline";
import { shadow } from "@/constants/shadow";
import { useTranslation } from "@/hooks/useTranslation";
import { posthog } from "@/lib/posthog";
import { useOnboardingStore } from "@/store/useOnboardingStore";

// 11 · Make it a promise (screens/11-make-it-a-promise.html). The sentence
// comes from the answers on 04. Press and hold the fingerprint: the ring
// closes and the print fills with orange from the bottom (1.8 s, with
// haptics); let go early and it drains back. Then "✓ Committed" and
// Continue. A screen reader commits with a double-tap.
//
// Only while something moves (held, draining, the 0.7 s "committed" reveal)
// is it animated; otherwise React draws it still — not pressed, or committed
// with Continue showing — so nothing stays half-drawn if an animation didn't run.

/** How long a hold takes to commit (the mock's 1.5 s, a little slower at the user's request). */
const HOLD_MS = 1800;
const DONE_MS = 700;
const RING = 2 * Math.PI * 96;
const HOLD_EASE = Easing.bezierFn(0.4, 0, 0.6, 1);
/** The print's drawn size (a 24-unit icon; the mock's 112 px, a little bigger at the user's request), centred where the mock's sits. */
const PRINT_SIZE = 124;
const PRINT_LEFT = 110 - PRINT_SIZE / 2;
const PRINT_TOP = 108 - PRINT_SIZE / 2;
const UNIT = PRINT_SIZE / 24;

type Phase = "idle" | "moving" | "committing" | "done";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const PRINT = [
  "M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4",
  "M14 13.12c0 2.38 0 6.38-1 8.88",
  "M17.29 21.02c.12-.6.43-2.3.5-3.02",
  "M2 12a10 10 0 0 1 18-6",
  "M21.8 16c.2-2 .131-5.354 0-6",
  "M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2",
  "M8.65 22c.21-.66.45-1.32.57-2",
  "M9 6.8a6 6 0 0 1 9 5.2v2",
];

/**
 * How far down the orange print is hidden, in px, for a hold of `p` (0–1).
 * The mock's clip rises 28 units from y 26 to y −2 over a 24-unit icon.
 */
function fillOffset(p: number) {
  "worklet";
  return Math.min(PRINT_SIZE, Math.max(0, (26 - 28 * p) * UNIT));
}

/** fGlow: in with a small overshoot, settling at 75 %. */
function glowFrame(p: number) {
  "worklet";
  const scale = p < 0.5 ? 0.85 + (p / 0.5) * 0.25 : 1.1 - ((p - 0.5) / 0.5) * 0.1;
  const opacity = p < 0.5 ? p / 0.5 : 1 - ((p - 0.5) / 0.5) * 0.25;
  return { opacity, transform: [{ scale }] };
}

function PrintPaths({ stroke }: { stroke: string }) {
  return (
    <G fill="none" stroke={stroke} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      {PRINT.map((d) => (
        <Path key={d} d={d} />
      ))}
    </G>
  );
}

export default function OnboardingPromise() {
  const t = useTranslation();
  const copy = t.onboardingFlow.promise;
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const pains = useOnboardingStore((state) => state.pains);
  const [phase, setPhase] = useState<Phase>("idle");
  const committed = phase === "committing" || phase === "done";
  const ids = { print: useSvgId("fpGrad"), glow: useSvgId("fpGlow") };

  // "This week, I'll <first answer> and <second answer, or get more done>."
  const first = pains[0] ? copy.phrases[pains[0]] : copy.phrases.overwhelmed;
  const second = pains[1] ? copy.phrases[pains[1]] : copy.moreDone;
  const sentence = copy.sentence(first, second);

  const hold = useSharedValue(0);
  const done = useSharedValue(0);
  const ticks = useRef<ReturnType<typeof setInterval> | null>(null);
  // Read by the press handlers, which can run with a render-old `phase`.
  const committedRef = useRef(false);

  const stopTicks = () => {
    if (ticks.current) clearInterval(ticks.current);
    ticks.current = null;
  };
  useEffect(() => stopTicks, []);

  // The "committed" reveal plays once, then React draws the committed state.
  useEffect(() => {
    if (phase !== "committing") return;
    const timer = setTimeout(() => setPhase("done"), DONE_MS + 100);
    return () => clearTimeout(timer);
  }, [phase]);

  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    stopTicks();
    cancelAnimation(hold);
    hold.value = 1;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    posthog.capture("onboarding_promise_committed", { pains });
    if (reduceMotion) {
      done.value = 1;
      setPhase("done");
      return;
    }
    done.value = 0;
    done.value = withTiming(1, { duration: DONE_MS, easing: CSS_EASE });
    setPhase("committing");
  };

  const handlePressIn = () => {
    if (committedRef.current) return;
    setPhase("moving");
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // A soft tick every quarter of the way.
    stopTicks();
    ticks.current = setInterval(() => void Haptics.selectionAsync().catch(() => {}), HOLD_MS / 4);
    hold.value = withTiming(1, { duration: HOLD_MS * (1 - hold.value), easing: HOLD_EASE }, (finished) => {
      "worklet";
      if (finished) scheduleOnRN(commit);
    });
  };

  // Drained back to nothing: drawn still again (unless it was committed meanwhile).
  const settleIdle = () => {
    if (!committedRef.current) setPhase("idle");
  };

  const handlePressOut = () => {
    if (committedRef.current) return;
    stopTicks();
    cancelAnimation(hold);
    hold.value = withTiming(0, { duration: 260, easing: CSS_EASE }, (finished) => {
      "worklet";
      if (finished) scheduleOnRN(settleIdle);
    });
  };

  // Animated while moving; drawn still otherwise.
  const ringAnimated = useAnimatedProps(() => ({ strokeDashoffset: RING * (1 - hold.value) }));
  const fillOuterAnimated = useAnimatedStyle(() => ({ transform: [{ translateY: fillOffset(hold.value) }] }));
  const fillInnerAnimated = useAnimatedStyle(() => ({ transform: [{ translateY: -fillOffset(hold.value) }] }));
  const glowAnimated = useAnimatedStyle(() => glowFrame(done.value));
  const holdAnimated = useAnimatedStyle(() => ({ opacity: 1 - done.value }));
  const doneAnimated = useAnimatedStyle(() => ({ opacity: done.value, transform: [{ translateY: (1 - done.value) * 6 }] }));
  const ctaAnimated = useAnimatedStyle(() => ({ opacity: done.value, transform: [{ translateY: (1 - done.value) * 10 }] }));

  const held = phase === "done" ? 1 : 0;
  const shown = phase === "done" ? 1 : 0;
  const ringStill = { strokeDashoffset: RING * (1 - held) };
  const fillOuter = phase === "moving" || phase === "committing" ? fillOuterAnimated : { transform: [{ translateY: fillOffset(held) }] };
  const fillInner = phase === "moving" || phase === "committing" ? fillInnerAnimated : { transform: [{ translateY: -fillOffset(held) }] };
  const revealing = phase === "committing";
  const glowStyle = revealing ? glowAnimated : glowFrame(shown);
  const holdStyle = revealing ? holdAnimated : { opacity: 1 - shown };
  const doneStyle = revealing ? doneAnimated : { opacity: shown, transform: [{ translateY: (1 - shown) * 6 }] };
  const ctaStyle = revealing ? ctaAnimated : { opacity: shown, transform: [{ translateY: (1 - shown) * 10 }] };

  return (
    <OnboardingScreen
      percent={ONB_PROGRESS.promise}
      onBack={() => router.back()}
      footer={
        <Animated.View style={ctaStyle} pointerEvents={committed ? "auto" : "none"}>
          <PrimaryButton label={t.onboardingFlow.continue} onPress={() => router.push("/onboarding/paywall")} />
        </Animated.View>
      }
    >
      <View style={{ flex: 1, gap: 28 }}>
        <OnboardingTitle title={copy.headline} center />
        <FadeUp delay={120} style={{ flex: 1, minHeight: 0, justifyContent: "center" }}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="mb-[40px] text-center font-grotesk-semibold text-[19px] leading-[25px] text-[#221C17]">
            {sentence}
          </Text>

          {/* Shrinks on a short phone so the label and Continue stay on screen. */}
          <FitBox width={220} height={220} natural>
            <Pressable
              onPressIn={handlePressIn}
              onPressOut={handlePressOut}
              accessibilityRole="button"
              accessibilityLabel={copy.holdLabel}
              accessibilityHint={sentence}
              accessibilityState={{ checked: committed }}
              accessibilityActions={[{ name: "activate", label: copy.holdLabel }]}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === "activate" && !committed) commit();
              }}
              style={{ width: 220, height: 220, alignSelf: "center" }}
            >
              <Animated.View pointerEvents="none" style={[{ position: "absolute", left: -34, top: -34, width: 288, height: 288 }, glowStyle]}>
                <Svg width={288} height={288}>
                  <Defs>
                    {/* CSS sizes the mock's radial-gradient to the box's corner (√2 × half the side), so the glow reaches past the disc. */}
                    <RadialGradient id={ids.glow} cx="50%" cy="50%" r="70.7%">
                      <Stop offset="0" stopColor="#FFAA5A" stopOpacity={0.42} />
                      <Stop offset="0.64" stopColor={ONB.paper} stopOpacity={0} />
                    </RadialGradient>
                  </Defs>
                  <Rect width={288} height={288} fill={`url(#${ids.glow})`} />
                </Svg>
              </Animated.View>
              <View
                pointerEvents="none"
                style={[{ position: "absolute", left: 14, top: 14, width: 192, height: 192, borderRadius: 96, backgroundColor: "#FFFDF8" }, shadow("0 14px 26px rgba(60,35,15,0.13)", 8)]}
              />
              {/* Above the disc's shadow: Android would otherwise draw the disc over the ring and print. */}
              <View pointerEvents="none" style={[{ position: "absolute", left: 0, top: 0, width: 220, height: 220 }, ABOVE_SHADOW]}>
                <Svg width={220} height={220} style={{ position: "absolute" }}>
                  <Circle cx={110} cy={110} r={96} fill="none" stroke="#EFE3D4" strokeWidth={3} />
                  {phase === "moving" || phase === "committing" ? (
                    <AnimatedCircle
                      cx={110}
                      cy={110}
                      r={96}
                      fill="none"
                      stroke={ONB.orange}
                      strokeWidth={3.5}
                      strokeLinecap="round"
                      strokeDasharray={RING}
                      transform="rotate(-90 110 110)"
                      animatedProps={ringAnimated}
                    />
                  ) : (
                    <Circle
                      cx={110}
                      cy={110}
                      r={96}
                      fill="none"
                      stroke={ONB.orange}
                      strokeWidth={3.5}
                      strokeLinecap="round"
                      strokeDasharray={RING}
                      strokeDashoffset={ringStill.strokeDashoffset}
                      transform="rotate(-90 110 110)"
                    />
                  )}
                </Svg>
                <Svg width={PRINT_SIZE} height={PRINT_SIZE} viewBox="0 0 24 24" style={{ position: "absolute", left: PRINT_LEFT, top: PRINT_TOP }}>
                  <PrintPaths stroke="#D5C7B8" />
                </Svg>
                {/* The orange print, revealed from the bottom: a window slides up while the print inside it stays put. */}
                <Animated.View style={[{ position: "absolute", left: PRINT_LEFT, top: PRINT_TOP, width: PRINT_SIZE, height: PRINT_SIZE, overflow: "hidden" }, fillOuter]}>
                  <Animated.View style={fillInner}>
                    <Svg width={PRINT_SIZE} height={PRINT_SIZE} viewBox="0 0 24 24">
                      <Defs>
                        <LinearGradient id={ids.print} x1="0" y1="1" x2="0" y2="0">
                          <Stop offset="0" stopColor="#E0561C" />
                          <Stop offset="1" stopColor="#FF9A5A" />
                        </LinearGradient>
                      </Defs>
                      <PrintPaths stroke={`url(#${ids.print})`} />
                    </Svg>
                  </Animated.View>
                </Animated.View>
              </View>
            </Pressable>
          </FitBox>

          <View style={{ height: 24, marginTop: 34 }}>
            <Animated.Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[{ position: "absolute", left: 0, right: 0, textAlign: "center", fontSize: 15, fontFamily: "SpaceGrotesk-Bold", color: ONB.muted }, holdStyle]}
            >
              {copy.hold}
            </Animated.Text>
            <Animated.View style={[{ position: "absolute", left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }, doneStyle]}>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={ONB.deepOrange} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M5 12.5l4.5 4.5L19 7.5" />
              </Svg>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="font-grotesk-bold text-[15px] text-[#C4461A]">
                {copy.committed}
              </Text>
            </Animated.View>
          </View>
        </FadeUp>
      </View>
    </OnboardingScreen>
  );
}
