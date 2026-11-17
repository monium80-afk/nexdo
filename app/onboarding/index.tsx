import { useIsFocused, useRouter } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { Text, useWindowDimensions, View, type TextStyle, type ViewStyle } from "react-native";
import Animated, { Easing, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from "react-native-svg";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { GemMascot } from "@/components/GemMascot";
import { ABOVE_SHADOW, Eyebrow, FitBox, footerBottom, MAX_FONT_SCALE, ONB, PrimaryButton, rowDirection, useIsRtl } from "@/components/onboarding/OnboardingKit";
import { at, CSS_EASE, CSS_OUT, kf, useTimeline, useTimelineStyle, type Timeline } from "@/components/onboarding/timeline";
import { shadow } from "@/constants/shadow";
import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";
import { useTranslation } from "@/hooks/useTranslation";
import { posthog } from "@/lib/posthog";

// 01 · Hook (screens/01-hook.html, an 11 s loop in the mock). A dark, tangled
// head; the gem rises, a warm light floods the screen and turns it cream; the
// thoughts fly into a tidy list; the top one turns into the dark "Do this
// first" row; the headline appears. Plays once and holds that last frame.

const LOOP = 11;
/** Where it holds: the headline has settled (72 %). */
const END = at(72, LOOP);
const ROW_EASE = Easing.bezierFn(0.5, 0, 0.25, 1);
const GEM_EASE = Easing.bezierFn(0.45, 0, 0.2, 1);
const BURST_EASE = Easing.bezierFn(0.2, 0.7, 0.2, 1);
/** The mock's status bar: the drawing starts under it, at y = 47. */
const Y0 = 47;
/** The drawing: the mock from under the status bar to just under the list (y 47 → 488; the headline sits 36 px higher than the mock's 524, as asked). */
const DRAWING_W = 390;
const DRAWING_H = 488 - Y0;
/** The list rows' inset from the drawing's sides; the buttons line up with it. */
const ROW_INSET = 34;


/** The scribbles of the tangled head, their dashes crawling (hS0–hS2). */
const SCRIBBLES = [
  { d: "M241 356 S228 215 248 301 S72 106 270 370 S275 474 107 164 S355 384 272 313 S21 364 332 384 S202 291 105 118", opacity: 0.21, width: 1.9, dash: "60 29", travel: 180, period: 5.1 },
  { d: "M280 102 S119 387 40 88 S150 315 107 193 S2 399 317 85 S43 294 247 237 S335 202 235 372 S208 342 110 335", opacity: 0.26, width: 2.2, dash: "130 18", travel: 360, period: 6.3 },
  { d: "M127 332 S0 169 157 85 S107 86 45 358 S240 252 65 275 S362 263 65 218 S214 97 207 104 S289 382 18 420", opacity: 0.15, width: 2.0, dash: "83 12", travel: 540, period: 6.2 },
  { d: "M17 279 S96 289 70 138 S260 157 136 431 S374 453 61 75 S67 274 40 308 S329 256 259 160 S59 262 359 356", opacity: 0.18, width: 1.5, dash: "74 37", travel: 180, period: 8.9 },
  { d: "M313 225 S132 64 20 177 S312 228 105 271 S151 257 318 398 S37 98 305 121 S46 166 31 144 S298 385 119 296", opacity: 0.15, width: 1.9, dash: "87 29", travel: 360, period: 6.8 },
  { d: "M310 317 S378 382 304 139 S283 160 207 163 S351 258 331 148 S247 369 169 186 S40 275 322 197 S24 113 107 151", opacity: 0.14, width: 1.8, dash: "72 17", travel: 540, period: 8.0 },
  { d: "M210 201 S286 394 225 491 S315 374 315 321 S37 203 160 336 S108 164 99 438 S383 68 45 134 S35 197 126 315", opacity: 0.18, width: 1.5, dash: "45 15", travel: 180, period: 6.1 },
  { d: "M281 362 S302 77 77 117 S9 303 195 140 S183 418 240 239 S159 77 346 445 S10 366 363 337 S325 98 309 141", opacity: 0.19, width: 2.1, dash: "80 14", travel: 360, period: 9.0 },
  { d: "M48 301 S213 464 289 258 S15 502 32 447 S255 353 370 136 S7 379 184 250 S339 255 53 420 S194 358 252 109", opacity: 0.12, width: 1.3, dash: "51 30", travel: 540, period: 5.5 },
] as const;

/** The floating question marks: x, baseline y, size, bob period, delay. */
const QUESTIONS = [
  [40, 130, 22, 2.9, 0.8],
  [330, 170, 18, 3.0, 1.9],
  [70, 420, 20, 3.5, 0.9],
  [300, 450, 26, 3.2, 1.1],
  [190, 110, 16, 3.3, 1.0],
  [350, 330, 18, 3.0, 0.2],
] as const;

/** Each thought's scattered start: offset and tilt before it flies into its row. */
const ROWS = [
  { dx: -4, dy: -64, r: -9, jitter: 1.6 },
  { dx: 176, dy: -26, r: 7, jitter: 1.9 },
  { dx: 6, dy: 12, r: -5, jitter: 2.2 },
  { dx: 216, dy: 30, r: 10, jitter: 2.5 },
  { dx: 76, dy: 38, r: -3, jitter: 2.8 },
] as const;

/** A small wobble while the thought is still a mess (hJit), ±3 px. */
function jitter(t: number, period: number, phase: number): { x: number; y: number } {
  "worklet";
  const angle = ((t + phase) / period) * Math.PI * 2;
  return { x: Math.sin(angle) * 3, y: Math.cos(angle * 1.3) * 2.5 };
}

/** One scribble of the tangle, drawn once — the group drifts instead (cheaper than animating each dash). */
function Scribble({ line }: { line: (typeof SCRIBBLES)[number] }) {
  return <Path d={line.d} fill="none" stroke="#FAF1E4" strokeOpacity={line.opacity} strokeWidth={line.width} strokeLinecap="round" strokeDasharray={line.dash} />;
}

function Question({ timeline, spec }: { timeline: Timeline; spec: (typeof QUESTIONS)[number] }) {
  const [x, y, size, period, delay] = spec;
  const style = useTimelineStyle(timeline, (t) => {
    "worklet";
    const local = Math.max(0, t - delay);
    return { transform: [{ translateY: -3 + Math.cos((local / period) * Math.PI * 2) * 3 }] };
  });
  return (
    <Animated.Text
      maxFontSizeMultiplier={1}
      style={[
        { position: "absolute", left: x, top: y - size * 0.82, fontSize: size, lineHeight: size * 1.1, fontFamily: "SpaceGrotesk-Bold", color: "rgba(250,241,228,0.22)" },
        style,
      ]}
    >
      ?
    </Animated.Text>
  );
}

/** A tidy row's content: ring, title, and on the top row in its dark state the "Do this first" chip. */
function RowContent({ title, onDark, chip }: { title: string; onDark: boolean; chip?: ReactNode }) {
  const rtl = useIsRtl();
  return (
    <View style={[{ position: "absolute", left: 14, right: 14, top: 0, height: 42, alignItems: "center", gap: 10 }, rowDirection(rtl)]}>
      <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: onDark ? "rgba(250,241,228,0.4)" : ONB.ring }} />
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.1}
        style={{ flex: 1, fontSize: 15, fontFamily: "SpaceGrotesk-SemiBold", color: onDark ? ONB.paper : ONB.ink, textAlign: rtl ? "right" : "left" }}
      >
        {title}
      </Text>
      {chip}
    </View>
  );
}

/**
 * A thought that flies into its row: messy italic text first (light on the
 * dark head, then dark as it clears), then the card and the neat task. Only
 * opacity and transforms animate: the colour changes are two layers
 * cross-fading. The text layers sit above the card's shadow (ABOVE_SHADOW).
 */
function HookRow({ timeline, index, messy, neat, doThisFirst }: { timeline: Timeline; index: number; messy: string; neat: string; doThisFirst: string }) {
  const rtl = useIsRtl();
  const spec = ROWS[index];
  const shift = 1.2 * index;
  const top = index === 0;

  const moveStyle = useTimelineStyle(timeline, (t) => {
    "worklet";
    const settle = kf(t, [[at(38 + shift, LOOP), 0], [at(50 + shift, LOOP), 1]], ROW_EASE);
    return {
      transform: [
        { translateX: spec.dx * (1 - settle) * (rtl ? -1 : 1) },
        { translateY: spec.dy * (1 - settle) },
        { rotate: `${spec.r * (1 - settle) * (rtl ? -1 : 1)}deg` },
      ],
    };
  });
  /** The rows under the top one dim once it's picked. */
  const dim = (t: number) => {
    "worklet";
    return top ? 1 : kf(t, [[at(64, LOOP), 1], [at(68, LOOP), 0.42]], CSS_EASE);
  };
  const cardStyle = useTimelineStyle(timeline, (t) => {
    "worklet";
    const p = kf(t, [[at(45 + shift, LOOP), 0], [at(50 + shift, LOOP), 1]], CSS_EASE);
    return { opacity: p * dim(t), transform: [{ scale: 0.8 + 0.2 * p }] };
  });
  const darkStyle = useTimelineStyle(timeline, (t) => {
    "worklet";
    const p = kf(t, [[at(60, LOOP), 0], [at(66, LOOP), 1]], CSS_EASE);
    return { opacity: p, transform: [{ scale: 0.96 + 0.08 * p }] };
  });
  const messyLight = useTimelineStyle(timeline, (t) => {
    "worklet";
    const wobble = jitter(t, spec.jitter, index);
    const gone = kf(t, [[at(44, LOOP), 1], [at(50, LOOP), 0]], CSS_EASE);
    return { opacity: gone * (1 - kf(t, [[at(30, LOOP), 0], [at(44, LOOP), 1]], CSS_EASE)), transform: [{ translateX: wobble.x }, { translateY: wobble.y }] };
  });
  const messyDark = useTimelineStyle(timeline, (t) => {
    "worklet";
    const wobble = jitter(t, spec.jitter, index);
    const gone = kf(t, [[at(44, LOOP), 1], [at(50, LOOP), 0]], CSS_EASE);
    return { opacity: gone * kf(t, [[at(30, LOOP), 0], [at(44, LOOP), 1]], CSS_EASE), transform: [{ translateX: wobble.x }, { translateY: wobble.y }] };
  });
  // The neat task on the cream card (the top row's fades out as it turns dark).
  const neatStyle = useTimelineStyle(timeline, (t) => {
    "worklet";
    const shown = kf(t, [[at(47 + shift, LOOP), 0], [at(51 + shift, LOOP), 1]], CSS_EASE);
    const turned = top ? kf(t, [[at(60, LOOP), 0], [at(66, LOOP), 1]], CSS_EASE) : 0;
    return { opacity: shown * (1 - turned) * dim(t) };
  });
  const neatDarkStyle = useTimelineStyle(timeline, (t) => {
    "worklet";
    return { opacity: kf(t, [[at(60, LOOP), 0], [at(66, LOOP), 1]], CSS_EASE) };
  });
  const chipStyle = useTimelineStyle(timeline, (t) => {
    "worklet";
    const p = kf(t, [[at(62, LOOP), 0], [at(68, LOOP), 1]], CSS_EASE);
    return { opacity: p, transform: [{ translateX: (1 - p) * 8 * (rtl ? -1 : 1) }] };
  });

  const messyText = (color: string, style: typeof messyLight) => (
    <Animated.Text
      numberOfLines={1}
      maxFontSizeMultiplier={1.1}
      style={[
        { position: "absolute", top: 0, height: 42, lineHeight: 42, fontSize: 17, fontFamily: "SpaceGrotesk-SemiBold", fontStyle: "italic", color },
        rtl ? { right: 0 } : { left: 0 },
        ABOVE_SHADOW,
        style,
      ]}
    >
      {messy}
    </Animated.Text>
  );

  return (
    <Animated.View style={[{ position: "absolute", left: 34, right: 34, top: 214 - Y0 + 52 * index, height: 42 }, moveStyle]}>
      <Animated.View style={[{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: 14, backgroundColor: ONB.card }, shadow("0 2px 10px rgba(60,35,15,0.08)", 2), cardStyle]} />
      {top ? (
        <Animated.View
          style={[{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: 14, backgroundColor: ONB.ink }, shadow("0 14px 28px rgba(34,28,23,0.28)", 8, ONB.ink), darkStyle]}
        />
      ) : null}
      {messyText("rgba(250,241,228,0.7)", messyLight)}
      {messyText("rgba(34,28,23,0.55)", messyDark)}
      <Animated.View style={[{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }, ABOVE_SHADOW, neatStyle]}>
        <RowContent title={neat} onDark={false} />
      </Animated.View>
      {top ? (
        <Animated.View style={[{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }, ABOVE_SHADOW, neatDarkStyle]}>
          <RowContent
            title={neat}
            onDark
            chip={
              <Animated.View style={[{ height: 24, paddingHorizontal: 9, borderRadius: 12, backgroundColor: "rgba(242,106,46,0.18)", justifyContent: "center" }, chipStyle]}>
                <Text maxFontSizeMultiplier={1.1} style={{ fontSize: 11.5, fontFamily: "SpaceGrotesk-Bold", color: "#FFB089" }}>
                  {doThisFirst}
                </Text>
              </Animated.View>
            }
          />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

/** A little smaller than the mock's 32 px (asked for 2026-11-12). */
const HEADLINE_SIZE = 28;
const HEADLINE: TextStyle = { fontSize: HEADLINE_SIZE, lineHeight: HEADLINE_SIZE * 1.1, letterSpacing: -HEADLINE_SIZE * 0.03, fontFamily: "SpaceGrotesk-Bold" };

/**
 * One line of the headline, as in the mock: it stays one line, its size
 * shrunk just enough to fit (a 360 dp phone, larger system text, a longer
 * translation). An invisible copy measures its natural width.
 */
function HeadlineLine({ text, color }: { text: string; color: string }) {
  const [room, setRoom] = useState(0);
  const [natural, setNatural] = useState(0);
  const scale = room > 0 && natural > 0 ? Math.min(1, (room * 0.98) / natural) : 1;
  return (
    <View onLayout={(event) => setRoom(event.nativeEvent.layout.width)}>
      <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width: 4000, alignItems: "flex-start", opacity: 0 }} importantForAccessibility="no-hide-descendants">
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={HEADLINE} onLayout={(event) => setNatural(event.nativeEvent.layout.width)}>
          {text}
        </Text>
      </View>
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[HEADLINE, { fontSize: HEADLINE_SIZE * scale, lineHeight: HEADLINE_SIZE * 1.1 * scale, letterSpacing: -HEADLINE_SIZE * 0.03 * scale, textAlign: "center", color }]}
      >
        {text}
      </Text>
    </View>
  );
}

export default function OnboardingHook() {
  const t = useTranslation();
  const copy = t.onboardingFlow.hook;
  const router = useRouter();
  // The gem rests while another screen is in front of this one.
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const timeline = useTimeline(END);
  // Where the list rows sit from the screen's sides, once the drawing has been fitted.
  const { width: screenWidth } = useWindowDimensions();
  const [drawingScale, setDrawingScale] = useState(Math.min(1, screenWidth / DRAWING_W));
  const sideInset = (screenWidth - DRAWING_W * drawingScale) / 2 + ROW_INSET * drawingScale;

  // Light icons over the dark head, dark once the screen has turned cream.
  const [cleared, setCleared] = useState(reduceMotion);
  useEffect(() => {
    if (reduceMotion) return;
    const timer = setTimeout(() => setCleared(true), at(44, LOOP) * 1000);
    return () => clearTimeout(timer);
  }, [reduceMotion]);
  useStatusBarStyle(cleared ? "dark" : "light");

  useEffect(() => {
    posthog.capture("onboarding_started");
  }, []);

  const darkStyle = useTimelineStyle(timeline, (time) => {
    "worklet";
    return { opacity: kf(time, [[at(30, LOOP), 1], [at(48, LOOP), 0]], CSS_EASE) };
  });
  // Drawn at 300 px and scaled ×5: the same soft light as the mock's 1500 px
  // gradient, without making the phone paint a huge layer every frame.
  const burstStyle = useTimelineStyle(timeline, (time) => {
    "worklet";
    return {
      opacity: kf(time, [[at(26, LOOP), 0], [at(30, LOOP), 1], [at(50, LOOP), 0]], BURST_EASE),
      transform: [{ scale: 5 * kf(time, [[at(26, LOOP), 0], [at(50, LOOP), 1]], BURST_EASE) }],
    };
  });
  const linesStyle = useTimelineStyle(timeline, (time) => {
    "worklet";
    const p = kf(time, [[at(28, LOOP), 0], [at(44, LOOP), 1]], CSS_EASE);
    // A slow restless drift while it is still a mess.
    return {
      opacity: 1 - p,
      transform: [{ translateX: Math.sin(time * 1.3) * 4 }, { translateY: Math.cos(time * 1.1) * 3 }, { rotate: `${Math.sin(time * 0.8) * 1.2}deg` }, { scale: 1 - 0.15 * p }],
    };
  });
  const eyebrowStyle = useTimelineStyle(timeline, (time) => {
    "worklet";
    return { opacity: kf(time, [[at(24, LOOP), 1], [at(30, LOOP), 0]], CSS_EASE) };
  });
  const extraStyle = useTimelineStyle(timeline, (time) => {
    "worklet";
    return { opacity: kf(time, [[at(34, LOOP), 1], [at(44, LOOP), 0]], CSS_EASE) };
  });
  const extraJitterA = useTimelineStyle(timeline, (time) => {
    "worklet";
    const wobble = jitter(time, 2, 0.4);
    return { transform: [{ translateX: wobble.x }, { translateY: wobble.y }] };
  });
  const extraJitterB = useTimelineStyle(timeline, (time) => {
    "worklet";
    const wobble = jitter(time, 2, 1.1);
    return { transform: [{ translateX: wobble.x }, { translateY: wobble.y }] };
  });
  const gemStyle = useTimelineStyle(timeline, (time) => {
    "worklet";
    const rise = [
      [at(14, LOOP), 760],
      [at(30, LOOP), 200],
      [at(40, LOOP), 200],
      [at(52, LOOP), 0],
    ] as const;
    const grow = [
      [at(14, LOOP), 0.8],
      [at(30, LOOP), 1.15],
      [at(40, LOOP), 1.15],
      [at(52, LOOP), 1],
    ] as const;
    return { transform: [{ translateY: kf(time, rise, GEM_EASE) }, { scale: kf(time, grow, GEM_EASE) }] };
  });
  const glowStyle = useTimelineStyle(timeline, (time) => {
    "worklet";
    return {
      opacity: kf(time, [[at(24, LOOP), 0], [at(32, LOOP), 1], [at(44, LOOP), 1], [at(56, LOOP), 0.55]], CSS_EASE),
      transform: [{ scale: kf(time, [[at(24, LOOP), 0.6], [at(32, LOOP), 1.25], [at(44, LOOP), 1.25], [at(56, LOOP), 1]], CSS_EASE) }],
    };
  });
  const headStyle = useTimelineStyle(timeline, (time) => {
    "worklet";
    const p = kf(time, [[at(64, LOOP), 0], [at(72, LOOP), 1]], CSS_OUT);
    return { opacity: p, transform: [{ translateY: (1 - p) * 16 }] };
  });
  // The link is pale over the dark head and greys as it clears: a pale copy on top fades out.
  const linkPaleStyle = useTimelineStyle(timeline, (time) => {
    "worklet";
    return { opacity: 1 - kf(time, [[at(34, LOOP), 0], [at(48, LOOP), 1]], CSS_EASE) };
  });

  const fill: ViewStyle = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 };

  return (
    <View style={{ flex: 1, backgroundColor: ONB.paper, overflow: "hidden" }}>
      {/* The dark head, a radial gradient that fades away. */}
      <Animated.View style={[fill, darkStyle]} pointerEvents="none">
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id="hookDark" cx="50%" cy="30%" rx="120%" ry="70%">
              <Stop offset="0" stopColor="#2A1C14" />
              <Stop offset="0.6" stopColor="#140E0B" />
              <Stop offset="1" stopColor="#0E0A08" />
            </RadialGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#hookDark)" />
        </Svg>
      </Animated.View>

      <View style={{ flex: 1, paddingTop: insets.top }}>
        {/* The drawing (status bar to headline in the mock), shrunk when the phone is shorter or narrower. */}
        <FitBox width={DRAWING_W} height={DRAWING_H} natural align="top" onScale={setDrawingScale}>
          <View pointerEvents="none" style={{ width: DRAWING_W, height: DRAWING_H }}>
            {/* The warm light that floods the screen. */}
            <Animated.View style={[{ position: "absolute", left: 195 - 150, top: 300 - Y0 - 150, width: 300, height: 300 }, burstStyle]}>
              <Svg width={300} height={300}>
                <Defs>
                  <RadialGradient id="hookBurst" cx="50%" cy="50%" r="50%">
                    <Stop offset="0" stopColor="#FFD696" stopOpacity={0.95} />
                    <Stop offset="0.22" stopColor="#FFAA5A" stopOpacity={0.6} />
                    <Stop offset="0.6" stopColor="#FAF1E4" stopOpacity={0} />
                  </RadialGradient>
                </Defs>
                <Rect width={300} height={300} fill="url(#hookBurst)" />
              </Svg>
            </Animated.View>

            {/* The tangle: scribbles and question marks. */}
            <Animated.View style={[{ position: "absolute", left: 0, top: -Y0, width: 390, height: 560 }, linesStyle]}>
              <Svg width={390} height={560} viewBox="0 0 390 560">
                {SCRIBBLES.map((line) => (
                  <Scribble key={line.d} line={line} />
                ))}
              </Svg>
              {QUESTIONS.map((spec) => (
                <Question key={`${spec[0]}-${spec[1]}`} timeline={timeline} spec={spec} />
              ))}
            </Animated.View>

            <Animated.View style={[{ position: "absolute", left: 0, right: 0, top: 72 - Y0, alignItems: "center" }, eyebrowStyle]}>
              <Eyebrow color="rgba(250,241,228,0.5)">{copy.eyebrow}</Eyebrow>
            </Animated.View>

            {/* The two thoughts that don't make the list. */}
            <Animated.View style={[{ position: "absolute", left: 220, top: 120 - Y0, transform: [{ rotate: "-8deg" }] }, extraStyle]}>
              <Animated.Text maxFontSizeMultiplier={1.1} style={[{ fontSize: 16, fontFamily: "SpaceGrotesk-SemiBold", fontStyle: "italic", color: "rgba(250,241,228,0.55)" }, extraJitterA]}>
                {copy.thoughts[0]}
              </Animated.Text>
            </Animated.View>
            <Animated.View style={[{ position: "absolute", left: 150, top: 300 - Y0, transform: [{ rotate: "4deg" }] }, extraStyle]}>
              <Animated.Text maxFontSizeMultiplier={1.1} style={[{ fontSize: 16, fontFamily: "SpaceGrotesk-SemiBold", fontStyle: "italic", color: "rgba(250,241,228,0.55)" }, extraJitterB]}>
                {copy.thoughts[3]}
              </Animated.Text>
            </Animated.View>

            {/* The five that do, flying into the sorted list. */}
            {[copy.thoughts[1], copy.thoughts[2], copy.thoughts[4], copy.thoughts[5], copy.thoughts[6]].map((messy, index) => (
              <HookRow key={messy} timeline={timeline} index={index} messy={messy} neat={copy.tasks[index]} doThisFirst={copy.doThisFirst} />
            ))}

            {/* The gem, rising from below with its glow. */}
            <Animated.View style={[{ position: "absolute", left: 195 - 54, top: 70 - Y0, width: 108, zIndex: 3 }, gemStyle]}>
              <Animated.View style={[{ position: "absolute", left: 54 - 130, top: 60 - 130, width: 260, height: 260 }, glowStyle]}>
                <Svg width={260} height={260}>
                  <Defs>
                    <RadialGradient id="hookGlow" cx="50%" cy="50%" r="50%">
                      <Stop offset="0" stopColor="#FFB45A" stopOpacity={0.65} />
                      <Stop offset="0.62" stopColor="#F26A2E" stopOpacity={0} />
                    </RadialGradient>
                  </Defs>
                  <Rect width={260} height={260} fill="url(#hookGlow)" />
                </Svg>
              </Animated.View>
              <GemMascot level={4} width={108} animate={focused} />
            </Animated.View>
          </View>
        </FitBox>

        {/* The headline, in its own room above the buttons. */}
        <Animated.View style={[{ paddingHorizontal: sideInset }, headStyle]}>
          <HeadlineLine text={copy.headlineTop} color={ONB.ink} />
          <HeadlineLine text={copy.headlineBottom} color={ONB.orange} />
        </Animated.View>
        <View style={{ flex: 1, minHeight: 20 }} />

        {/* As wide as the list above, and lifted a little off the bottom. */}
        <View style={{ paddingHorizontal: sideInset, paddingBottom: footerBottom(insets.bottom), gap: 4 }}>
          <PrimaryButton
            label={copy.getStarted}
            onPress={() => {
              posthog.capture("onboarding_get_started_tapped");
              router.push("/onboarding/problem");
            }}
          />
          <AnimatedPressable
            onPress={() => router.push("/onboarding/log-in")}
            scaleTo={0.97}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={copy.haveAccount}
            className="h-11 items-center justify-center"
          >
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1} style={{ fontSize: 14, fontFamily: "SpaceGrotesk-SemiBold", color: ONB.muted }}>
              {copy.haveAccount}
            </Text>
            <Animated.Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              numberOfLines={1}
              style={[{ position: "absolute", fontSize: 14, fontFamily: "SpaceGrotesk-SemiBold", color: "#BFB2A7" }, linkPaleStyle]}
            >
              {copy.haveAccount}
            </Animated.Text>
          </AnimatedPressable>
        </View>
      </View>
    </View>
  );
}
