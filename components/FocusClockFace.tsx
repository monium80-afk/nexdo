import { useEffect, useId, useState } from "react";
import { Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Circle, ClipPath, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from "react-native-svg";

import { FOCUS_FINISH } from "@/constants/focusFinish";
import { colors } from "@/constants/theme";
import type { SessionCountdown } from "@/hooks/useSessionCountdown";
import { useTranslation } from "@/hooks/useTranslation";
import { sessionElapsedMs, type ActiveSession } from "@/store/useSessionStore";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

/*
 * The focus session's clock face and its "time's up" celebration, rebuilt
 * from nexdo-design-handoff/animations/Anim-FocusDone.html. The mockup is a
 * 6 s loop (1 % = 60 ms) whose clock reaches 00:00 at 20 %; every time below
 * is measured from that moment, the keyframe % in the comments. Only the
 * countdown end and the celebration are built: no results sheet, no reset.
 */

// 85 % of the mockup's sizes, so the whole page fits without scrolling (the
// user's call, 2026-11-04); the celebration scales with it.
const S = 0.85;
const RING = 260 * S;
const R = 112 * S;
const STROKE = 12 * S;
const CIRC = 2 * Math.PI * R; // ≈ 704, the mockup's dash length

// The gem: 160 × 176 of a 200 × 220 drawing, centred in the ring, 26 up.
const GEM_W = 160 * S;
const GEM_H = 176 * S;
const GEM_LEFT = (RING - GEM_W) / 2;
const GEM_TOP = (RING - GEM_H) / 2 - 26 * S;

// CSS's named easings.
const EASE = Easing.bezier(0.25, 0.1, 0.25, 1);
const EASE_OUT = Easing.bezier(0, 0, 0.58, 1);
const EASE_IN_OUT = Easing.bezier(0.42, 0, 0.58, 1);
const CONF_EASE = Easing.bezier(0.1, 0.7, 0.3, 1);

// From 00:00 (20 %): the ring is full by 24 %, the gem swaps 22–28 %, the
// happy gem jumps 25–41 %, the ring burst 25–42 %, confetti 26–56 % (+ up to
// 0.12 s of stagger). 00:00 is held until the last confetti is gone, then the
// session goes on into overtime as it always has.
const HOLD_MS = 2300;

// Anim-FocusDone's 22 pieces: angle, distance, spin, delay, size, colour.
const CONFETTI: { a: number; d: number; s: number; delay: number; w: number; h: number; c: string }[] = [
  { a: -2, d: 131, s: 217, delay: 100, w: 10, h: 4, c: "#F26A2E" },
  { a: 11, d: 161, s: 199, delay: 10, w: 10, h: 4, c: "#FFC33E" },
  { a: 32, d: 137, s: 210, delay: 100, w: 10, h: 6, c: "#1F8A55" },
  { a: 45, d: 136, s: 211, delay: 70, w: 10, h: 12, c: "#FF9A6A" },
  { a: 64, d: 188, s: 248, delay: 30, w: 6, h: 12, c: "#221C17" },
  { a: 78, d: 128, s: 529, delay: 20, w: 8, h: 12, c: "#3B6FD8" },
  { a: 99, d: 165, s: 460, delay: 90, w: 8, h: 4, c: "#F26A2E" },
  { a: 115, d: 163, s: 452, delay: 50, w: 8, h: 12, c: "#FFC33E" },
  { a: 129, d: 161, s: 333, delay: 30, w: 8, h: 6, c: "#1F8A55" },
  { a: 143, d: 175, s: 333, delay: 60, w: 6, h: 12, c: "#FF9A6A" },
  { a: 168, d: 171, s: 217, delay: 10, w: 8, h: 12, c: "#221C17" },
  { a: 179, d: 173, s: 395, delay: 0, w: 6, h: 6, c: "#3B6FD8" },
  { a: 198, d: 174, s: 354, delay: 80, w: 10, h: 6, c: "#F26A2E" },
  { a: 214, d: 161, s: 227, delay: 110, w: 8, h: 4, c: "#FFC33E" },
  { a: 229, d: 166, s: 539, delay: 40, w: 6, h: 12, c: "#1F8A55" },
  { a: 246, d: 168, s: 377, delay: 110, w: 8, h: 6, c: "#FF9A6A" },
  { a: 260, d: 186, s: 492, delay: 10, w: 8, h: 4, c: "#221C17" },
  { a: 273, d: 174, s: 306, delay: 50, w: 6, h: 12, c: "#3B6FD8" },
  { a: 300, d: 155, s: 385, delay: 70, w: 6, h: 6, c: "#F26A2E" },
  { a: 316, d: 177, s: 392, delay: 120, w: 10, h: 6, c: "#FFC33E" },
  { a: 329, d: 147, s: 222, delay: 20, w: 6, h: 4, c: "#1F8A55" },
  { a: 340, d: 136, s: 273, delay: 30, w: 8, h: 12, c: "#FF9A6A" },
];

type Phase = "focus" | "celebrating" | "done";

/** The focus eyes (two white half-moons) squeezed to `s` of their height about their middle. */
function focusEyes(s: number): string {
  "worklet";
  const mid = 130.5;
  const y = (v: number) => mid + (v - mid) * s;
  const ry = 9 * s;
  return (
    `M75 ${y(124)} H93 V${y(128)} A9 ${ry} 0 0 1 75 ${y(128)} Z ` +
    `M105 ${y(124)} H123 V${y(128)} A9 ${ry} 0 0 1 105 ${y(128)} Z`
  );
}

const HAPPY_EYES = "M76 132 Q84 118 92 132 M106 132 Q114 118 122 132";

/** The level-4 gem of the focus mockup: halo and core pulsing, focus eyes or happy arcs. */
function FocusGemArt({
  happy,
  pulse,
  blink,
  happyEyes,
}: {
  happy: boolean;
  pulse: SharedValue<number>;
  blink?: SharedValue<number>;
  /** The focusing gem's eyes turning happy (0 → 1) — the task done in the session. */
  happyEyes?: SharedValue<number>;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const g = (name: string) => `${id}${name}`;
  const noSwap = useSharedValue(0);
  const swap = happyEyes ?? noSwap;
  // mPulse: 0.6 → 1; mCore: 0.75 → 1 and 1 → 1.12 about its centre.
  const haloProps = useAnimatedProps(() => ({ opacity: 0.6 + 0.4 * pulse.value }));
  const coreProps = useAnimatedProps(() => ({ opacity: 0.75 + 0.25 * pulse.value, r: 32 * (1 + 0.12 * pulse.value) }));
  const eyeProps = useAnimatedProps(() => ({ d: focusEyes(blink ? blink.value : 1), opacity: 1 - swap.value }));
  const happyEyeProps = useAnimatedProps(() => ({ opacity: swap.value }));

  return (
    <Svg width={GEM_W} height={GEM_H} viewBox="0 0 200 220" style={{ overflow: "visible" }}>
      <Defs>
        <ClipPath id={g("G")}>
          <Rect x={-44} y={-44} width={88} height={88} rx={25} transform="translate(100 140) rotate(45)" />
        </ClipPath>
        <LinearGradient id={g("TL")} gradientUnits="userSpaceOnUse" x1={0} y1={72} x2={0} y2={140}>
          <Stop offset={0} stopColor="#FFC08E" />
          <Stop offset={1} stopColor="#FF9152" />
        </LinearGradient>
        <LinearGradient id={g("TR")} gradientUnits="userSpaceOnUse" x1={0} y1={72} x2={0} y2={140}>
          <Stop offset={0} stopColor="#FF9A5A" />
          <Stop offset={1} stopColor="#F2692A" />
        </LinearGradient>
        <LinearGradient id={g("BL")} gradientUnits="userSpaceOnUse" x1={0} y1={134} x2={0} y2={208}>
          <Stop offset={0} stopColor="#F6773A" />
          <Stop offset={1} stopColor="#DC5016" />
        </LinearGradient>
        <LinearGradient id={g("BR")} gradientUnits="userSpaceOnUse" x1={0} y1={134} x2={0} y2={208}>
          <Stop offset={0} stopColor="#E95F21" />
          <Stop offset={1} stopColor="#BE3A08" />
        </LinearGradient>
        <RadialGradient id={g("H")} cx="50%" cy="50%" r="50%">
          <Stop offset={0} stopColor="#FFE9A8" stopOpacity={0.9} />
          <Stop offset={1} stopColor="#FFE9A8" stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id={g("C")} cx="50%" cy="50%" r="50%">
          <Stop offset={0} stopColor="#FFF8DC" stopOpacity={0.8} />
          <Stop offset={0.4} stopColor="#FFDD80" stopOpacity={0.6} />
          <Stop offset={1} stopColor="#FFB547" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      {happy ? <Ellipse cx={100} cy={212} rx={46} ry={6} fill="#2A1A12" opacity={0.12} /> : null}
      <AnimatedCircle cx={100} cy={140} r={86} fill={`url(#${g("H")})`} animatedProps={haloProps} />
      <G clipPath={`url(#${g("G")})`}>
        <Path d="M96 134 L28 140 L100 68 Z" fill={`url(#${g("TL")})`} />
        <Path d="M96 134 L100 68 L172 140 Z" fill={`url(#${g("TR")})`} />
        <Path d="M96 134 L172 140 L100 212 Z" fill={`url(#${g("BR")})`} />
        <Path d="M96 134 L100 212 L28 140 Z" fill={`url(#${g("BL")})`} />
        <AnimatedCircle cx={98} cy={138} r={32} fill={`url(#${g("C")})`} animatedProps={coreProps} />
      </G>
      {happy ? (
        <Path d={HAPPY_EYES} fill="none" stroke="#FFFFFF" strokeWidth={5} strokeLinecap="round" />
      ) : (
        <>
          <AnimatedPath d={focusEyes(1)} fill="#FFFFFF" animatedProps={eyeProps} />
          {happyEyes ? (
            <AnimatedPath d={HAPPY_EYES} fill="none" stroke="#FFFFFF" strokeWidth={5} strokeLinecap="round" opacity={0} animatedProps={happyEyeProps} />
          ) : null}
        </>
      )}
    </Svg>
  );
}

/** One piece of confetti (cConf): out from the centre along its angle, spinning, then gone. */
function ConfettiPiece({ piece, play }: { piece: (typeof CONFETTI)[number]; play: boolean }) {
  const travel = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (!play) return;
    // 26 % + its own delay; flies 26 → 56 % (1.8 s); shows 26 → 28 %, fades 46 → 56 %.
    const start = 360 + piece.delay;
    travel.set(withDelay(start, withTiming(1, { duration: 1800, easing: CONF_EASE })));
    opacity.set(
      withDelay(
        start,
        withSequence(
          withTiming(1, { duration: 120, easing: CONF_EASE }),
          withDelay(1080, withTiming(0, { duration: 600, easing: CONF_EASE })),
        ),
      ),
    );
    return () => {
      cancelAnimation(travel);
      cancelAnimation(opacity);
    };
  }, [opacity, piece.delay, play, travel]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { rotate: `${piece.a}deg` },
      { translateY: -piece.d * S * travel.value },
      { rotate: `${piece.s * travel.value}deg` },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          left: RING / 2 - (piece.w * S) / 2,
          top: RING / 2 - (piece.h * S) / 2,
          width: piece.w * S,
          height: piece.h * S,
          borderRadius: 2,
          backgroundColor: piece.c,
        },
        style,
      ]}
    />
  );
}

/**
 * The timed session's clock face (Final-Focus): a cream disc in an orange
 * ring that fills as the time is used, the focusing gem inside it, and the
 * clock under it. When the real countdown reaches 00:00 the ring closes, the
 * gem turns happy and jumps, a ring bursts out and confetti flies; 00:00 holds
 * until that's over, then the clock carries on into overtime as before. With
 * Reduce Motion it goes straight to the end: full ring, 00:00, happy gem.
 */
/** The task finished in the session (Done tapped): what the clock gives way to. */
export type FocusFinish = {
  /** Minutes of focus the session had, rounded. */
  focusedMinutes: number;
  plannedMinutes: number;
};

export function FocusClockFace({
  session,
  countdown,
  caption,
  finish = null,
}: {
  session: ActiveSession;
  countdown: SessionCountdown;
  /** The line under the clock while there's time left. */
  caption: string;
  /**
   * Set the moment Done is tapped (constants/focusFinish.ts): the ring fills
   * and closes, the clock gives way to "Done", waves go out from the ring and
   * the gem hops, its eyes turning happy.
   */
  finish?: FocusFinish | null;
}) {
  const t = useTranslation();
  const reduceMotion = useReducedMotion();
  const finishing = finish !== null;
  // Opened on a session already past its time: no party, just the happy gem.
  const [phase, setPhase] = useState<Phase>(() => (countdown.isOvertime ? "done" : "focus"));

  // The moment the time runs out, to the millisecond — not the next 1 s tick.
  // Not once the task is done: its session is over.
  const totalMs = session.plannedMinutes * 60_000;
  useEffect(() => {
    if (finishing || phase !== "focus" || session.runningSince === null) return;
    const left = totalMs - sessionElapsedMs(session);
    const timer = setTimeout(() => setPhase("celebrating"), Math.max(0, left));
    return () => clearTimeout(timer);
  }, [finishing, phase, session, totalMs]);

  useEffect(() => {
    if (phase !== "celebrating") return;
    const timer = setTimeout(() => setPhase("done"), HOLD_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const ended = phase !== "focus";
  const happyShown = phase === "done" || (phase === "celebrating" && reduceMotion);

  // The ring: the share of the session used, sliding over each 1 s tick.
  const ring = useSharedValue(countdown.isOvertime ? 1 : countdown.progress);
  useEffect(() => {
    if (ended || finishing) return;
    ring.set(withTiming(countdown.progress, { duration: reduceMotion ? 0 : 1000, easing: Easing.linear }));
  }, [countdown.progress, ended, finishing, reduceMotion, ring]);

  // Idle life: the focusing gem breathes and blinks; both gems' glow pulses.
  const breathe = useSharedValue(0);
  const blink = useSharedValue(1);
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) {
      breathe.set(0);
      blink.set(1);
      pulse.set(1);
      return;
    }
    // mBreathe 3.2 s, mBlink 5 s (shut 92 → 95 %, open by 100 %), mPulse/mCore 2.4 s.
    breathe.set(withRepeat(withSequence(withTiming(1, { duration: 1600, easing: EASE_IN_OUT }), withTiming(0, { duration: 1600, easing: EASE_IN_OUT })), -1));
    blink.set(withRepeat(withSequence(withDelay(4600, withTiming(0.08, { duration: 150, easing: EASE })), withTiming(1, { duration: 250, easing: EASE })), -1));
    pulse.set(0);
    pulse.set(withRepeat(withSequence(withTiming(1, { duration: 1200, easing: EASE_IN_OUT }), withTiming(0, { duration: 1200, easing: EASE_IN_OUT })), -1));
    return () => {
      cancelAnimation(breathe);
      cancelAnimation(blink);
      cancelAnimation(pulse);
    };
  }, [blink, breathe, pulse, reduceMotion]);

  // The celebration's own values.
  const gemOut = useSharedValue(ended ? 1 : 0); // 0 → the focusing gem shown
  const gemOutFade = useSharedValue(ended ? 0 : 1);
  const happyOpacity = useSharedValue(ended ? 1 : 0);
  const happyY = useSharedValue(0);
  const happyScale = useSharedValue(1);
  const burstOpacity = useSharedValue(0);
  const burstScale = useSharedValue(0.85);

  useEffect(() => {
    if (phase !== "celebrating") return;
    if (reduceMotion) {
      ring.set(1);
      gemOutFade.set(0);
      happyOpacity.set(1);
      return;
    }
    // cRing: closed by 24 %.
    ring.set(withTiming(1, { duration: 240, easing: Easing.linear }));
    // cGem: 22 → 26 % down to 0.9, gone by 28 %.
    gemOut.set(withDelay(120, withTiming(1, { duration: 240, easing: EASE })));
    gemOutFade.set(withDelay(360, withTiming(0, { duration: 120, easing: EASE })));
    // cHappy: in at 25 → 28 % (up 26, 1.12×), down to 0.97 by 33 %, a hop of 8 by 37 %, settled by 41 %.
    happyOpacity.set(withDelay(300, withTiming(1, { duration: 180, easing: EASE })));
    happyY.set(
      withDelay(
        300,
        withSequence(
          withTiming(-26 * S, { duration: 180, easing: EASE }),
          withTiming(0, { duration: 300, easing: EASE }),
          withTiming(-8 * S, { duration: 240, easing: EASE }),
          withTiming(0, { duration: 240, easing: EASE }),
        ),
      ),
    );
    happyScale.set(0.9);
    happyScale.set(
      withDelay(
        300,
        withSequence(
          withTiming(1.12, { duration: 180, easing: EASE }),
          withTiming(0.97, { duration: 300, easing: EASE }),
          withTiming(1, { duration: 240, easing: EASE }),
        ),
      ),
    );
    // cBurst: from 25 %, seen by 27 %, out to 1.3× and gone by 42 %.
    burstScale.set(withDelay(300, withTiming(1.3, { duration: 1020, easing: EASE_OUT })));
    burstOpacity.set(
      withDelay(300, withSequence(withTiming(1, { duration: 120, easing: EASE_OUT }), withTiming(0, { duration: 900, easing: EASE_OUT }))),
    );
  }, [burstOpacity, burstScale, gemOut, gemOutFade, happyOpacity, happyScale, happyY, phase, reduceMotion, ring]);

  // The task done in the session (FOCUS_FINISH): each value runs 0 → 1, the
  // hop 0 → 4 through its squash, jump, landing and rest.
  const clockOut = useSharedValue(0);
  const doneIn = useSharedValue(0);
  const wave1 = useSharedValue(0);
  const wave2 = useSharedValue(0);
  const hop = useSharedValue(0);
  const happyEyes = useSharedValue(0);

  useEffect(() => {
    if (!finishing) return;
    const F = FOCUS_FINISH;
    const timing = (duration: number) => ({ duration, easing: F.ease });
    if (reduceMotion) {
      // No hop, no waves: the ring full, "Done" in place, the gem happy.
      ring.set(1);
      clockOut.set(1);
      doneIn.set(1);
      happyEyes.set(1);
      return;
    }
    ring.set(withDelay(F.ringAt, withTiming(1, timing(F.ringMs))));
    clockOut.set(withDelay(F.clockOutAt, withTiming(1, timing(F.clockOutMs))));
    doneIn.set(withDelay(F.doneInAt, withTiming(1, timing(F.doneInMs))));
    wave1.set(withDelay(F.closesAt, withTiming(1, timing(F.wave1Ms))));
    wave2.set(withDelay(F.wave2At, withTiming(1, timing(F.wave2Ms))));
    hop.set(
      withDelay(
        F.closesAt,
        withSequence(...F.hopMs.map((duration, index) => withTiming(index + 1, timing(duration)))),
      ),
    );
    happyEyes.set(withDelay(F.eyesAt, withTiming(1, timing(F.eyesMs))));
  }, [clockOut, doneIn, finishing, happyEyes, hop, reduceMotion, ring, wave1, wave2]);

  // ftHop: squash (down 4, 1.06 × 0.92), jump (up 22, 0.97 × 1.05), land (1.04 × 0.95), rest.
  const hopStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(hop.value, [0, 1, 2, 3, 4], [0, 4 * S, -22 * S, 0, 0]) },
      { scaleX: interpolate(hop.value, [0, 1, 2, 3, 4], [1, 1.06, 0.97, 1.04, 1]) },
      { scaleY: interpolate(hop.value, [0, 1, 2, 3, 4], [1, 0.92, 1.05, 0.95, 1]) },
    ],
  }));
  // ftWave: a 12 px ring out to 1.22 from .55; ftWave2: 6 px, to 1.34 from .35.
  const wave1Style = useAnimatedStyle(() => ({
    opacity: wave1.value > 0 ? 0.55 * (1 - wave1.value) : 0,
    transform: [{ scale: 1 + 0.22 * wave1.value }],
  }));
  const wave2Style = useAnimatedStyle(() => ({
    opacity: wave2.value > 0 ? 0.35 * (1 - wave2.value) : 0,
    transform: [{ scale: 1 + 0.34 * wave2.value }],
  }));
  const clockOutStyle = useAnimatedStyle(() => ({
    opacity: 1 - clockOut.value,
    transform: [{ translateY: -FOCUS_FINISH.textShift * clockOut.value }],
  }));
  const doneInStyle = useAnimatedStyle(() => ({
    opacity: doneIn.value,
    transform: [{ translateY: FOCUS_FINISH.textShift * (1 - doneIn.value) }],
  }));

  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: CIRC * (1 - ring.value),
    // A round cap would show a dot at 0.
    strokeOpacity: ring.value > 0.001 ? 1 : 0,
  }));
  const focusGemStyle = useAnimatedStyle(() => ({
    opacity: gemOutFade.value,
    transform: [{ translateY: -3 * S * breathe.value }, { scale: (1 + 0.025 * breathe.value) * (1 - 0.1 * gemOut.value) }],
  }));
  const happyStyle = useAnimatedStyle(() => ({
    opacity: happyOpacity.value,
    transform: [{ translateY: happyY.value }, { scale: happyScale.value }],
  }));
  const burstStyle = useAnimatedStyle(() => ({ opacity: burstOpacity.value, transform: [{ scale: burstScale.value }] }));

  // Overtime, once the celebration is over: the faint red ring it has always
  // had — until the task is done, when the ring closes in orange.
  const overtimeRing = phase === "done" && countdown.isOvertime && !finishing;
  const clock = phase === "celebrating" ? "00:00" : countdown.clock;
  const clockColor = countdown.isOvertime && phase === "done" ? colors.overdue[500] : "#221C17";
  const clockSize = clock.length > 6 ? 42 : 52;

  // "18 min of focus · 12 min early" — or "… · 4 min over".
  const doneTiming = finish
    ? finish.plannedMinutes - finish.focusedMinutes > 0
      ? t.focusPage.doneEarly(finish.plannedMinutes - finish.focusedMinutes)
      : finish.plannedMinutes - finish.focusedMinutes < 0
        ? t.focusPage.doneOver(finish.focusedMinutes - finish.plannedMinutes)
        : t.focusPage.doneOnTime
    : "";

  return (
    <View style={{ alignItems: "center", gap: 10 }}>
      <View style={{ width: RING, height: RING, zIndex: 1 }}>
        {/* ftWave / ftWave2: rings going out from the ring as it closes. */}
        {finishing ? (
          <>
            <Animated.View
              pointerEvents="none"
              style={[{ position: "absolute", inset: 0, borderRadius: RING / 2, borderWidth: 12 * S, borderColor: "#F26A2E" }, wave1Style]}
            />
            <Animated.View
              pointerEvents="none"
              style={[{ position: "absolute", inset: 0, borderRadius: RING / 2, borderWidth: 6 * S, borderColor: "#F26A2E" }, wave2Style]}
            />
          </>
        ) : null}
        <Svg width={RING} height={RING} style={{ position: "absolute" }}>
          <Circle cx={RING / 2} cy={RING / 2} r={R} fill="#FCF7EF" stroke="#EFE3D4" strokeWidth={STROKE} />
          {overtimeRing ? (
            <Circle cx={RING / 2} cy={RING / 2} r={R} fill="none" stroke={colors.overdue[300]} strokeOpacity={0.55} strokeWidth={STROKE} />
          ) : (
            <AnimatedCircle
              cx={RING / 2}
              cy={RING / 2}
              r={R}
              fill="none"
              stroke="#F26A2E"
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${CIRC} ${CIRC}`}
              rotation={-90}
              origin={`${RING / 2}, ${RING / 2}`}
              animatedProps={ringProps}
            />
          )}
        </Svg>

        {/* The focusing gem; breathes about 50 % 80 % of itself (mBreathe). */}
        {/* ftHop is about the gem's foot (50 % 85 %); its breathing inside that. */}
        {phase !== "done" && !happyShown ? (
          <Animated.View
            pointerEvents="none"
            style={[{ position: "absolute", left: GEM_LEFT, top: GEM_TOP, width: GEM_W, height: GEM_H, transformOrigin: "50% 85%" }, hopStyle]}
          >
            <Animated.View style={[{ transformOrigin: "50% 80%" }, focusGemStyle]}>
              <FocusGemArt happy={false} pulse={pulse} blink={blink} happyEyes={finishing ? happyEyes : undefined} />
            </Animated.View>
          </Animated.View>
        ) : null}

        <Animated.View
          pointerEvents="none"
          style={[{ position: "absolute", inset: 0, borderRadius: RING / 2, borderWidth: 6 * S, borderColor: "#F26A2E" }, burstStyle]}
        />

        {/* The happy gem, scaled about the ring's centre like the mockup's full-size layer. */}
        {ended ? (
          <Animated.View pointerEvents="none" style={[{ position: "absolute", inset: 0 }, happyStyle]}>
            <Animated.View
              style={[{ position: "absolute", left: GEM_LEFT, top: GEM_TOP, width: GEM_W, height: GEM_H, transformOrigin: "50% 85%" }, hopStyle]}
            >
              <FocusGemArt happy pulse={pulse} />
            </Animated.View>
          </Animated.View>
        ) : null}

        {CONFETTI.map((piece, index) => (
          <ConfettiPiece key={index} piece={piece} play={phase === "celebrating" && !reduceMotion} />
        ))}
      </View>

      <View style={{ alignSelf: "stretch" }}>
        <Animated.View
          style={[{ alignItems: "center", gap: 4 }, finishing ? clockOutStyle : null]}
          accessibilityRole="timer"
          accessibilityElementsHidden={finishing}
          importantForAccessibility={finishing ? "no-hide-descendants" : "auto"}
        >
          {/* A size down once a long session shows hours ("1:29:59"). Tabular
              digits, so the clock doesn't shift sideways as it ticks. */}
          <Text
            numberOfLines={1}
            style={{
              fontFamily: "SpaceGrotesk-Bold",
              fontSize: clockSize,
              lineHeight: clock.length > 6 ? 46 : 54,
              letterSpacing: clock.length > 6 ? -1.26 : -1.56,
              fontVariant: ["tabular-nums"],
              color: clockColor,
            }}
          >
            {clock}
          </Text>
          {/* "of 30 mins · Step 2: write the introduction"; past the time, "over your 30m". */}
          <Text
            numberOfLines={2}
            style={{ fontFamily: "SpaceGrotesk-Regular", fontSize: 14, lineHeight: 19, color: "#7A6E64", textAlign: "center", paddingHorizontal: 8 }}
          >
            {phase === "done" && countdown.isOvertime ? countdown.caption : caption}
          </Text>
        </Animated.View>

        {/* ftIn: "Done", in the clock's own style, and how the time went. */}
        {finish ? (
          <Animated.View
            accessibilityLiveRegion="polite"
            style={[{ position: "absolute", top: 0, left: 0, right: 0, alignItems: "center", gap: 4 }, doneInStyle]}
          >
            <Text
              numberOfLines={1}
              style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 52, lineHeight: 54, letterSpacing: -1.56, color: "#221C17" }}
            >
              {t.common.done}
            </Text>
            <Text
              numberOfLines={2}
              style={{ fontFamily: "SpaceGrotesk-Regular", fontSize: 14, lineHeight: 19, color: "#7A6E64", textAlign: "center", paddingHorizontal: 8 }}
            >
              <Text style={{ fontFamily: "SpaceGrotesk-Bold", color: "#221C17" }}>{t.focusPage.doneMinutes(finish.focusedMinutes)}</Text>
              {` ${t.focusPage.doneOfFocus} · ${doneTiming}`}
            </Text>
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}
