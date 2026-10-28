import { Feather } from "@expo/vector-icons";
import { useEffect } from "react";
import Animated, { interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

import { MOTION } from "@/constants/theme";
import { useColors } from "@/hooks/useTheme";

// An open box's edge: a warm dark brown, firm enough to read as "tap me".
const BOX_EDGE = "#5A4A3C";

/**
 * The task list's checkbox, drawn only — whatever holds it does the tapping,
 * so a whole row can toggle it. `overdue` gives an open box a red edge.
 *
 * Whether it's ticked is drawn straight from `checked`: the fill, the edge and
 * the tick are ordinary styles. Only the little squeeze and pop on a change is
 * animated, and that starts and ends at the box's normal size. Reanimated can
 * lose the last value of an animation that has finished, putting the view back
 * to how it was first drawn — with the colours animated, that left a finished
 * task with an empty box. package.json now switches that Reanimated behaviour
 * off for the whole app (FORCE_REACT_RENDER_FOR_SETTLED_ANIMATIONS), but this
 * box doesn't rely on it.
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
    transform: [{ scale: interpolate(progress.value, [0, 0.75, 1], [1, 0.92, 1]) }],
  }));
  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(progress.value, [0, 0.5, 1], [1, 1.2, 1]) }],
  }));

  const edge = checked ? colors.orange[500] : tone === "overdue" ? colors.overdue[500] : BOX_EDGE;

  // The tick is laid over the box rather than inside it, so to layout the box
  // holds no text — its baseline is its bottom edge, and a row aligned by
  // baseline sets a title's first line right on it (see TaskCard).
  return (
    <Animated.View
      className={checked ? "h-[22px] w-[22px] rounded-[7px] border-2 bg-orange-500" : "h-[22px] w-[22px] rounded-[7px] border-2"}
      style={[{ borderColor: edge }, boxStyle]}
    >
      {checked ? (
        <Animated.View className="absolute inset-0 items-center justify-center" style={checkStyle}>
          <Feather name="check" size={14} color={colors.onAccent} />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}
