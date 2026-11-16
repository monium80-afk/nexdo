import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useId, useState } from "react";
import { View } from "react-native";
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
} from "react-native-reanimated";
import Svg, { Circle, ClipPath, Defs, Ellipse, G, LinearGradient, Mask, Path, RadialGradient, Rect, Stop } from "react-native-svg";

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
 * eyes. Its `level` (1–5) is today's progress — grey and asleep (Sleepy),
 * waking (Flicker), awake (Steady), glowing (Glowing), and on fire (Blazing).
 * It bobs, blinks, and its glow and core pulse; all of it holds still with
 * Reduce Motion, or when `animate` is off (the page isn't on screen).
 *
 * It never swaps level at once (design/mascot-levelup-animation.html): going
 * up plays the level-up — a squash, the new level filling in, a flash and a
 * ring, a hop — one level at a time; going down cross-fades. With
 * `holdLevelUps` a rise waits (the old level stays) until it's let go, so it
 * plays where it can be seen — e.g. on Today once a focus session has closed.
 */
export function GemMascot({
  level,
  width = DESIGN_WIDTH,
  animate = true,
  holdLevelUps = false,
}: {
  level: GemLevel;
  width?: number;
  animate?: boolean;
  holdLevelUps?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const moving = animate && !reduceMotion;
  const height = (width * VIEW_H) / VIEW_W;

  // The bob carries everything, level-ups included.
  const bob = useSharedValue(0);
  useEffect(() => {
    if (!moving) {
      bob.set(0);
      return;
    }
    bob.set(withRepeat(withSequence(withTiming(1, { duration: BOB_MS, easing: inOut }), withTiming(0, { duration: BOB_MS, easing: inOut })), -1));
    return () => cancelAnimation(bob);
  }, [bob, moving]);
  const scale = width / DESIGN_WIDTH;
  const bobStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -6 * scale * bob.value }] }));

  // The level on screen, and the change playing over it (one level at a time going up).
  const [shown, setShown] = useState<GemLevel>(level);
  const [step, setStep] = useState<LevelStep | null>(null);
  const [stepKey, setStepKey] = useState(0);
  // Level-ups were held (the page out of view): the next one waits a beat.
  const [resumeAfterHold, setResumeAfterHold] = useState(false);
  const [wasHeld, setWasHeld] = useState(holdLevelUps);

  // Kept in step during render (React's "adjusting state when a prop
  // changes"), so no frame ever shows a level the gem didn't animate to.
  let resumedThisRender = false;
  if (wasHeld !== holdLevelUps) {
    setWasHeld(holdLevelUps);
    if (wasHeld && !holdLevelUps) {
      setResumeAfterHold(true);
      resumedThisRender = true;
    }
  }
  if (step) {
    // Gone back down mid-rise (a task un-done): stop it there and fade from it.
    if (step.kind === "up" && level < step.to) {
      setStep(null);
      setShown(step.to);
    }
  } else if (level < shown) {
    setStep({ key: stepKey + 1, from: shown, to: level, kind: "fade", ms: LEVEL_DOWN_MS });
    setStepKey(stepKey + 1);
  } else if (level > shown && !holdLevelUps && !resumeAfterHold && !resumedThisRender) {
    setStep(nextLevelUp(shown, stepKey + 1, reduceMotion));
    setStepKey(stepKey + 1);
  }

  // Back in view with a rise waiting: a beat, then it plays.
  useEffect(() => {
    if (!resumeAfterHold) return;
    const timer = setTimeout(() => {
      setResumeAfterHold(false);
    }, RESUME_DELAY_MS);
    return () => clearTimeout(timer);
  }, [resumeAfterHold]);

  const finishStep = useCallback((to: GemLevel) => {
    setShown(to);
    setStep(null);
  }, []);

  return (
    <Animated.View style={[{ width, height }, bobStyle]} pointerEvents="none">
      {step ? (
        <GemLevelStep key={step.key} step={step} width={width} moving={moving} onDone={finishStep} />
      ) : (
        <GemArt level={shown} width={width} moving={moving} />
      )}
    </Animated.View>
  );
}

type LevelStep = { key: number; from: GemLevel; to: GemLevel; kind: "up" | "fade"; ms: number };

/** One level up from `from` — the full level-up, or a plain fade with Reduce Motion. */
function nextLevelUp(from: GemLevel, key: number, reduceMotion: boolean): LevelStep {
  return {
    key,
    from,
    to: (from + 1) as GemLevel,
    kind: reduceMotion ? "fade" : "up",
    ms: reduceMotion ? LEVEL_UP_REDUCED_MS : LEVEL_UP_MS,
  };
}

// The level-up, from the mockup's t* keyframes (3.6 s loop, 1 % = 36 ms, the
// change starting at 18 %): ms from the start of each level's step.
const LEVEL_EASE = Easing.bezier(0.3, 0.7, 0.2, 1);
const LEVEL_UP_MS = 1950; // the ring is gone by 72 %
const LEVEL_UP_REDUCED_MS = 300;
const LEVEL_DOWN_MS = 250;
const RESUME_DELAY_MS = 300;
const LU = {
  squashMs: 288, // tBody 18 → 26 %
  unsquashMs: 144, // 26 → 30 %
  hopAt: 1008, // 46 %
  hopMs: [288, 288, 216], // up (54 %), land (62 %), rest (68 %)
  revealAt: 360, // tRise / tBloom 28 → 48 %
  revealMs: 720,
  flashUpMs: 432, // tFlash 28 → 40 %
  flashOutMs: 648, // 40 → 58 %
  waveAt: 936, // tWave 44 → 48 → 72 %
  waveInMs: 144,
  waveOutMs: 864,
  shootAt: 792, // tShoot 40 → 52 → 62 %
  shootUpMs: 432,
  shootSettleMs: 360,
  shootFadeMs: 216, // then gone as the step ends — the flame's own loop takes over
};
/** The ring's colour: the level being reached. */
const WAVE_COLOR: Record<GemLevel, string> = { 1: "#7A6E64", 2: "#B0612F", 3: "#F26A2E", 4: "#FFB547", 5: "#FFC93F" };

/**
 * One change of level: the old gem with the new one on top. Going up (the
 * mockup), the body squashes, the new level is revealed — from the bottom up,
 * or (Steady → Glowing) as a circle from the core — under a soft flash, a ring
 * goes out, and the gem hops; into Blazing a warm glow shoots up first.
 * Otherwise (going down, or with Reduce Motion) the new level fades in.
 * Transforms and opacity only, on the UI thread.
 */
function GemLevelStep({
  step,
  width,
  moving,
  onDone,
}: {
  step: LevelStep;
  width: number;
  moving: boolean;
  onDone: (to: GemLevel) => void;
}) {
  const { from, to, kind, ms } = step;
  const height = (width * VIEW_H) / VIEW_W;
  const u = width / VIEW_W; // one unit of the drawing, in points
  const bloom = from === 3 && to === 4;
  const up = kind === "up";

  const body = useSharedValue(0);
  const reveal = useSharedValue(0);
  const flash = useSharedValue(0);
  const wave = useSharedValue(0);
  const waveOpacity = useSharedValue(0);
  const shoot = useSharedValue(0);
  const shootOpacity = useSharedValue(0);
  const fade = useSharedValue(0);
  const [oldGone, setOldGone] = useState(false);

  useEffect(() => {
    const timing = (duration: number) => ({ duration, easing: LEVEL_EASE });
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (delay: number, run: () => void) => timers.push(setTimeout(run, delay));

    if (!up) {
      fade.set(withTiming(1, timing(ms)));
      if (to > from) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      at(LU.hopAt, () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}));
      // tBody: squash, back, then the hop: up, land, rest.
      body.set(
        withSequence(
          withTiming(1, timing(LU.squashMs)),
          withTiming(2, timing(LU.unsquashMs)),
          withDelay(LU.hopAt - LU.squashMs - LU.unsquashMs, withTiming(3, timing(LU.hopMs[0]))),
          withTiming(4, timing(LU.hopMs[1])),
          withTiming(5, timing(LU.hopMs[2])),
        ),
      );
      reveal.set(withDelay(LU.revealAt, withTiming(1, timing(LU.revealMs))));
      at(LU.revealAt + LU.revealMs, () => setOldGone(true));
      flash.set(withDelay(LU.revealAt, withSequence(withTiming(1, timing(LU.flashUpMs)), withTiming(2, timing(LU.flashOutMs)))));
      wave.set(withDelay(LU.waveAt, withTiming(1, timing(LU.waveInMs + LU.waveOutMs))));
      waveOpacity.set(withDelay(LU.waveAt, withSequence(withTiming(0.7, timing(LU.waveInMs)), withTiming(0, timing(LU.waveOutMs)))));
      if (to === 5) {
        shoot.set(withDelay(LU.shootAt, withSequence(withTiming(1, timing(LU.shootUpMs)), withTiming(2, timing(LU.shootSettleMs)))));
        shootOpacity.set(
          withDelay(
            LU.shootAt,
            withSequence(
              withTiming(1, timing(LU.shootUpMs)),
              withDelay(LU.shootSettleMs, withTiming(0, timing(LU.shootFadeMs))),
            ),
          ),
        );
      }
    }
    at(ms, () => onDone(to));
    return () => timers.forEach(clearTimeout);
  }, [body, fade, flash, from, ms, onDone, reveal, shoot, shootOpacity, to, up, wave, waveOpacity]);

  // tBody: translateY +4 / scale 1.06 × 0.92, back, −18 / 0.96 × 1.06, 1.04 × 0.96, rest.
  const bodyStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(body.value, [0, 1, 2, 3, 4, 5], [0, 4 * u, 0, -18 * u, 0, 0]) },
      { scaleX: interpolate(body.value, [0, 1, 2, 3, 4, 5], [1, 1.06, 1, 0.96, 1.04, 1]) },
      { scaleY: interpolate(body.value, [0, 1, 2, 3, 4, 5], [1, 0.92, 1, 1.06, 0.96, 1]) },
    ],
  }));

  // tRise: a window sliding up over the new gem while the gem itself stays
  // put — the clip-path inset done with two opposite translations. Padded so
  // the halo and the flame aren't cut at the edges.
  const pad = 40 * u;
  const span = height + 2 * pad;
  const riseWindow = useAnimatedStyle(() => ({ transform: [{ translateY: span * (1 - reveal.value) }] }));
  const riseContent = useAnimatedStyle(() => ({ transform: [{ translateY: -span * (1 - reveal.value) }] }));

  // tBloom: a round window grown from 50 % 60 % (to 80 % of the box's
  // reference radius), the gem inside scaled back by as much.
  const cx = width * 0.5;
  const cy = height * 0.6;
  const radius = 0.8 * (Math.hypot(width, height) / Math.SQRT2);
  const bloomWindow = useAnimatedStyle(() => ({
    opacity: reveal.value > 0.005 ? 1 : 0,
    transform: [{ scale: Math.max(reveal.value, 0.02) }],
  }));
  const bloomContent = useAnimatedStyle(() => ({ transform: [{ scale: 1 / Math.max(reveal.value, 0.02) }] }));

  // tFlash: 0 → .6 at 1×, then out to 1.25×, from 0.6×.
  const flashStyle = useAnimatedStyle(() => ({
    opacity: interpolate(flash.value, [0, 1, 2], [0, 0.6, 0]),
    transform: [{ scale: interpolate(flash.value, [0, 1, 2], [0.6, 1, 1.25]) }],
  }));
  // tWave: 0.6× → 1.4×, opacity up to .7 and out.
  const waveStyle = useAnimatedStyle(() => ({ opacity: waveOpacity.value, transform: [{ scale: 0.6 + 0.8 * wave.value }] }));
  // tShoot: scaleY 0.2 → 1.25 → 1 from its foot.
  const shootStyle = useAnimatedStyle(() => ({
    opacity: shootOpacity.value,
    transform: [{ scaleY: interpolate(shoot.value, [0, 1, 2], [0.2, 1.25, 1]) }],
  }));
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  if (!up) {
    return (
      <View style={{ width, height }}>
        <View style={{ position: "absolute", inset: 0 }}>
          <GemArt level={from} width={width} moving={moving} />
        </View>
        <Animated.View style={[{ position: "absolute", inset: 0 }, fadeStyle]}>
          <GemArt level={to} width={width} moving={moving} />
        </Animated.View>
      </View>
    );
  }

  const flashSize = 170 * u;
  const waveSize = 170 * u;
  const shootSize = 120 * u;
  return (
    <View style={{ width, height }}>
      {/* The ring goes out around the gem, not with its body. */}
      <Animated.View
        style={[
          {
            position: "absolute",
            left: 100 * u - waveSize / 2,
            top: 118 * u - waveSize / 2,
            width: waveSize,
            height: waveSize,
            borderRadius: waveSize / 2,
            borderWidth: Math.max(2, 4 * u),
            borderColor: WAVE_COLOR[to],
          },
          waveStyle,
        ]}
      />
      <Animated.View style={[{ position: "absolute", inset: 0, transformOrigin: "50% 100%" }, bodyStyle]}>
        {oldGone ? null : (
          <View style={{ position: "absolute", inset: 0 }}>
            <GemArt level={from} width={width} moving={moving} />
          </View>
        )}

        {/* Into Blazing: the warm glow shooting up from the top of the gem. */}
        {to === 5 ? (
          <Animated.View
            style={[
              { position: "absolute", left: 100 * u - shootSize / 2, top: 14 * u, width: shootSize, height: shootSize, transformOrigin: "50% 100%" },
              shootStyle,
            ]}
          >
            <ShootGlow size={shootSize} />
          </Animated.View>
        ) : null}

        {bloom ? (
          <Animated.View
            style={[
              { position: "absolute", left: cx - radius, top: cy - radius, width: radius * 2, height: radius * 2, borderRadius: radius, overflow: "hidden" },
              bloomWindow,
            ]}
          >
            <Animated.View style={[{ position: "absolute", left: radius - cx, top: radius - cy, width, height, transformOrigin: "50% 60%" }, bloomContent]}>
              <GemArt level={to} width={width} moving={moving} />
            </Animated.View>
          </Animated.View>
        ) : (
          <Animated.View style={[{ position: "absolute", left: -pad, top: -pad, width: width + 2 * pad, height: span, overflow: "hidden" }, riseWindow]}>
            <Animated.View style={[{ position: "absolute", left: pad, top: pad, width, height }, riseContent]}>
              <GemArt level={to} width={width} moving={moving} />
            </Animated.View>
          </Animated.View>
        )}

        {/* The soft cream flash over the gem. */}
        <Animated.View
          style={[{ position: "absolute", left: 100 * u - flashSize / 2, top: 140 * u - flashSize / 2, width: flashSize, height: flashSize }, flashStyle]}
        >
          <FlashGlow size={flashSize} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/** tFlash's disc: radial-gradient(circle, rgba(255,240,200,.95), rgba(255,200,120,0) 65%) — 65 % of the half-diagonal. */
function FlashGlow({ size }: { size: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <Svg width={size} height={size}>
      <Defs>
        <RadialGradient id={`${id}f`} cx="50%" cy="50%" r="50%">
          <Stop offset={0} stopColor="rgb(255,240,200)" stopOpacity={0.95} />
          <Stop offset={0.919} stopColor="rgb(255,200,120)" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id}f)`} />
    </Svg>
  );
}

/** tShoot's glow: radial-gradient(circle at 50% 70%, rgba(255,201,63,.85), rgba(255,154,42,0) 70%) in a rounded box. */
function ShootGlow({ size }: { size: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  // 70 % of the distance from 50 % 70 % to the box's farthest corner.
  const reach = 0.7 * Math.hypot(size * 0.5, size * 0.7);
  return (
    <Svg width={size} height={size}>
      <Defs>
        <RadialGradient id={`${id}s`} gradientUnits="userSpaceOnUse" cx={size / 2} cy={size * 0.7} r={reach} fx={size / 2} fy={size * 0.7}>
          <Stop offset={0} stopColor="rgb(255,201,63)" stopOpacity={0.85} />
          <Stop offset={1} stopColor="rgb(255,154,42)" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Ellipse cx={size / 2} cy={size / 2} rx={size / 2} ry={size / 2} fill={`url(#${id}s)`} />
    </Svg>
  );
}

/**
 * One level of the gem standing still on the page: no bob, no level-up —
 * the paywall's Blazing gem. Its flame, glow and core still move (not with
 * Reduce Motion). With `fadeBottom` its foot fades out, as the paywall's
 * mask does: opaque down to 62 % of the drawing, gone by 92 %.
 */
export function GemStill({ level, width, fadeBottom = false, still = false }: { level: GemLevel; width: number; fadeBottom?: boolean; /** Hold its own life (blink, flame) — e.g. while its screen is out of sight. */ still?: boolean }) {
  const reduceMotion = useReducedMotion();
  return <GemArt level={level} width={width} moving={!reduceMotion && !still} fadeBottom={fadeBottom} />;
}

// The fade's top and foot in the drawing's units: 62 % and 92 % of the
// 220-unit box the paywall shows (its viewBox starts at y 8).
const FADE_FROM_Y = 8 + 0.62 * VIEW_H;
const FADE_TO_Y = 8 + 0.92 * VIEW_H;

/**
 * The gem at one level, with that level's own life — blinking, the glow and
 * core pulsing, the flame flickering, the sleepy z's — but no bob (that's
 * GemMascot's, so a level-up rides on it).
 */
function GemArt({ level, width, moving, fadeBottom = false }: { level: GemLevel; width: number; moving: boolean; fadeBottom?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const facets = level === 1 ? GREY : level === 2 ? BRONZE : ORANGE;
  const height = (width * VIEW_H) / VIEW_W;

  const blink = useSharedValue(1);
  const pulse = useSharedValue(1);
  const frame = useSharedValue(0);

  useEffect(() => {
    if (!moving) {
      blink.set(1);
      pulse.set(1);
      frame.set(0);
      return;
    }
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
      cancelAnimation(blink);
      cancelAnimation(pulse);
      cancelAnimation(frame);
    };
  }, [blink, frame, level, moving, pulse]);

  const scale = width / DESIGN_WIDTH;
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
    <View style={{ width, height }} pointerEvents="none">
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
          {fadeBottom ? (
            <>
              <LinearGradient id={g("MF")} gradientUnits="userSpaceOnUse" x1={0} y1={FADE_FROM_Y} x2={0} y2={FADE_TO_Y}>
                <Stop offset={0} stopColor="#FFFFFF" />
                <Stop offset={1} stopColor="#000000" />
              </LinearGradient>
              <Mask id={g("M")} maskUnits="userSpaceOnUse" x={-40} y={-40} width={VIEW_W + 80} height={VIEW_H + 80}>
                <Rect x={-40} y={-40} width={VIEW_W + 80} height={VIEW_H + 80} fill={`url(#${g("MF")})`} />
              </Mask>
            </>
          ) : null}
        </Defs>

        {/* Everything goes through the fade's mask when there is one. */}
        <G mask={fadeBottom ? `url(#${g("M")})` : undefined}>
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
        </G>
      </Svg>
      {/* Asleep: z z z drifting up from its top-right corner. */}
      {level === 1 ? ZS.map((z) => <SleepZ key={z.delay} {...z} scale={scale} animate={moving} />) : null}
    </View>
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
