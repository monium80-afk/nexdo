import { useEffect, useId, useState } from "react";
import { Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
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

import { colors } from "@/constants/theme";
import type { SessionCountdown } from "@/hooks/useSessionCountdown";
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

/** The level-4 gem of the focus mockup: halo and core pulsing, focus eyes or happy arcs. */
function FocusGemArt({
  happy,
  pulse,
  blink,
}: {
  happy: boolean;
  pulse: SharedValue<number>;
  blink?: SharedValue<number>;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const g = (name: string) => `${id}${name}`;
  // mPulse: 0.6 → 1; mCore: 0.75 → 1 and 1 → 1.12 about its centre.
  const haloProps = useAnimatedProps(() => ({ opacity: 0.6 + 0.4 * pulse.value }));
  const coreProps = useAnimatedProps(() => ({ opacity: 0.75 + 0.25 * pulse.value, r: 32 * (1 + 0.12 * pulse.value) }));
  const eyeProps = useAnimatedProps(() => ({ d: focusEyes(blink ? blink.value : 1) }));

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
        <Path d="M76 132 Q84 118 92 132 M106 132 Q114 118 122 132" fill="none" stroke="#FFFFFF" strokeWidth={5} strokeLinecap="round" />
      ) : (
        <AnimatedPath d={focusEyes(1)} fill="#FFFFFF" animatedProps={eyeProps} />
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
export function FocusClockFace({
  session,
  countdown,
  caption,
}: {
  session: ActiveSession;
  countdown: SessionCountdown;
  /** The line under the clock while there's time left. */
  caption: string;
}) {
  const reduceMotion = useReducedMotion();
  // Opened on a session already past its time: no party, just the happy gem.
  const [phase, setPhase] = useState<Phase>(() => (countdown.isOvertime ? "done" : "focus"));

  // The moment the time runs out, to the millisecond — not the next 1 s tick.
  const totalMs = session.plannedMinutes * 60_000;
  useEffect(() => {
    if (phase !== "focus" || session.runningSince === null) return;
    const left = totalMs - sessionElapsedMs(session);
    const timer = setTimeout(() => setPhase("celebrating"), Math.max(0, left));
    return () => clearTimeout(timer);
  }, [phase, session, totalMs]);

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
    if (ended) return;
    ring.set(withTiming(countdown.progress, { duration: reduceMotion ? 0 : 1000, easing: Easing.linear }));
  }, [countdown.progress, ended, reduceMotion, ring]);

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

  // Overtime, once the celebration is over: the faint red ring it has always had.
  const overtimeRing = phase === "done" && countdown.isOvertime;
  const clock = phase === "celebrating" ? "00:00" : countdown.clock;
  const clockColor = countdown.isOvertime && phase === "done" ? colors.overdue[500] : "#221C17";

  return (
    <View style={{ alignItems: "center", gap: 10 }}>
      <View style={{ width: RING, height: RING, zIndex: 1 }}>
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
        {phase !== "done" && !happyShown ? (
          <Animated.View
            pointerEvents="none"
            style={[{ position: "absolute", left: GEM_LEFT, top: GEM_TOP, transformOrigin: "50% 80%" }, focusGemStyle]}
          >
            <FocusGemArt happy={false} pulse={pulse} blink={blink} />
          </Animated.View>
        ) : null}

        <Animated.View
          pointerEvents="none"
          style={[{ position: "absolute", inset: 0, borderRadius: RING / 2, borderWidth: 6 * S, borderColor: "#F26A2E" }, burstStyle]}
        />

        {/* The happy gem, scaled about the ring's centre like the mockup's full-size layer. */}
        {ended ? (
          <Animated.View pointerEvents="none" style={[{ position: "absolute", inset: 0 }, happyStyle]}>
            <View style={{ position: "absolute", left: GEM_LEFT, top: GEM_TOP }}>
              <FocusGemArt happy pulse={pulse} />
            </View>
          </Animated.View>
        ) : null}

        {CONFETTI.map((piece, index) => (
          <ConfettiPiece key={index} piece={piece} play={phase === "celebrating" && !reduceMotion} />
        ))}
      </View>

      <View style={{ alignItems: "center", gap: 4 }} accessibilityRole="timer">
        {/* A size down once a long session shows hours ("1:29:59"). Tabular
            digits, so the clock doesn't shift sideways as it ticks. */}
        <Text
          numberOfLines={1}
          style={{
            fontFamily: "SpaceGrotesk-Bold",
            fontSize: clock.length > 6 ? 42 : 52,
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
      </View>
    </View>
  );
}
