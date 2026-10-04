import { View } from "react-native";
import Animated, { Extrapolation, interpolate, useAnimatedStyle, type SharedValue } from "react-native-reanimated";

import { colors } from "@/constants/theme";

// Sparks leave from just inside the checkbox's edge, so they appear from
// behind it, and fly out to two alternating distances.
const SPARK_START = 9;
const SPARKS = Array.from({ length: 8 }, (_, index) => ({
  angle: (index / 8) * 2 * Math.PI + Math.PI / 8,
  reach: index % 2 === 0 ? 27 : 20,
  size: index % 2 === 0 ? 5 : 4,
  color: [colors.orange[500], colors.amber[500], colors.olive[500]][index % 3],
}));

type SparkProps = (typeof SPARKS)[number] & { progress: SharedValue<number> };

function Spark({ progress, angle, reach, size, color }: SparkProps) {
  const style = useAnimatedStyle(() => {
    const distance = interpolate(progress.value, [0, 1], [SPARK_START, reach]);
    return {
      opacity: interpolate(progress.value, [0, 0.05, 0.55, 1], [0, 1, 1, 0], Extrapolation.CLAMP),
      transform: [
        { translateX: Math.cos(angle) * distance },
        { translateY: Math.sin(angle) * distance },
        { scale: interpolate(progress.value, [0.35, 1], [1, 0.2], Extrapolation.CLAMP) },
      ],
    };
  });

  return (
    <Animated.View
      className="absolute rounded-full"
      style={[{ left: 11 - size / 2, top: 11 - size / 2, width: size, height: size, backgroundColor: color }, style]}
    />
  );
}

/**
 * The send-off when a task is ticked: an orange ring and a spray of sparks
 * bursting out of a 22px checkbox. Place it over the checkbox, before it, so
 * the checkbox draws on top. `progress` plays it from 0 to 1; it is invisible
 * at both ends, so it can stay mounted.
 */
export function CompletionBurst({ progress }: { progress: SharedValue<number> }) {
  const ringStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.05, 0.7], [0, 0.85, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.8, 2.3]) }],
  }));

  return (
    <View className="pointer-events-none absolute left-0 top-0 h-[22px] w-[22px]">
      <Animated.View className="absolute inset-0 rounded-full border-2 border-orange-500" style={ringStyle} />
      {SPARKS.map((spark, index) => (
        <Spark key={index} progress={progress} {...spark} />
      ))}
    </View>
  );
}
