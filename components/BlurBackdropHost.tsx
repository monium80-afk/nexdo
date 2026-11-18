import { BlurView } from "expo-blur";
import { useEffect, useState, type ComponentRef, type RefObject } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { create } from "zustand";

import { MOTION } from "@/constants/theme";

// The Add task sheet's blur (the mockups' 7 px).
const BLUR_INTENSITY = 28;
const ANDROID_BLUR_REDUCTION = 2.4;

/** How many sheets want the page blurred right now. */
const useBackdropBlurStore = create<{ count: number; show: () => void; hide: () => void }>((set) => ({
  count: 0,
  show: () => set((state) => ({ count: state.count + 1 })),
  hide: () => set((state) => ({ count: Math.max(0, state.count - 1) })),
}));

// Let go a beat after the sheet has slid away, so a sheet opening straight
// after (Break it down's note → its steps) keeps the blur rather than it
// flickering off and on.
const RELEASE_DELAY_MS = MOTION.duration.screen + 80;

/** While `active`, the tabs behind are blurred (BlurBackdropHost). */
export function useBlurBehind(active: boolean) {
  useEffect(() => {
    if (!active) return;
    useBackdropBlurStore.getState().show();
    return () => {
      setTimeout(() => useBackdropBlurStore.getState().hide(), RELEASE_DELAY_MS);
    };
  }, [active]);
}

/**
 * The page blurred behind a sheet that sits in its own window (a Modal) —
 * Break it down's two sheets. Lives beside the tabs, outside what it blurs,
 * as Android needs (expo-blur's blurTarget).
 */
export function BlurBackdropHost({ blurTarget }: { blurTarget: RefObject<ComponentRef<typeof View> | null> }) {
  const wanted = useBackdropBlurStore((state) => state.count > 0);
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(wanted);
  const progress = useSharedValue(0);

  if (wanted && !mounted) setMounted(true);

  useEffect(() => {
    const duration = reduceMotion ? 0 : MOTION.duration.screen;
    if (wanted) {
      progress.set(withTiming(1, { duration, easing: MOTION.easing.standard }));
      return;
    }
    progress.set(
      withTiming(0, { duration, easing: MOTION.easing.standard }, (finished) => {
        if (finished) scheduleOnRN(setMounted, false);
      }),
    );
  }, [progress, reduceMotion, wanted]);

  const style = useAnimatedStyle(() => ({ opacity: progress.get() }));

  if (!mounted) return null;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <BlurView
        blurTarget={blurTarget}
        blurMethod="dimezisBlurViewSdk31Plus"
        blurReductionFactor={ANDROID_BLUR_REDUCTION}
        tint="default"
        intensity={BLUR_INTENSITY}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}
