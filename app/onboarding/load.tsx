import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";

import { FadeUp, FitBox, MAX_FONT_SCALE, ONB, ONB_PROGRESS, OnboardingScreen, OnboardingTitle, PaperFade, PrimaryButton, useIsRtl, useSvgId } from "@/components/onboarding/OnboardingKit";
import { CSS_EASE } from "@/components/onboarding/timeline";
import { shadow } from "@/constants/shadow";
import { useTranslation } from "@/hooks/useTranslation";
import { posthog } from "@/lib/posthog";
import { ONBOARDING_LOADS, useOnboardingStore, type OnboardingLoad } from "@/store/useOnboardingStore";

// 05 · How much is on your mind right now? (screens/05-…html). A real slider
// with four stops. As it moves, task-shaped dashes pop into the head, the head
// tilts and its glow comes up. (The mock's LIGHT / HEAVY labels under the
// slider were removed, as asked 2026-11-12.)
//
// While the slider is being dragged (and for the moment it takes to snap and
// settle) everything follows the finger on the UI thread. At rest, React
// draws the head, the dashes, the fill and the knob from the chosen stop, so
// a stalled animation can never leave them half-way.

const AnimatedRect = Animated.createAnimatedComponent(Rect);

const HEAD_PATH =
  "M70 212 L70 172 C46 160 30 134 30 102 C30 52 70 18 118 18 C164 18 196 50 196 92 C196 102 194 110 198 118 L212 140 C215 146 212 150 206 151 L200 152 L200 168 C200 178 192 184 182 184 L162 184 L162 212 Z";

/**
 * The 22 dashes: x, y, width, colour, tilt — in the order they pop in. Laid
 * out so each one sits wholly inside the head (2026-11-13: the mock's, cut
 * off by the head's edge, looked broken), so nothing is clipped.
 */
const DASHES = [
  [82, 46, 26, "#F26A2E", 6], [112, 44, 32, "#FF9A5A", -8], [65, 60, 32, "#FFB089", -10], [99, 60, 20, "#F6C9AE", 12],
  [124, 60, 34, "#C4461A", -8], [59, 74, 26, "#F26A2E", 3], [90, 74, 32, "#FF9A5A", -16], [127, 74, 38, "#FFB089", -6],
  [52, 90, 26, "#F6C9AE", -18], [79, 90, 20, "#C4461A", 6], [101, 90, 38, "#F26A2E", -18], [140, 90, 32, "#FF9A5A", 14],
  [57, 104, 26, "#FFB089", -13], [90, 104, 38, "#F6C9AE", -19], [135, 104, 32, "#C4461A", -15], [62, 120, 20, "#F26A2E", 10],
  [90, 120, 26, "#FF9A5A", -10], [124, 120, 38, "#FFB089", 5], [70, 134, 26, "#F6C9AE", -6], [100, 134, 26, "#C4461A", -18],
  [128, 134, 32, "#F26A2E", -5], [96, 149, 32, "#FF9A5A", 8],
] as const;

/** Where each stop sits on the track (0–1), and how many dashes it fills the head with. */
const STOP_VALUES: Record<OnboardingLoad, number> = { few: 0, some: 1 / 3, many: 2 / 3, lots: 1 };
const KNOB = 26;
/** How far the slider sits in from the content's sides, and the width each stop's label is centred in. */
const SLIDER_INSET = 34;
const LABEL_W = 64;
const POP_EASE = Easing.bezierFn(0.3, 1.6, 0.5, 1);

/** How long after a release the snap and the dashes' pop take to finish. */
const SETTLE_MS = 650;

/** How many dashes show at a slider value: 3 at 1–5, all 22 from 10–20 (as the mock fills by then). */
function dashCount(value: number): number {
  "worklet";
  return Math.round(3 + Math.min(1, value / (2 / 3)) * 19);
}

function Dash({ index, value, moving, rest }: { index: number; value: SharedValue<number>; moving: boolean; rest: number }) {
  const [x, y, width, color] = DASHES[index];
  const reduceMotion = useReducedMotion();
  const pop = useSharedValue(index < dashCount(value.value) ? 1 : 0);
  useAnimatedReaction(
    () => (index < dashCount(value.value) ? 1 : 0),
    (target, previous) => {
      if (target === previous) return;
      pop.value = reduceMotion ? target : withTiming(target, { duration: 280, easing: target ? POP_EASE : CSS_EASE });
    },
  );
  const props = useAnimatedProps(() => {
    const scale = Math.max(0, pop.value);
    return {
      opacity: Math.min(1, scale),
      x: x + (width * (1 - scale)) / 2,
      y: y + (11 * (1 - scale)) / 2,
      width: width * scale,
      height: 11 * scale,
    };
  });
  if (!moving) return <Rect x={x} y={y} width={width} height={11} rx={5.5} fill={color} opacity={index < dashCount(rest) ? 1 : 0} />;
  return <AnimatedRect rx={5.5} fill={color} animatedProps={props} />;
}

/** The head's tilt and drop at a slider value. */
function tilt(v: number) {
  "worklet";
  return { transform: [{ translateY: 100 }, { rotate: `${v * 9}deg` }, { translateY: -100 + v * 6 }] };
}

/** The glow behind the head at a slider value. */
function glow(v: number) {
  "worklet";
  const p = Math.min(1, v / (2 / 3));
  return { opacity: 0.3 + 0.7 * p, transform: [{ scale: 0.8 + 0.25 * p }] };
}

function Head({ value, moving, rest }: { value: SharedValue<number>; moving: boolean; rest: number }) {
  const fillId = useSvgId("head");
  const glowId = useSvgId("headGlow");
  // At 10–20 the mock's head has tilted 6° and dropped 4 px (around a point
  // 90 % of the way down, 100 px below the middle); 20+ goes a little further.
  const tiltAnimated = useAnimatedStyle(() => tilt(value.value));
  const glowAnimated = useAnimatedStyle(() => glow(value.value));
  const tiltStyle = moving ? tiltAnimated : tilt(rest);
  const glowStyle = moving ? glowAnimated : glow(rest);
  return (
    <View style={{ width: 240, height: 250, alignSelf: "center" }}>
      <Animated.View style={[{ position: "absolute", left: 0, top: 40, width: 240, height: 240 }, glowStyle]}>
        <Svg width={240} height={240}>
          <Defs>
            <RadialGradient id={glowId} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={ONB.orange} stopOpacity={0.16} />
              <Stop offset="0.66" stopColor={ONB.paper} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width={240} height={240} fill={`url(#${glowId})`} />
        </Svg>
      </Animated.View>
      <Animated.View style={tiltStyle}>
        <Svg width={240} height={250} viewBox="22 6 200 208">
          <Defs>
            <LinearGradient id={fillId} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#FFFDF8" />
              <Stop offset="1" stopColor="#F4E8DA" />
            </LinearGradient>
          </Defs>
          <Path d={HEAD_PATH} fill={`url(#${fillId})`} stroke="#E6D8C8" strokeWidth={2.5} strokeLinejoin="round" />
          {DASHES.map(([dx, dy, width, , tilt], index) => (
            <G key={`${dx}-${dy}`} transform={`rotate(${tilt} ${dx + width / 2} ${dy + 5.5})`}>
              <Dash index={index} value={value} moving={moving} rest={rest} />
            </G>
          ))}
        </Svg>
        {/* The neck fades into the page (the mock's mask: solid to 80 %). */}
        <PaperFade bottom={50} />
      </Animated.View>
    </View>
  );
}

export default function OnboardingLoadScreen() {
  const t = useTranslation();
  const copy = t.onboardingFlow.load;
  const router = useRouter();
  const rtl = useIsRtl();
  const reduceMotion = useReducedMotion();
  const storedLoad = useOnboardingStore((state) => state.load);
  const setLoad = useOnboardingStore((state) => state.setLoad);
  const [load, setLocalLoad] = useState<OnboardingLoad>(storedLoad ?? "few");
  const [trackWidth, setTrackWidth] = useState(0);
  // Animated from the first touch until the snap has settled (see the note at
  // the top): while a finger is down, and for SETTLE_MS after each snap.
  const [dragging, setDragging] = useState(false);
  const [settling, setSettling] = useState(false);
  const [snaps, setSnaps] = useState(0);
  useEffect(() => {
    if (snaps === 0) return;
    const timer = setTimeout(() => setSettling(false), reduceMotion ? 0 : SETTLE_MS);
    return () => clearTimeout(timer);
  }, [snaps, reduceMotion]);
  const moving = dragging || settling;
  const startMoving = () => setDragging(true);

  // 0–1 along the track, following the finger; it snaps to a stop on release.
  const value = useSharedValue(STOP_VALUES[load]);
  const start = useSharedValue(0);

  const choose = (next: OnboardingLoad) => {
    if (next !== load) void Haptics.selectionAsync().catch(() => {});
    setLocalLoad(next);
    setLoad(next);
  };

  useEffect(() => {
    // An answer saved on an earlier visit (or the default) is the starting point.
    if (!storedLoad) setLoad("few");
  }, [setLoad, storedLoad]);

  const snapTo = (index: number) => {
    const next = ONBOARDING_LOADS[index];
    setDragging(false);
    setSettling(true);
    setSnaps((count) => count + 1);
    value.value = reduceMotion ? STOP_VALUES[next] : withTiming(STOP_VALUES[next], { duration: 220, easing: CSS_EASE });
    choose(next);
  };

  const fromX = (x: number) => {
    "worklet";
    const along = trackWidth > 0 ? x / trackWidth : 0;
    return Math.min(1, Math.max(0, rtl ? 1 - along : along));
  };

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((event) => {
      scheduleOnRN(startMoving);
      start.value = fromX(event.x);
      value.value = start.value;
    })
    .onUpdate((event) => {
      value.value = fromX(event.x);
    })
    .onFinalize(() => {
      scheduleOnRN(snapTo, Math.round(value.value * 3));
    });

  // The fill is the whole track, scaled from its start: only a transform animates.
  const fillAt = (v: number) => {
    "worklet";
    return { transform: [{ scaleX: v }] };
  };
  const knobAt = (v: number) => {
    "worklet";
    return { transform: [{ translateX: (rtl ? 1 - v : v) * trackWidth - KNOB / 2 }] };
  };
  const fillAnimated = useAnimatedStyle(() => fillAt(value.value));
  const knobAnimated = useAnimatedStyle(() => knobAt(value.value));
  const rest = STOP_VALUES[load];
  const fillStyle = moving ? fillAnimated : fillAt(rest);
  const knobStyle = moving ? knobAnimated : knobAt(rest);
  const fillId = useSvgId("loadFill");
  const index = ONBOARDING_LOADS.indexOf(load);

  return (
    <OnboardingScreen
      percent={ONB_PROGRESS.load}
      onBack={() => router.back()}
      footer={
        <PrimaryButton
          label={t.onboardingFlow.continue}
          onPress={() => {
            posthog.capture("onboarding_load_answered", { load });
            router.push("/onboarding/mic");
          }}
        />
      }
    >
      <View style={{ flex: 1, gap: 28 }}>
        <OnboardingTitle title={copy.headline} body={copy.body} />
        <FadeUp delay={120} style={{ flex: 1, minHeight: 0 }}>
          {/* The head takes what room is left above the slider, shrinking on a short phone. */}
          <FitBox width={240} height={268} natural>
            <View style={{ height: 18 }} />
            <Head value={value} moving={moving} rest={rest} />
          </FitBox>

          {/* The slider a little shorter than the content (asked 2026-11-13); each label sits under its stop. */}
          <View style={{ marginTop: 26, marginHorizontal: SLIDER_INSET }}>
            <GestureDetector gesture={pan}>
              <View
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel={copy.slider}
                accessibilityValue={{ text: copy.stops[load] }}
                accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
                onAccessibilityAction={(event) => {
                  if (event.nativeEvent.actionName === "increment") snapTo(Math.min(3, index + 1));
                  if (event.nativeEvent.actionName === "decrement") snapTo(Math.max(0, index - 1));
                }}
                hitSlop={{ top: 14, bottom: 14 }}
                style={{ height: KNOB, justifyContent: "center" }}
                onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
              >
                <View style={{ position: "absolute", left: 0, right: 0, top: 11, height: 4, borderRadius: 2, backgroundColor: ONB.track }} />
                <Animated.View style={[{ position: "absolute", left: 0, right: 0, top: 11, height: 4, borderRadius: 2, overflow: "hidden", transformOrigin: rtl ? "right" : "left" }, fillStyle]}>
                  <Svg width="100%" height={4}>
                    <Defs>
                      <LinearGradient id={fillId} x1={rtl ? "1" : "0"} y1="0" x2={rtl ? "0" : "1"} y2="0">
                        <Stop offset="0" stopColor="#FFB089" />
                        <Stop offset="1" stopColor={ONB.orange} />
                      </LinearGradient>
                    </Defs>
                    <Rect width="100%" height={4} fill={`url(#${fillId})`} />
                  </Svg>
                </Animated.View>
                <Animated.View
                  style={[
                    { position: "absolute", left: 0, top: 0, width: KNOB, height: KNOB, borderRadius: 13, backgroundColor: "#FFFFFF", borderWidth: 3, borderColor: ONB.orange },
                    shadow("0 4px 10px rgba(242,106,46,0.35)", 4, ONB.orange),
                    knobStyle,
                  ]}
                />
              </View>
            </GestureDetector>
            <View style={{ marginTop: 10, height: 20 }}>
              {ONBOARDING_LOADS.map((stop) => {
                const at = rtl ? 1 - STOP_VALUES[stop] : STOP_VALUES[stop];
                return (
                  <Text
                    key={stop}
                    onPress={() => snapTo(ONBOARDING_LOADS.indexOf(stop))}
                    maxFontSizeMultiplier={MAX_FONT_SCALE}
                    style={{
                      position: "absolute",
                      left: at * trackWidth - LABEL_W / 2,
                      width: LABEL_W,
                      textAlign: "center",
                      fontSize: 13,
                      fontFamily: stop === load ? "SpaceGrotesk-Bold" : "SpaceGrotesk-SemiBold",
                      color: stop === load ? ONB.ink : ONB.muted,
                    }}
                  >
                    {copy.stops[stop]}
                  </Text>
                );
              })}
            </View>
          </View>
        </FadeUp>
      </View>
    </OnboardingScreen>
  );
}
