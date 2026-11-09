import { useEffect, useId } from "react";
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
} from "react-native-reanimated";
import Svg, { Circle, ClipPath, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from "react-native-svg";

import flameFrames from "@/data/gemFlameFrames.json";
import type { GemLevel } from "@/lib/gemLevel";

export { gemLevelFor, type GemLevel } from "@/lib/gemLevel";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);
const AnimatedPath = Animated.createAnimatedComponent(Path);

// The four facets' colours per level, top → bottom of each facet
// (nexdo-design-handoff/mascot/gem-level-*.svg). Levels 3–5 share the orange.
type Facets = { tl: [string, string]; tr: [string, string]; bl: [string, string]; br: [string, string] };
const GREY: Facets = {
  tl: ["#4A4644", "#302C2B"],
  tr: ["#3B3735", "#242120"],
  bl: ["#2C2827", "#1A1716"],
  br: ["#211E1D", "#0E0C0C"],
};
const BRONZE: Facets = {
  tl: ["#E09A72", "#C8784C"],
  tr: ["#CC7A4E", "#AE5A30"],
  bl: ["#B8623A", "#924422"],
  br: ["#9E4C26", "#743414"],
};
const ORANGE: Facets = {
  tl: ["#FFC08E", "#FF9152"],
  tr: ["#FF9A5A", "#F2692A"],
  bl: ["#F6773A", "#DC5016"],
  br: ["#E95F21", "#BE3A08"],
};

const VIEW_W = 200;
const VIEW_H = 220;
/** The mockup's size on Today; the bob scales with the gem. */
const DESIGN_WIDTH = 190;

const FRAMES = flameFrames as string[];
const FLAME_LOOP_MS = 1000;
const BOB_MS = 1500; // each way: 3 s a loop
const PULSE_MS = 1200; // each way: 2.4 s a loop
const BLINK_WAIT_MS = 4140; // 92 % of 4.5 s
const BLINK_SHUT_MS = 135;
const BLINK_OPEN_MS = 225;
const inOut = Easing.inOut(Easing.ease);

// The sleeping gem's "z z z" (level 1): the mockups' mZ keyframe — from 4
// below, clear by 40 %, then drifting 6 right and 8 up as it fades — one
// after another, each a size smaller and further up and out.
const Z_LOOP_MS = 2400;
const ZS = [
  { size: 15, x: 138, y: 92, delay: 0 },
  { size: 12, x: 152, y: 76, delay: 800 },
  { size: 9.5, x: 164, y: 62, delay: 1600 },
];

function SleepZ({ size, x, y, delay, scale, animate }: { size: number; x: number; y: number; delay: number; scale: number; animate: boolean }) {
  const p = useSharedValue(0);
  useEffect(() => {
    if (!animate) {
      p.set(0.4);
      return;
    }
    p.set(0);
    p.set(withDelay(delay, withRepeat(withTiming(1, { duration: Z_LOOP_MS, easing: Easing.linear }), -1)));
    return () => cancelAnimation(p);
  }, [animate, delay, p]);
  const style = useAnimatedStyle(() => {
    const v = p.value;
    const opacity = v < 0.4 ? v / 0.4 : 1 - (v - 0.4) / 0.6;
    const drift = v < 0.4 ? 0 : (v - 0.4) / 0.6;
    return {
      opacity,
      transform: [{ translateX: 6 * scale * drift }, { translateY: v < 0.4 ? 4 * scale * (1 - v / 0.4) : -8 * scale * drift }],
    };
  });
  return (
    <Animated.Text
      style={[
        { position: "absolute", left: x * (scale * 0.95), top: y * (scale * 0.95), fontSize: size * scale, fontFamily: "SpaceGrotesk-Bold", color: "#7A6E64" },
        style,
      ]}
    >
      z
    </Animated.Text>
  );
}

/**
 * Nexdo's gem, the mascot: a rounded diamond of four lit facets with white
 * eyes. Its `level` (1–5) is today's progress — grey and asleep, waking,
 * awake, glowing, and on fire. It bobs, blinks, and its glow and core pulse;
 * all of it holds still with Reduce Motion, or when `animate` is off (the
 * page isn't on screen).
 */
export function GemMascot({ level, width = DESIGN_WIDTH, animate = true }: { level: GemLevel; width?: number; animate?: boolean }) {
  const reduceMotion = useReducedMotion();
  const moving = animate && !reduceMotion;
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const facets = level === 1 ? GREY : level === 2 ? BRONZE : ORANGE;
  const height = (width * VIEW_H) / VIEW_W;

  const bob = useSharedValue(0);
  const blink = useSharedValue(1);
  const pulse = useSharedValue(1);
  const frame = useSharedValue(0);

  useEffect(() => {
    if (!moving) {
      bob.set(0);
      blink.set(1);
      pulse.set(1);
      frame.set(0);
      return;
    }
    bob.set(withRepeat(withSequence(withTiming(1, { duration: BOB_MS, easing: inOut }), withTiming(0, { duration: BOB_MS, easing: inOut })), -1));
    blink.set(
      withRepeat(
        withSequence(
          withDelay(BLINK_WAIT_MS, withTiming(0.08, { duration: BLINK_SHUT_MS })),
          withTiming(1, { duration: BLINK_OPEN_MS }),
        ),
        -1,
      ),
    );
    pulse.set(0);
    pulse.set(withRepeat(withSequence(withTiming(1, { duration: PULSE_MS, easing: inOut }), withTiming(0, { duration: PULSE_MS, easing: inOut })), -1));
    if (level === 5) {
      frame.set(0);
      frame.set(withRepeat(withTiming(FRAMES.length, { duration: FLAME_LOOP_MS, easing: Easing.linear }), -1));
    }
    return () => {
      cancelAnimation(bob);
      cancelAnimation(blink);
      cancelAnimation(pulse);
      cancelAnimation(frame);
    };
  }, [blink, bob, frame, level, moving, pulse]);

  const scale = width / DESIGN_WIDTH;
  const bobStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -6 * scale * bob.value }] }));
  // The glow behind: 60 % → 100 % and back (mPulse).
  const haloProps = useAnimatedProps(() => ({ opacity: 0.6 + 0.4 * pulse.value }));
  // The lit core: brighter and a little bigger at the top of the pulse (mCore).
  const coreProps = useAnimatedProps(() => ({ opacity: 0.75 + 0.25 * pulse.value, r: 32 * (1 + 0.12 * pulse.value) }));
  // A blink squeezes each eye about its own centre.
  const smallEyes = level === 2;
  const eyeRy = smallEyes ? 8 : 12;
  const leftEyeProps = useAnimatedProps(() => ({ ry: eyeRy * blink.value }));
  const rightEyeProps = useAnimatedProps(() => ({ ry: eyeRy * blink.value }));
  const flameProps = useAnimatedProps(() => ({ d: FRAMES[Math.floor(frame.value) % FRAMES.length] }));

  const eyeY = smallEyes ? 131 : 128;
  const eyeRx = smallEyes ? 7 : 8;
  const g = (name: string) => `${id}${name}`;

  return (
    <Animated.View style={[{ width, height }, bobStyle]} pointerEvents="none">
      <Svg width={width} height={height} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} style={{ overflow: "visible" }}>
        <Defs>
          <ClipPath id={g("G")}>
            <Rect x={-44} y={-44} width={88} height={88} rx={25} transform="translate(100 140) rotate(45)" />
          </ClipPath>
          {(["tl", "tr"] as const).map((key) => (
            <LinearGradient key={key} id={g(key)} gradientUnits="userSpaceOnUse" x1={0} y1={72} x2={0} y2={140}>
              <Stop offset={0} stopColor={facets[key][0]} />
              <Stop offset={1} stopColor={facets[key][1]} />
            </LinearGradient>
          ))}
          {(["bl", "br"] as const).map((key) => (
            <LinearGradient key={key} id={g(key)} gradientUnits="userSpaceOnUse" x1={0} y1={134} x2={0} y2={208}>
              <Stop offset={0} stopColor={facets[key][0]} />
              <Stop offset={1} stopColor={facets[key][1]} />
            </LinearGradient>
          ))}
          <LinearGradient id={g("F")} x1={0} y1={0} x2={0} y2={1}>
            <Stop offset={0} stopColor="#FFEC94" />
            <Stop offset={0.55} stopColor="#FFC33E" />
            <Stop offset={1} stopColor="#FF9A2A" />
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
          <RadialGradient id={g("D")} cx="50%" cy="50%" r="50%">
            <Stop offset={0} stopColor="#140A06" stopOpacity={0.85} />
            <Stop offset={1} stopColor="#140A06" stopOpacity={0} />
          </RadialGradient>
        </Defs>

        {/* Level 5: the flame on top, a 30-frame loop (flame-frames.json). */}
        {level === 5 ? (
          <G transform="translate(0 -7)">
            <AnimatedPath d={FRAMES[0]} fill={`url(#${g("F")})`} animatedProps={flameProps} />
          </G>
        ) : null}
        {level >= 4 ? (
          <AnimatedCircle cx={100} cy={140} r={level === 5 ? 78 : 86} fill={`url(#${g("H")})`} animatedProps={haloProps} />
        ) : null}

        <G clipPath={`url(#${g("G")})`}>
          <Path d="M96 134 L28 140 L100 68 Z" fill={`url(#${g("tl")})`} />
          <Path d="M96 134 L100 68 L172 140 Z" fill={`url(#${g("tr")})`} />
          <Path d="M96 134 L172 140 L100 212 Z" fill={`url(#${g("br")})`} />
          <Path d="M96 134 L100 212 L28 140 Z" fill={`url(#${g("bl")})`} />
          {level === 2 ? <Circle cx={98} cy={142} r={30} fill={`url(#${g("D")})`} opacity={0.6} /> : null}
          {level >= 4 ? <AnimatedCircle cx={98} cy={138} r={32} fill={`url(#${g("C")})`} animatedProps={coreProps} /> : null}
        </G>

        {/* Eyes: shut (asleep), open and blinking, or happy arcs on fire. */}
        {level === 1 ? (
          <Path d="M76 128 Q84 135 92 128 M106 128 Q114 135 122 128" fill="none" stroke="#FFFFFF" strokeWidth={5} strokeLinecap="round" />
        ) : level === 5 ? (
          <Path d="M76 132 Q84 118 92 132 M106 132 Q114 118 122 132" fill="none" stroke="#FFFFFF" strokeWidth={5} strokeLinecap="round" />
        ) : (
          <>
            <AnimatedEllipse cx={84} cy={eyeY} rx={eyeRx} ry={eyeRy} fill="#FFFFFF" animatedProps={leftEyeProps} />
            <AnimatedEllipse cx={114} cy={eyeY} rx={eyeRx} ry={eyeRy} fill="#FFFFFF" animatedProps={rightEyeProps} />
          </>
        )}
      </Svg>
      {/* Asleep: z z z drifting up from its top-right corner. */}
      {level === 1 ? ZS.map((z) => <SleepZ key={z.delay} {...z} scale={scale} animate={moving} />) : null}
    </Animated.View>
  );
}

/**
 * The warm light behind the gem on Today: a soft orange disc that breathes
 * (60 % → 100 %, 2.6 s). Drawn as SVG so it's the same on every platform.
 */
export function GemGlow({ size = 300, animate = true }: { size?: number; animate?: boolean }) {
  const reduceMotion = useReducedMotion();
  const moving = animate && !reduceMotion;
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const breathe = useSharedValue(1);

  useEffect(() => {
    if (!moving) {
      breathe.set(1);
      return;
    }
    breathe.set(0);
    breathe.set(withRepeat(withSequence(withTiming(1, { duration: 1300, easing: inOut }), withTiming(0, { duration: 1300, easing: inOut })), -1));
    return () => cancelAnimation(breathe);
  }, [breathe, moving]);

  const style = useAnimatedStyle(() => ({ opacity: 0.6 + 0.4 * breathe.value }));

  // CSS's radial-gradient(circle, …) reaches the box's corner (√2 × half the
  // side), so the mockup's 42 % / 68 % stops sit at 0.594 / 0.962 of the disc.
  return (
    <Animated.View pointerEvents="none" style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={`${id}glow`} cx="50%" cy="50%" r="50%">
            <Stop offset={0} stopColor="rgb(255,175,80)" stopOpacity={0.6} />
            <Stop offset={0.594} stopColor="rgb(242,106,46)" stopOpacity={0.2} />
            <Stop offset={0.962} stopColor="rgb(242,106,46)" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id}glow)`} />
      </Svg>
    </Animated.View>
  );
}
