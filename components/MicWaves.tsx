import { useEffect } from "react";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

const AnimatedPath = Animated.createAnimatedComponent(Path);

const STEP = 6;
const TWO_PI = Math.PI * 2;
const LOOP_MS = 900;
/** The tallest a wave swings from its middle line, at full voice. */
const MAX_AMP = 22;

/**
 * One wave line across the width: a sine swelling in the middle (where the
 * gem sits) and calmer at the edges, as tall as the voice is loud.
 */
function wavePath(width: number, cy: number, amp: number, wavelength: number, phase: number) {
  "worklet";
  const spread = width * 0.3;
  let d = "";
  for (let x = 0; x <= width + STEP; x += STEP) {
    const px = Math.min(x, width);
    const envelope = 0.25 + 0.75 * Math.exp(-(((px - width / 2) / spread) ** 2));
    const y = cy + amp * envelope * Math.sin((px / wavelength) * TWO_PI + phase);
    d += `${x === 0 ? "M" : " L"}${px.toFixed(1)},${y.toFixed(1)}`;
  }
  return d;
}

/**
 * Magic mic's three sound lines (Final-Mic.html: orange, peach, white) right
 * across the screen behind the gem. They answer the voice: flat while the
 * user is quiet, swelling and running while they speak (`level`, 0–1).
 */
export function MicWaves({ level, width, height }: { level: SharedValue<number>; width: number; height: number }) {
  const reduceMotion = useReducedMotion();
  const clock = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    clock.set(withRepeat(withTiming(TWO_PI, { duration: LOOP_MS, easing: Easing.linear }), -1));
    return () => cancelAnimation(clock);
  }, [clock, reduceMotion]);

  const cy = height / 2;
  const orange = useAnimatedProps(() => ({
    d: wavePath(width, cy, MAX_AMP * level.value, 150, clock.value),
  }));
  const peach = useAnimatedProps(() => ({
    d: wavePath(width, cy, MAX_AMP * 0.8 * level.value, 130, -clock.value * 1.2 + 1.3),
  }));
  const white = useAnimatedProps(() => ({
    d: wavePath(width, cy, MAX_AMP * 0.65 * level.value, 115, clock.value * 1.4 + 2.4),
  }));

  const flat = `M0,${cy} L${width},${cy}`;
  return (
    <Svg width={width} height={height} pointerEvents="none">
      <AnimatedPath d={flat} animatedProps={orange} fill="none" stroke="#F26A2E" strokeWidth={4} strokeLinecap="round" />
      <AnimatedPath d={flat} animatedProps={peach} fill="none" stroke="#FFB089" strokeWidth={3} strokeLinecap="round" />
      <AnimatedPath d={flat} animatedProps={white} fill="none" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}
