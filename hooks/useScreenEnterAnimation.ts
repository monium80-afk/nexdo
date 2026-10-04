import { useEffect } from "react";
import { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

import { MOTION } from "@/constants/theme";

const RISE_DISTANCE = 14;

/**
 * Fade + rise entrance for a screen that only needs to animate in, replacing
 * the platform's default push transition (which we disable via
 * `animation: "none"` on the Stacks) so timing/easing stays exact and
 * consistent across iOS/Android/web. The onboarding steps animate out as well
 * as in, so they run their own version of this from OnboardingLayout.
 */
export function useScreenEnterAnimation() {
  const progress = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    progress.value = withTiming(1, {
      duration: reduceMotion ? 0 : MOTION.duration.screen,
      easing: MOTION.easing.enter,
    });
  }, [progress, reduceMotion]);

  return useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * RISE_DISTANCE }],
  }));
}
