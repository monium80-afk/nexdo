import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";

import { colors, gradients } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Where the green flood starts, in the card's own coordinates. */
export type OverlayOrigin = { x: number; y: number };

const DISC_SIZE = 84;
/** The tick, drawn in the disc's own 84×84 box. */
const CHECK_PATH = "M27 43.5 L37.5 54 L58 32.5";
/** A little longer than the tick itself, so one dash this long hides all of it. */
const CHECK_LENGTH = 46;

// The beats, in ms from the tap. Everything has landed by ~1 s, which is when
// the card is sent off (CELEBRATION_MS in NextTaskCard).
const FLOOD_MS = 460;
const DISC_DELAY_MS = 170;
const CHECK_DELAY_MS = 330;
const CHECK_MS = 300;
const RIPPLE_DELAY_MS = [250, 420];
const CONFETTI_DELAY_MS = 230;
const CONFETTI_MS = 950;
const TEXT_DELAY_MS = 420;
const DISC_SPRING = { damping: 9, stiffness: 210, mass: 0.7 };

// The disc's depth. No box shadow anywhere near it: a blurred shadow on a view
// that scales and spins is redrawn every frame on Android, and it was a real
// part of the stutter. The glow around the disc and the shadow under it are
// radial gradients instead (gradients.successHalo / successShadow) — plain
// fills, which cost nothing to scale.
const HALO_SIZE = 220;
const SHADOW_SIZE = 120;
/** How far below the disc's centre its shadow sits: lit from above, like every card. */
const SHADOW_DROP = 14;
const TITLE_SHADOW = {
  textShadowColor: "rgba(7, 54, 29, 0.35)",
  textShadowOffset: { width: 0, height: 2 },
  textShadowRadius: 8,
};

const CONFETTI_COLORS = [colors.onAccent, "#FFD166", colors.orange[300], "#FFFFFF", colors.orange[400], "#FFE8A3"];
// Spread all the way round, each piece its own distance, size and spin — fixed
// rather than random, so every completion looks as good as the one before.
const CONFETTI = Array.from({ length: 16 }, (_, index) => ({
  angle: (index / 16) * 2 * Math.PI + (index % 2 === 0 ? -0.14 : 0.2),
  reach: 70 + ((index * 37) % 52),
  spin: (index % 2 === 0 ? 1 : -1) * (240 + ((index * 53) % 280)),
  round: index % 3 === 0,
  color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
}));

type ConfettiPiece = (typeof CONFETTI)[number];

/** One scrap of confetti: bursts out of the disc, then drifts down, spinning, and fades. */
function Confetti({ progress, angle, reach, spin, round, color }: ConfettiPiece & { progress: SharedValue<number> }) {
  const width = round ? 7 : 5;
  const height = round ? 7 : 11;
  const style = useAnimatedStyle(() => {
    const p = progress.value;
    const out = 1 - (1 - p) ** 3;
    // Leaves from just inside the disc's edge, so it seems to come from behind it.
    const distance = 22 + reach * out;
    return {
      opacity: interpolate(p, [0, 0.04, 0.6, 1], [0, 1, 1, 0], Extrapolation.CLAMP),
      transform: [
        { translateX: Math.cos(angle) * distance },
        // A little gravity, so the burst settles instead of just stopping.
        { translateY: Math.sin(angle) * distance + 64 * p * p },
        { rotate: `${spin * p}deg` },
        { scale: interpolate(p, [0, 0.15, 1], [0.4, 1, 0.75], Extrapolation.CLAMP) },
      ],
    };
  });
  return (
    <Animated.View
      className="absolute"
      style={[
        {
          left: DISC_SIZE / 2 - width / 2,
          top: DISC_SIZE / 2 - height / 2,
          width,
          height,
          borderRadius: round ? width / 2 : 1.5,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

/** A ring breathing out of the disc as it lands. */
function Ripple({ progress }: { progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    opacity: progress.value === 0 ? 0 : 0.6 * (1 - progress.value),
    transform: [{ scale: 1 + progress.value * 1.5 }],
  }));
  return (
    <Animated.View
      className="absolute left-0 top-0 rounded-full border-[3px] border-white"
      style={[{ width: DISC_SIZE, height: DISC_SIZE }, style]}
    />
  );
}

/**
 * What a card becomes for a moment once its task is done. Green floods out of
 * the button that finished it and takes the light of the card it covers; a
 * disc springs in on its own glow and shadow, the tick draws itself across
 * it, rings ripple out and confetti bursts — then "Task complete".
 * A completed task drops straight out of the Next queue, so this is the beat
 * that says "that one's done" before the next task takes its place.
 *
 * Fills whatever holds it (the card clips it to its corners). Without an
 * `origin` the flood starts from the middle.
 */
export function CompletedOverlay({ title, origin }: { title: string; origin?: OverlayOrigin }) {
  const t = useTranslation();
  const rtl = useRtlText();
  const reduceMotion = useReducedMotion();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  const flood = useSharedValue(reduceMotion ? 1 : 0);
  const pop = useSharedValue(reduceMotion ? 1 : 0);
  const draw = useSharedValue(reduceMotion ? 1 : 0);
  const reveal = useSharedValue(reduceMotion ? 1 : 0);
  const firstRipple = useSharedValue(0);
  const secondRipple = useSharedValue(0);
  const burst = useSharedValue(0);

  // The flood circle can only be drawn once the overlay knows its size, a
  // layout later — so it starts then, rather than already part-grown.
  const sized = size !== null;
  useEffect(() => {
    if (reduceMotion || !sized) return;
    flood.set(withTiming(1, { duration: FLOOD_MS, easing: Easing.out(Easing.cubic) }));
  }, [flood, reduceMotion, sized]);

  useEffect(() => {
    if (reduceMotion) return;
    pop.set(withDelay(DISC_DELAY_MS, withSpring(1, DISC_SPRING)));
    draw.set(withDelay(CHECK_DELAY_MS, withTiming(1, { duration: CHECK_MS, easing: Easing.out(Easing.cubic) })));
    firstRipple.set(withDelay(RIPPLE_DELAY_MS[0], withTiming(1, { duration: 700, easing: Easing.out(Easing.quad) })));
    secondRipple.set(withDelay(RIPPLE_DELAY_MS[1], withTiming(1, { duration: 800, easing: Easing.out(Easing.quad) })));
    burst.set(withDelay(CONFETTI_DELAY_MS, withTiming(1, { duration: CONFETTI_MS, easing: Easing.linear })));
    reveal.set(withDelay(TEXT_DELAY_MS, withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) })));
  }, [burst, draw, firstRipple, pop, reduceMotion, reveal, secondRipple]);

  const floodStyle = useAnimatedStyle(() => ({ transform: [{ scale: flood.value }] }));
  // The light settles on the green as it finishes spreading.
  const sheenStyle = useAnimatedStyle(() => ({
    opacity: interpolate(flood.value, [0.4, 1], [0, 1], Extrapolation.CLAMP),
  }));
  const discStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pop.value }, { rotate: `${interpolate(pop.value, [0, 1], [-35, 0])}deg` }],
  }));
  // Both arrive with the disc, and overshoot with its spring.
  const haloStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pop.value, [0, 0.6], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(pop.value, [0, 1], [0.5, 1]) }],
  }));
  const shadowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pop.value, [0, 0.6], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: pop.value }],
  }));
  const checkProps = useAnimatedProps(() => ({ strokeDashoffset: CHECK_LENGTH * (1 - draw.value) }));
  const textStyle = useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: [{ translateY: interpolate(reveal.value, [0, 1], [14, 0]) }],
  }));

  // A circle centred on the origin, just big enough to reach the far corner.
  let floodCircle = null;
  if (size) {
    const x = Math.min(Math.max(origin?.x ?? size.width / 2, 0), size.width);
    const y = Math.min(Math.max(origin?.y ?? size.height / 2, 0), size.height);
    const radius = Math.hypot(Math.max(x, size.width - x), Math.max(y, size.height - y));
    floodCircle = (
      <Animated.View
        className="absolute"
        style={[
          { left: x - radius, top: y - radius, width: radius * 2, height: radius * 2, borderRadius: radius },
          { backgroundColor: colors.success[500] },
          gradients.success,
          floodStyle,
        ]}
      />
    );
  }

  return (
    <View
      accessibilityLiveRegion="polite"
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setSize((current) => (current?.width === width && current.height === height ? current : { width, height }));
      }}
      className="absolute bottom-0 left-0 right-0 top-0 overflow-hidden"
    >
      {floodCircle}
      <Animated.View
        pointerEvents="none"
        className="absolute bottom-0 left-0 right-0 top-0"
        style={[gradients.successSheen, sheenStyle]}
      />

      <View className="absolute bottom-0 left-0 right-0 top-0 items-center justify-center gap-5 px-8">
        <View style={{ width: DISC_SIZE, height: DISC_SIZE }}>
          <Animated.View
            className="absolute"
            style={[
              {
                left: (DISC_SIZE - SHADOW_SIZE) / 2,
                top: (DISC_SIZE - SHADOW_SIZE) / 2 + SHADOW_DROP,
                width: SHADOW_SIZE,
                height: SHADOW_SIZE,
              },
              gradients.successShadow,
              shadowStyle,
            ]}
          />
          <Animated.View
            className="absolute"
            style={[
              {
                left: (DISC_SIZE - HALO_SIZE) / 2,
                top: (DISC_SIZE - HALO_SIZE) / 2,
                width: HALO_SIZE,
                height: HALO_SIZE,
              },
              gradients.successHalo,
              haloStyle,
            ]}
          />
          {reduceMotion ? null : (
            <>
              <Ripple progress={firstRipple} />
              <Ripple progress={secondRipple} />
              {CONFETTI.map((piece, index) => (
                <Confetti key={index} progress={burst} {...piece} />
              ))}
            </>
          )}
          <Animated.View
            className="items-center justify-center rounded-full border border-white bg-on-accent"
            style={[{ width: DISC_SIZE, height: DISC_SIZE }, gradients.successDisc, discStyle]}
          >
            <Svg width={DISC_SIZE} height={DISC_SIZE}>
              {/* The tick in the Complete button's own green, light to deep. */}
              <Defs>
                <LinearGradient id="tick" x1="0" y1="0" x2="1" y2="1">
                  <Stop offset="0" stopColor="#3DB56E" />
                  <Stop offset="1" stopColor={colors.success[500]} />
                </LinearGradient>
              </Defs>
              <AnimatedPath
                d={CHECK_PATH}
                fill="none"
                stroke="url(#tick)"
                strokeWidth={7}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={CHECK_LENGTH}
                animatedProps={checkProps}
              />
            </Svg>
          </Animated.View>
        </View>

        <Animated.View className="items-center gap-1.5" style={textStyle}>
          <Text className="font-grotesk-bold text-[22px] tracking-tight text-on-accent" style={TITLE_SHADOW}>
            {t.next.taskComplete}
          </Text>
          <Text numberOfLines={2} style={rtl} className="text-center font-grotesk-medium text-sm text-on-accent/80">
            {title}
          </Text>
        </Animated.View>
      </View>
    </View>
  );
}
