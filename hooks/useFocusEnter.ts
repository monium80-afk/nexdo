import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

// Slow and soft on purpose: the page settles into place rather than snapping.
const DURATION = 520;
/** How far below its place a block starts. */
const RISE = 22;
/** Between one block and the next, so a page arrives top to bottom. */
export const FOCUS_ENTER_STAGGER = 90;

/**
 * The tab pages' entrance: every time the page comes into view, a block fades
 * in and rises into place. `order` staggers blocks down the page (0 the
 * header, 1 what's under it…), so they arrive one after another.
 *
 * Starts hidden and runs on focus — not on mount — so switching back to a tab
 * plays it again, which is what makes moving between tabs feel alive.
 */
export function useFocusEnter(order = 0) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(reduceMotion ? 1 : 0);

  useFocusEffect(
    useCallback(() => {
      if (reduceMotion) {
        progress.set(1);
        return;
      }
      progress.set(0);
      progress.set(
        withDelay(order * FOCUS_ENTER_STAGGER, withTiming(1, { duration: DURATION, easing: Easing.out(Easing.cubic) })),
      );
    }, [order, progress, reduceMotion]),
  );

  return useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * RISE }],
  }));
}
