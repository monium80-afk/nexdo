import { useIsFocused } from "expo-router";
import { useEffect, useState } from "react";
import type { TextStyle, ViewStyle } from "react-native";
import {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

// The onboarding mocks animate with CSS keyframes on a looping clock. In the
// app each one plays once and holds its last frame, so a screen gets one clock
// in seconds (useOnceClock) and every element reads its keyframes off it with
// kf() — the mock's percentages turned into seconds, each segment eased the
// way the CSS animation's timing function eases it.

/** CSS `ease`. */
export const CSS_EASE = Easing.bezierFn(0.25, 0.1, 0.25, 1);
/** CSS `ease-in-out`. */
export const CSS_EASE_IN_OUT = Easing.bezierFn(0.42, 0, 0.58, 1);
/** The mocks' entrance curve, cubic-bezier(.2,.8,.2,1). */
export const CSS_OUT = Easing.bezierFn(0.2, 0.8, 0.2, 1);
export const LINEAR = (x: number) => {
  "worklet";
  return x;
};

export type Frames = readonly (readonly [number, number])[];

/**
 * The value at `t` seconds between keyframes — [seconds, value] pairs in
 * order. Before the first it holds the first value, after the last the last.
 * No `ease` means linear. (Not a `= LINEAR` default: this runs on the UI
 * thread, where a default parameter's outer value may not be carried over —
 * calling a missing function there closes the app on Android, 2026-11-12.)
 */
export function kf(t: number, frames: Frames, ease?: (x: number) => number): number {
  "worklet";
  if (t <= frames[0][0]) return frames[0][1];
  for (let index = 1; index < frames.length; index += 1) {
    const [t1, v1] = frames[index];
    if (t <= t1) {
      const [t0, v0] = frames[index - 1];
      const span = t1 - t0;
      const raw = span <= 0 ? 1 : (t - t0) / span;
      const fraction = ease ? ease(raw) : raw;
      return v0 + (v1 - v0) * fraction;
    }
  }
  return frames[frames.length - 1][1];
}

/** A mock percentage of a `loop`-second animation, in seconds. */
export function at(percent: number, loop: number): number {
  "worklet";
  return (percent / 100) * loop;
}

/**
 * A clock that runs once from 0 to `end` seconds and stops there — the
 * screen's animation plays, then holds. With Reduce Motion it starts at the
 * end: the final state, straight away.
 */
export function useOnceClock(end: number, delayMs = 0): SharedValue<number> {
  const reduceMotion = useReducedMotion();
  const clock = useSharedValue(reduceMotion ? end : 0);
  useEffect(() => {
    if (reduceMotion) {
      clock.value = end;
      return;
    }
    clock.value = 0;
    clock.value = withDelay(delayMs, withTiming(end, { duration: end * 1000, easing: LINEAR }));
    return () => cancelAnimation(clock);
  }, [clock, delayMs, end, reduceMotion]);
  return clock;
}

/**
 * A screen's once-through animation, made safe: `t` runs 0 → `end` seconds,
 * and once it should be over `settled` turns true, so every style built with
 * useTimelineStyle is drawn from React as its final value — not left to the
 * animation. If the animation never ran or lost its last frame (a busy or
 * low-end phone), the screen still ends up fully drawn. Reduce Motion:
 * settled from the start.
 */
export type Timeline = { t: SharedValue<number>; end: number; settled: boolean };

export function useTimeline(end: number, delayMs = 0): Timeline {
  const reduceMotion = useReducedMotion();
  // A screen left behind in the stack stays mounted: its animation jumps to
  // the end and stops, so it costs nothing while out of sight.
  const focused = useIsFocused();
  const t = useSharedValue(reduceMotion ? end : 0);
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (reduceMotion) return;
    t.value = 0;
    t.value = withDelay(delayMs, withTiming(end, { duration: end * 1000, easing: LINEAR }));
    const timer = setTimeout(() => setOver(true), delayMs + end * 1000 + 150);
    return () => {
      clearTimeout(timer);
      cancelAnimation(t);
    };
  }, [t, delayMs, end, reduceMotion]);
  useEffect(() => {
    if (focused) return;
    cancelAnimation(t);
    // Shared values are mutable by design; the hooks lint rule doesn't know (as in AnimatedPressable).
    // eslint-disable-next-line react-hooks/immutability
    t.value = end;
  }, [t, end, focused]);
  return { t, end, settled: over || reduceMotion || !focused };
}

/**
 * A style read off a timeline: `style(t)` (a worklet) while it plays, then
 * the plain object `style(end)` from React once it has settled.
 */
export function useTimelineStyle<S extends ViewStyle | TextStyle>(timeline: Timeline, style: (t: number) => S) {
  const { t } = timeline;
  const animated = useAnimatedStyle(() => style(t.value));
  return timeline.settled ? style(timeline.end) : animated;
}

/**
 * A clock that keeps running (the ambient loops: listening pulse, lock-screen
 * notification) — seconds since mount, wrapping every `period`. Holds at 0
 * with Reduce Motion.
 */
export function useLoopClock(period: number): SharedValue<number> {
  const reduceMotion = useReducedMotion();
  // A screen left behind in the stack stays mounted: its loop stops until it's back in front.
  const focused = useIsFocused();
  const clock = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion || !focused) return;
    clock.value = 0;
    // Each pass runs 0 → period, then starts again from 0.
    clock.value = withRepeat(withTiming(period, { duration: period * 1000, easing: LINEAR }), -1, false);
    return () => cancelAnimation(clock);
  }, [clock, focused, period, reduceMotion]);
  return clock;
}
