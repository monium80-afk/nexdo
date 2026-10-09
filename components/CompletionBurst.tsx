import { View } from "react-native";
import Animated, { Extrapolation, interpolate, useAnimatedStyle, type SharedValue } from "react-native-reanimated";

import { colors } from "@/constants/theme";

// Sparks are short streaks pointing the way they fly, leaving from just
// inside the checkbox's edge (so they appear from behind it) and reaching
// out to two alternating distances — a crisp firework rather than a puff.
const SPARK_START = 10;
const SPARK_COUNT = 12;
const SPARKS = Array.from({ length: SPARK_COUNT }, (_, index) => ({
  angle: (index / SPARK_COUNT) * 2 * Math.PI + Math.PI / SPARK_COUNT,
  reach: index % 2 === 0 ? 31 : 23,
  length: index % 2 === 0 ? 9 : 6,
  color: [colors.orange[500], colors.amber[500], colors.orange[400]][index % 3],
}));

type SparkProps = (typeof SPARKS)[number] & { progress: SharedValue<number> };

function Spark({ progress, angle, reach, length, color }: SparkProps) {
  const style = useAnimatedStyle(() => {
    const distance = interpolate(progress.value, [0, 1], [SPARK_START, reach]);
    return {
      opacity: interpolate(progress.value, [0, 0.04, 0.5, 0.85], [0, 1, 1, 0], Extrapolation.CLAMP),
      transform: [
        { translateX: Math.cos(angle) * distance },
        { translateY: Math.sin(angle) * distance },
        { rotate: `${angle}rad` },
        // Long as it leaves, shrinking to a dot as it runs out.
        { scaleX: interpolate(progress.value, [0, 0.3, 1], [0.4, 1, 0.2], Extrapolation.CLAMP) },
      ],
    };
  });

  return (
    <Animated.View
      className="absolute rounded-full"
      style={[{ left: 11 - length / 2, top: 11 - 1.25, width: length, height: 2.5, backgroundColor: color }, style]}
    />
  );
}

/**
 * The send-off when a task is ticked: a soft flash behind the box, a crisp
 * orange ring and a spray of streaking sparks bursting out of a 22px
 * checkbox. Place it over the checkbox, before it, so the checkbox draws on
 * top. `progress` plays it from 0 to 1; it is invisible at both ends, so it
 * can stay mounted.
 */
export function CompletionBurst({ progress }: { progress: SharedValue<number> }) {
  const flashStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.06, 0.45], [0, 0.55, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(progress.value, [0, 0.45], [0.6, 2], Extrapolation.CLAMP) }],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.05, 0.65], [0, 0.9, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.8, 2.6]) }],
  }));

  return (
    <View className="pointer-events-none absolute left-0 top-0 h-[22px] w-[22px]">
      <Animated.View className="absolute inset-0 rounded-full bg-orange-200" style={flashStyle} />
      <Animated.View className="absolute inset-0 rounded-full border-2 border-orange-500" style={ringStyle} />
      {SPARKS.map((spark, index) => (
        <Spark key={index} progress={progress} {...spark} />
      ))}
    </View>
  );
}
