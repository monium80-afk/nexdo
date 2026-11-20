import { memo } from "react";
import { View } from "react-native";
import Animated, { Easing, useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import Svg, { Circle, Defs, G, Mask, Path, RadialGradient, Rect, Stop } from "react-native-svg";

import { useSvgId } from "@/components/onboarding/OnboardingKit";
import { CSS_EASE_IN_OUT, kf } from "@/components/onboarding/timeline";

import { PAYWALL_BG } from "./paywallTheme";

// The paywall's background (paywall-7b.html): a warm glow at the top and an
// ember-red one at the foot, the glow breathing behind the gem, faint light
// rays turning once a minute, dots twinkling near the top and embers rising
// round the gem. Everything moves by opacity and transform only, read off the
// screen's one clock (`clock`, in seconds — it stands still with Reduce
// Motion and while the paywall is out of sight).
//
// Positions are the mock's (390 wide, the gem's top at y 44): `place` turns
// them into this screen's, centred on its width and following the gem.

/** CSS ease-out, which the embers rise with. */
const EASE_OUT = Easing.bezierFn(0, 0, 0.58, 1);

/** The 14 twinkling dots: x, y, period and delay in seconds (m7Tw). */
const TWINKLES: readonly (readonly [number, number, number, number])[] = [
  [187, 31, 4.9, 1.4], [322, 79, 3.7, 0.9], [157, 86, 4.3, 1.6], [264, 61, 2.9, 1.6], [152, 90, 4.5, 3.5],
  [152, 232, 5.0, 2.7], [204, 138, 2.9, 0.7], [128, 139, 2.5, 3.3], [103, 154, 3.2, 0.6], [283, 209, 4.0, 1.3],
  [74, 283, 4.9, 2.6], [37, 253, 4.7, 3.1], [358, 306, 3.5, 1.6], [63, 266, 4.1, 0.2],
];

/** The 16 embers: x, y, size, colour, drift, period and delay (m7Up). */
const EMBERS: readonly (readonly [number, number, number, string, number, number, number])[] = [
  [87, 230, 3, "#FFB45E", 5, 6.0, 5.0], [101, 228, 2, "#FFD27A", 10, 6.5, 0.4], [219, 250, 3, "#FFB45E", -16, 4.7, 5.2],
  [144, 253, 2, "#FFB45E", 4, 4.9, 1.9], [278, 287, 2, "#FFB45E", -24, 6.5, 3.8], [165, 212, 4, "#FFD27A", 15, 4.7, 0.4],
  [122, 263, 2, "#FFD27A", 4, 6.0, 1.9], [219, 258, 3, "#FF9A55", -11, 5.4, 1.1], [269, 231, 4, "#FFB45E", 6, 5.6, 3.0],
  [157, 293, 2, "#FF9A55", -12, 6.6, 0.4], [201, 253, 4, "#FFB45E", 18, 5.7, 5.6], [177, 205, 2, "#FFD27A", -26, 7.2, 3.4],
  [294, 240, 2, "#FF9A55", 14, 5.7, 3.0], [274, 258, 2, "#FFB45E", 23, 4.8, 1.6], [248, 285, 3, "#FFB45E", -27, 7.1, 1.9],
  [217, 287, 3, "#FF9A55", -12, 7.0, 5.3],
];

/** How far into a looping animation of `period` s that began `delay` s in: 0 → 1 (0 until it begins). */
function loop(t: number, period: number, delay: number) {
  "worklet";
  if (t < delay) return 0;
  return ((t - delay) % period) / period;
}

type Place = { x: (mockX: number) => number; y: (mockY: number) => number; k: number };

function Twinkle({ clock, x, y, period, delay }: { clock: SharedValue<number>; x: number; y: number; period: number; delay: number }) {
  const style = useAnimatedStyle(() => {
    const p = loop(clock.value, period, delay);
    return { opacity: kf(p, [[0, 0.15], [0.5, 0.9], [1, 0.15]], CSS_EASE_IN_OUT) };
  });
  return <Animated.View style={[{ position: "absolute", left: x, top: y, width: 2, height: 2, borderRadius: 1, backgroundColor: "#FFE2B8" }, style]} />;
}

/** One ember: a dot with its glow (the mock's box-shadow), drawn once and only moved. */
const EmberArt = memo(function EmberArt({ size, color }: { size: number; color: string }) {
  const id = useSvgId("ember");
  // box-shadow: 0 0 (3 × size) (size / 2) — the glow reaches the blur past the spread.
  const reach = size / 2 + size / 2 + 3 * size;
  const box = reach * 2;
  const core = size / 2 / reach;
  return (
    <Svg width={box} height={box}>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset={0} stopColor={color} />
          <Stop offset={core} stopColor={color} />
          <Stop offset={Math.min(0.99, core + 0.08)} stopColor="rgb(255,150,60)" stopOpacity={0.5} />
          <Stop offset={1} stopColor="rgb(255,150,60)" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={reach} cy={reach} r={reach} fill={`url(#${id})`} />
    </Svg>
  );
});

function Ember({ clock, x, y, size, color, dx, period, delay }: { clock: SharedValue<number>; x: number; y: number; size: number; color: string; dx: number; period: number; delay: number }) {
  const style = useAnimatedStyle(() => {
    const p = loop(clock.value, period, delay);
    const rise = EASE_OUT(p);
    return {
      opacity: clock.value < delay ? 0 : kf(p, [[0, 0], [0.15, 1], [0.7, 0.7], [1, 0]], EASE_OUT),
      transform: [{ translateX: dx * rise }, { translateY: -210 * rise }, { scale: 0.6 + 0.4 * rise }],
    };
  });
  const reach = size + 3 * size;
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", left: x + size / 2 - reach, top: y + size / 2 - reach }, style]}>
      <EmberArt size={size} color={color} />
    </Animated.View>
  );
}

/** The light rays: 15 soft wedges (6° lit, fading out by 10°, every 24°), faded towards their ends. */
const Rays = memo(function Rays({ size }: { size: number }) {
  const fadeId = useSvgId("rayFade");
  const maskId = useSvgId("rayMask");
  const r = size / 2;
  const wedge = (from: number, to: number) => {
    const a = (from * Math.PI) / 180;
    const b = (to * Math.PI) / 180;
    // conic-gradient's 0° points up and turns clockwise.
    return `M${r} ${r} L${r + r * Math.sin(a)} ${r - r * Math.cos(a)} L${r + r * Math.sin(b)} ${r - r * Math.cos(b)} Z`;
  };
  const rays = Array.from({ length: 15 }, (_, index) => index * 24);
  return (
    <Svg width={size} height={size}>
      <Defs>
        {/* radial-gradient(circle, #000 0, rgba(0,0,0,.5) 28 %, transparent 56 %), its % of the corner distance. */}
        <RadialGradient id={fadeId} cx={r} cy={r} r={r * Math.SQRT2} gradientUnits="userSpaceOnUse">
          <Stop offset={0} stopColor="#FFFFFF" />
          <Stop offset={0.28} stopColor="#FFFFFF" stopOpacity={0.5} />
          <Stop offset={0.56} stopColor="#FFFFFF" stopOpacity={0} />
        </RadialGradient>
        <Mask id={maskId} maskUnits="userSpaceOnUse" x={0} y={0} width={size} height={size}>
          <Rect width={size} height={size} fill={`url(#${fadeId})`} />
        </Mask>
      </Defs>
      <G mask={`url(#${maskId})`} fill="rgb(255,170,90)">
        {rays.map((start) => (
          <G key={start}>
            {/* Lit from 0° to 6°, then fading to nothing by 10° — and a little either side for the mock's 3 px blur. */}
            <Path d={wedge(start - 0.6, start + 6.6)} fillOpacity={0.085} />
            <Path d={wedge(start + 6.6, start + 8)} fillOpacity={0.06} />
            <Path d={wedge(start + 8, start + 9.4)} fillOpacity={0.03} />
            <Path d={wedge(start - 1.4, start - 0.6)} fillOpacity={0.03} />
          </G>
        ))}
      </G>
    </Svg>
  );
});

/** The two still glows: warm brown at the top, ember red at the foot. */
const Washes = memo(function Washes({ width, height }: { width: number; height: number }) {
  const topId = useSvgId("washTop");
  const footId = useSvgId("washFoot");
  return (
    <Svg width={width} height={height} style={{ position: "absolute", top: 0, left: 0 }}>
      <Defs>
        {/* radial-gradient(120% 60% at 50% 0%, #3A2117 0, transparent 60%) */}
        <RadialGradient id={topId} cx={0} cy={0} r={1} gradientUnits="userSpaceOnUse" gradientTransform={`translate(${width / 2} 0) scale(${width * 1.2} ${height * 0.6})`}>
          <Stop offset={0} stopColor="#3A2117" />
          <Stop offset={0.6} stopColor={PAYWALL_BG} stopOpacity={0} />
        </RadialGradient>
        {/* radial-gradient(90% 40% at 50% 100%, rgba(140,52,18,.35), transparent 70%) */}
        <RadialGradient id={footId} cx={0} cy={0} r={1} gradientUnits="userSpaceOnUse" gradientTransform={`translate(${width / 2} ${height}) scale(${width * 0.9} ${height * 0.4})`}>
          <Stop offset={0} stopColor="rgb(140,52,18)" stopOpacity={0.35} />
          <Stop offset={0.7} stopColor={PAYWALL_BG} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width={width} height={height} fill={`url(#${topId})`} />
      <Rect width={width} height={height} fill={`url(#${footId})`} />
    </Svg>
  );
});

/** The breathing glow behind the gem: 440 px, orange fading out by 62 % of the corner distance (m7Glow). */
const Glow = memo(function Glow({ size }: { size: number }) {
  const id = useSvgId("glow");
  const r = size / 2;
  return (
    <Svg width={size} height={size}>
      <Defs>
        <RadialGradient id={id} cx={r} cy={r} r={r * Math.SQRT2} gradientUnits="userSpaceOnUse">
          <Stop offset={0} stopColor="rgb(255,140,50)" stopOpacity={0.38} />
          <Stop offset={0.62} stopColor="rgb(255,140,60)" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width={size} height={size} fill={`url(#${id})`} />
    </Svg>
  );
});

export function PaywallBackdrop({ clock, width, height, place }: { clock: SharedValue<number>; width: number; height: number; place: Place }) {
  const glowSize = 440 * place.k;
  const raySize = 560 * place.k;
  const centerX = width / 2;
  const centerY = place.y(150);

  const glowStyle = useAnimatedStyle(() => {
    const p = loop(clock.value, 4, 0);
    const v = kf(p, [[0, 0], [0.5, 1], [1, 0]], CSS_EASE_IN_OUT);
    return { opacity: 0.75 + 0.25 * v, transform: [{ scale: 1 + 0.06 * v }] };
  });
  const rayStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${(loop(clock.value, 60, 0) * 360).toFixed(3)}deg` }] }));

  return (
    <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, width, height, overflow: "hidden" }}>
      {/* The glow is drawn under the washes, as in the mock. */}
      <Animated.View style={[{ position: "absolute", left: centerX - glowSize / 2, top: centerY - glowSize / 2 }, glowStyle]}>
        <Glow size={glowSize} />
      </Animated.View>
      <Washes width={width} height={height} />
      <Animated.View renderToHardwareTextureAndroid shouldRasterizeIOS style={[{ position: "absolute", left: centerX - raySize / 2, top: centerY - raySize / 2 }, rayStyle]}>
        <Rays size={raySize} />
      </Animated.View>
      {TWINKLES.map(([x, y, period, delay]) => (
        <Twinkle key={`${x}-${y}`} clock={clock} x={place.x(x)} y={place.y(y)} period={period} delay={delay} />
      ))}
      {EMBERS.map(([x, y, size, color, dx, period, delay]) => (
        <Ember key={`${x}-${y}`} clock={clock} x={place.x(x)} y={place.y(y)} size={size} color={color} dx={dx} period={period} delay={delay} />
      ))}
    </View>
  );
}

export type { Place as BackdropPlace };
