import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

import { MOTION } from "@/constants/theme";

const ReanimatedPressable = Animated.createAnimatedComponent(Pressable);

type AnimatedPressableProps = Omit<PressableProps, "style"> & {
  scaleTo?: number;
  /**
   * A plain style only — not Pressable's `(state) => style` function form.
   * Reanimated and NativeWind both read `style` as an object/array and
   * silently drop a function, which used to swallow every inline style
   * passed here (e.g. a selected option's colors) along with the press
   * animation itself.
   */
  style?: StyleProp<ViewStyle>;
};

/**
 * Drop-in replacement for Pressable that adds a quick spring scale-down on
 * press — use anywhere a tap should feel tactile (buttons, cards, chips).
 * Keeping this as a single Pressable-based element (rather than wrapping
 * one) preserves the original hit area and lets `className` keep working
 * exactly like it does on plain Pressable.
 */
export function AnimatedPressable({ scaleTo = 0.96, onPressIn, onPressOut, style, ...rest }: AnimatedPressableProps) {
  const scale = useSharedValue(1);
  const reduceMotion = useReducedMotion();
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <ReanimatedPressable
      {...rest}
      onPressIn={(event) => {
        // Reanimated shared values are mutable-by-design (worklets read/write
        // `.value` directly) — react-hooks/immutability doesn't know that yet.
        // eslint-disable-next-line react-hooks/immutability
        scale.value = withTiming(scaleTo, {
          duration: reduceMotion ? 0 : MOTION.duration.pressIn,
          easing: MOTION.easing.enter,
        });
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        // eslint-disable-next-line react-hooks/immutability
        scale.value = withTiming(1, {
          duration: reduceMotion ? 0 : MOTION.duration.pressOut,
          easing: MOTION.easing.enter,
        });
        onPressOut?.(event);
      }}
      style={[style, animatedStyle]}
    />
  );
}
