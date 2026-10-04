import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
    cancelAnimation,
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
    type SharedValue,
} from "react-native-reanimated";

// Taller in the middle, shorter at the edges: the classic sound-wave shape.
const BAR_WEIGHTS = [0.45, 0.7, 0.9, 1, 0.9, 0.7, 0.45];
const BAR_WIDTH = 3;
const BAR_GAP = 3;
const MIN_HEIGHT = 4;
const MAX_HEIGHT = 26;

/** How wide the waves are, for a parent that animates room for them. */
export const SOUND_WAVES_WIDTH = BAR_WEIGHTS.length * BAR_WIDTH + (BAR_WEIGHTS.length - 1) * BAR_GAP;

function WaveBar({ level, phase, weight, offset, color }: {
  level: SharedValue<number>;
  phase: SharedValue<number>;
  weight: number;
  offset: number;
  color: string;
}) {
  const style = useAnimatedStyle(() => {
    // Each bar rides its own point on a travelling sine, so the bars ripple
    // rather than all jumping together. Silence flattens them to dots.
    const ripple = 0.6 + 0.4 * Math.sin(phase.value * 2 * Math.PI - offset);
    return { height: MIN_HEIGHT + (MAX_HEIGHT - MIN_HEIGHT) * level.value * weight * ripple };
  });
  return <Animated.View style={[{ width: BAR_WIDTH, borderRadius: BAR_WIDTH / 2, backgroundColor: color }, style]} />;
}

/**
 * Bars that move with the microphone's loudness (0–1, from useLiveVoice) —
 * the "I can hear you" signal on the Live voice stop button.
 */
export function SoundWaves({ level, color }: { level: SharedValue<number>; color: string }) {
  const phase = useSharedValue(0);
  useEffect(() => {
    phase.value = withRepeat(withTiming(1, { duration: 1000, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(phase);
  }, [phase]);

  return (
    <View className="flex-row items-center" style={{ width: SOUND_WAVES_WIDTH, height: MAX_HEIGHT, gap: BAR_GAP }}>
      {BAR_WEIGHTS.map((weight, index) => (
        <WaveBar key={index} level={level} phase={phase} weight={weight} offset={index * 0.9} color={color} />
      ))}
    </View>
  );
}
