import { Feather } from "@expo/vector-icons";
import { useEffect } from "react";
import Animated, { interpolate, interpolateColor, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

import { MOTION } from "@/constants/theme";
import { useColors } from "@/hooks/useTheme";

// An open box's edge: a warm dark brown, firm enough to read as "tap me".
const BOX_EDGE = "#5A4A3C";

/**
 * The task list's checkbox, drawn only — whatever holds it does the tapping,
 * so a whole row can toggle it. `overdue` gives an open box a red edge.
 */
export function Checkbox({ checked, tone = "default" }: { checked: boolean; tone?: "default" | "overdue" }) {
  const colors = useColors();
  const progress = useSharedValue(checked ? 1 : 0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    progress.value = withTiming(checked ? 1 : 0, {
      duration: reduceMotion ? 0 : MOTION.duration.short,
      easing: MOTION.easing.standard,
    });
  }, [checked, progress, reduceMotion]);

  const boxStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], ["rgba(0,0,0,0)", colors.orange[500]]),
    borderColor: interpolateColor(
      progress.value,
      [0, 1],
      [tone === "overdue" ? colors.overdue[500] : BOX_EDGE, colors.orange[500]],
    ),
    transform: [{ scale: interpolate(progress.value, [0, 0.75, 1], [1, 0.92, 1]) }],
  }));
  const checkStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.75, 1]) }],
  }));

  // The tick is laid over the box rather than inside it, so to layout the box
  // holds no text — its baseline is its bottom edge, and a row aligned by
  // baseline sets a title's first line right on it (see TaskCard).
  return (
    <Animated.View className="h-[22px] w-[22px] rounded-[7px] border-2" style={boxStyle}>
      <Animated.View className="absolute inset-0 items-center justify-center" style={checkStyle}>
        <Feather name="check" size={14} color={colors.onAccent} />
      </Animated.View>
    </Animated.View>
  );
}
