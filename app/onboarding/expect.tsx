import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import Animated, { Easing, useAnimatedProps } from "react-native-reanimated";
import Svg, { Circle, ClipPath, Defs, G, Path, RadialGradient, Rect, Stop, Text as SvgText } from "react-native-svg";

import {
  CheckDot,
  FadeUp,
  FitBox,
  MAX_FONT_SCALE,
  ONB,
  ONB_PROGRESS,
  OnboardingScreen,
  OnboardingTitle,
  PaperFade,
  PlainGem,
  PrimaryButton,
  rowDirection,
  useIsRtl,
  useSvgId,
} from "@/components/onboarding/OnboardingKit";
import { at, CSS_EASE, kf, useTimeline, useTimelineStyle, type Timeline } from "@/components/onboarding/timeline";
import { useTranslation } from "@/hooks/useTranslation";

// 09 · What to expect (screens/09-what-to-expect.html, a 9 s loop). A dark
// head with a tangle in it; the gem drops in and lights it up, the tangle
// goes, a neat checklist forms and is ticked off. Plays once and holds the
// ordered state — drawn plainly by React once the timeline has settled.

const LOOP = 9;
const END = at(86, LOOP);
const LIGHT_EASE = Easing.bezierFn(0.3, 0.7, 0.2, 1);
const GEM_EASE = Easing.bezierFn(0.45, 0, 0.2, 1);
const POP_EASE = Easing.bezierFn(0.3, 1.6, 0.5, 1);

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedPath = Animated.createAnimatedComponent(Path);

const HEAD_PATH =
  "M70 212 L70 172 C46 160 30 134 30 102 C30 52 70 18 118 18 C164 18 196 50 196 92 C196 102 194 110 198 118 L212 140 C215 146 212 150 206 151 L200 152 L200 168 C200 178 192 184 182 184 L162 184 L162 212 Z";

const TANGLE = [
  "M107 98 S130 80 140 71 S78 124 94 60 S124 62 86 59 S78 60 89 96 S153 61 149 109 S125 135 105 88",
  "M81 87 S127 80 112 126 S142 106 92 77 S122 98 96 62 S92 91 127 118 S139 111 109 61 S101 122 129 113",
  "M138 61 S123 57 89 75 S108 56 79 114 S124 63 125 98 S87 107 150 84 S142 105 92 66 S97 107 102 120",
  "M98 58 S122 99 98 109 S113 76 123 72 S97 87 139 119 S118 133 98 129 S78 74 97 63 S151 109 115 122",
  "M83 91 S95 87 125 125 S84 133 84 125 S93 72 133 79 S122 97 116 119 S99 80 96 110 S114 130 118 63",
  "M84 125 S98 98 146 109 S90 63 136 86 S88 53 147 113 S82 86 127 91 S114 107 94 109 S98 63 131 58",
];

/**
 * The gem's path, in four keyframes (8, 16, 26, 34 %). A worklet of its own:
 * a plain helper defined inside an animation gets moved out of it when the
 * app is built, and calling it from the UI thread was what stopped the app
 * going from 08 to here ("Tried to synchronously call a Remote Function",
 * 2026-11-12).
 */
function gemFrames(values: [number, number, number, number]) {
  "worklet";
  return [
    [at(8, LOOP), values[0]],
    [at(16, LOOP), values[1]],
    [at(26, LOOP), values[2]],
    [at(34, LOOP), values[3]],
  ] as const;
}

/**
 * One checklist row inside the head: in at (44 + 3i) %, ticked at (58 + 8i) %.
 * Only opacity and a radius animate (a `transform` fed to an SVG element
 * through animated props closes the app on Android). Once the timeline has
 * settled, the row is drawn with plain props: shown and ticked.
 */
function CheckRow({ timeline, index, label }: { timeline: Timeline; index: number; label: string }) {
  const clock = timeline.t;
  const y = 63 + 24 * index;
  const rowProps = useAnimatedProps(() => ({
    opacity: kf(clock.value, [[at(44 + 3 * index, LOOP), 0], [at(50 + 3 * index, LOOP), 1]], CSS_EASE),
  }));
  // The tick pops in: its disc grows past full size and settles (POP_EASE overshoots).
  const discProps = useAnimatedProps(() => {
    const p = kf(clock.value, [[at(58 + 8 * index, LOOP), 0], [at(62 + 8 * index, LOOP), 1]], POP_EASE);
    return { r: 5.5 * Math.max(0, p), opacity: Math.min(1, Math.max(0, p)) };
  });
  const markProps = useAnimatedProps(() => ({
    opacity: kf(clock.value, [[at(59 + 8 * index, LOOP), 0], [at(62 + 8 * index, LOOP), 1]], CSS_EASE),
  }));
  const tick = `M73.6 ${y + 9.2} l1.6 1.6 l3-3.2`;
  const content = (
    <>
      <Rect x={66} y={y} width={100} height={18} rx={9} fill="#FFFDF8" stroke="#EADCCB" />
      <Circle cx={76} cy={y + 9} r={5} fill="none" stroke={ONB.ring} strokeWidth={1.6} />
      {timeline.settled ? (
        <>
          <Circle cx={76} cy={y + 9} r={5.5} fill={ONB.orange} />
          <Path d={tick} fill="none" stroke="#FFFFFF" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <AnimatedCircle cx={76} cy={y + 9} fill={ONB.orange} animatedProps={discProps} />
          <AnimatedPath d={tick} fill="none" stroke="#FFFFFF" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" animatedProps={markProps} />
        </>
      )}
      <SvgText x={86} y={y + 12.5} fontFamily="SpaceGrotesk-Bold" fontSize={9.5} fill={ONB.ink}>
        {label}
      </SvgText>
    </>
  );
  return timeline.settled ? <G>{content}</G> : <AnimatedG animatedProps={rowProps}>{content}</AnimatedG>;
}

function LitHead({ timeline }: { timeline: Timeline }) {
  const t = useTranslation();
  const clock = timeline.t;
  const ids = { head: useSvgId("wh"), mind: useSvgId("wm"), light: useSvgId("wl"), glow: useSvgId("wg") };
  // The light spreading through the head. Never a radius of 0: Android can't
  // make a gradient for a shape with no size and closes the app (the crash
  // going from 08 to here, 2026-11-12) — at the start it's a 1-unit circle,
  // hidden.
  const lightProps = useAnimatedProps(() => {
    const p = kf(clock.value, [[at(24, LOOP), 0], [at(42, LOOP), 1]], LIGHT_EASE);
    return { r: Math.max(1, 150 * p), opacity: p > 0.004 ? 1 : 0 };
  });
  const tangleProps = useAnimatedProps(() => ({ opacity: kf(clock.value, [[at(26, LOOP), 1], [at(40, LOOP), 0]], CSS_EASE) }));
  const glowStyle = useTimelineStyle(timeline, (time) => {
    "worklet";
    const p = kf(time, [[at(26, LOOP), 0], [at(44, LOOP), 1]], CSS_EASE);
    return { opacity: p, transform: [{ scale: 0.7 + 0.3 * p }] };
  });
  const gemStyle = useTimelineStyle(timeline, (time) => {
    "worklet";
    const frames = gemFrames;
    return {
      opacity: kf(time, [[at(8, LOOP), 0], [at(16, LOOP), 1]], GEM_EASE),
      transform: [
        { translateX: kf(time, frames([0, 0, 4, -62]), GEM_EASE) },
        { translateY: kf(time, frames([-30, 0, 106, 24]), GEM_EASE) },
        { scale: kf(time, frames([0.8, 1, 0.9, 0.8]), GEM_EASE) },
      ],
    };
  });

  return (
    <View style={{ width: 270, height: 290, alignSelf: "center" }}>
      <Animated.View style={[{ position: "absolute", left: 135 - 160, top: 20, width: 320, height: 320 }, glowStyle]}>
        <Svg width={320} height={320}>
          <Defs>
            <RadialGradient id={ids.glow} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#FFB464" stopOpacity={0.5} />
              <Stop offset="0.64" stopColor={ONB.paper} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width={320} height={320} fill={`url(#${ids.glow})`} />
        </Svg>
      </Animated.View>
      <Svg width={270} height={290} viewBox="22 6 200 208">
        <Defs>
          <ClipPath id={ids.mind}>
            <Circle cx={114} cy={98} r={68} />
          </ClipPath>
          <ClipPath id={ids.head}>
            <Path d={HEAD_PATH} />
          </ClipPath>
          <RadialGradient id={ids.light} cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor="#FFE2B0" />
            <Stop offset="0.55" stopColor="#FFF4E4" />
            <Stop offset="1" stopColor="#FCEFDF" />
          </RadialGradient>
        </Defs>
        <Path d={HEAD_PATH} fill="#2A1E17" />
        <G clipPath={`url(#${ids.head})`}>
          {/* Settled: the head is lit and the tangle gone, drawn plainly. */}
          {timeline.settled ? (
            <Circle cx={112} cy={104} r={150} fill={`url(#${ids.light})`} />
          ) : (
            <>
              <AnimatedCircle cx={112} cy={104} r={1} fill={`url(#${ids.light})`} animatedProps={lightProps} />
              <AnimatedG clipPath={`url(#${ids.mind})`} animatedProps={tangleProps}>
                <G transform="translate(114 96) scale(1.32) translate(-114 -96)">
                  {TANGLE.map((d) => (
                    <Path key={d} d={d} fill="none" stroke="#FAF1E4" strokeOpacity={0.32} strokeWidth={2} strokeLinecap="round" />
                  ))}
                </G>
              </AnimatedG>
            </>
          )}
          {t.onboardingFlow.expect.tasks.map((label, index) => (
            <CheckRow key={label} timeline={timeline} index={index} label={label} />
          ))}
        </G>
        <Path d={HEAD_PATH} fill="none" stroke="#E6D8C8" strokeWidth={2.5} strokeLinejoin="round" />
      </Svg>
      {/* The neck fades into the page (the mock's mask: solid to 82 %). */}
      <PaperFade bottom={52} />
      <Animated.View style={[{ position: "absolute", left: 135 - 46, top: 0, width: 64 }, gemStyle]}>
        <PlainGem width={64} />
      </Animated.View>
    </View>
  );
}

function OutcomeItems({ outcomes, rtl }: { outcomes: readonly string[]; rtl: boolean }) {
  return outcomes.map((outcome) => (
    <View key={outcome} style={[{ alignItems: "center", gap: 6 }, rowDirection(rtl)]}>
      <CheckDot />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="font-grotesk-bold text-[14px] text-[#221C17]">
        {outcome}
      </Text>
    </View>
  ));
}

/**
 * "✓ Clear head  ✓ Organized  ✓ More done": one line, centred under the head.
 * On a narrow phone or with larger text it shrinks a little rather than
 * wrapping (a lone item on a second line looked off-centre).
 */
function Outcomes({ outcomes, rtl }: { outcomes: readonly string[]; rtl: boolean }) {
  const [room, setRoom] = useState(0);
  const [natural, setNatural] = useState(0);
  const scale = room > 0 && natural > 0 ? Math.min(1, room / natural) : 1;
  const row = [{ alignItems: "center", columnGap: 12 } as const, rowDirection(rtl)];
  return (
    <View style={{ alignItems: "center" }} onLayout={(event) => setRoom(event.nativeEvent.layout.width)}>
      {/* An unseen copy at its natural width, to measure it. */}
      <View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={{ position: "absolute", left: 0, top: 0, width: 4000, alignItems: "flex-start", opacity: 0 }}>
        <View style={row} onLayout={(event) => setNatural(event.nativeEvent.layout.width)}>
          <OutcomeItems outcomes={outcomes} rtl={rtl} />
        </View>
      </View>
      <View style={[row, { width: natural || undefined, transform: [{ scale }] }]}>
        <OutcomeItems outcomes={outcomes} rtl={rtl} />
      </View>
    </View>
  );
}

export default function OnboardingExpect() {
  const t = useTranslation();
  const copy = t.onboardingFlow.expect;
  const router = useRouter();
  const rtl = useIsRtl();
  const timeline = useTimeline(END);

  return (
    <OnboardingScreen
      percent={ONB_PROGRESS.expect}
      onBack={() => router.back()}
      footer={<PrimaryButton label={t.onboardingFlow.continue} onPress={() => router.push("/onboarding/nudge")} />}
    >
      <View style={{ flex: 1, gap: 12 }}>
        <OnboardingTitle title={copy.headline} body={copy.body} />
        {/* The head keeps its size, shrinking only on a short phone; the outcomes sit right under it, centred. */}
        <View style={{ flex: 1, minHeight: 0 }}>
          <FadeUp delay={120} style={{ flexShrink: 1, minHeight: 0 }}>
            <FitBox width={270} height={290} natural>
              <LitHead timeline={timeline} />
            </FitBox>
          </FadeUp>
          <FadeUp delay={400} style={{ marginTop: 4 }}>
            <Outcomes outcomes={copy.outcomes} rtl={rtl} />
          </FadeUp>
        </View>
      </View>
    </OnboardingScreen>
  );
}
