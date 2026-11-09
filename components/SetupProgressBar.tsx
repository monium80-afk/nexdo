import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import Animated, {
  Easing,
  makeMutable,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";

import { gradients } from "@/constants/theme";

type SetupProgressBarProps = {
  percent: number;
};

const DURATION = 700;

// The inset shadow of card--cream-inset, for a track too thin to take its border.
const TRACK_INSET = { boxShadow: "inset 0 1px 2px rgba(92, 58, 26, 0.12)" };

/**
 * How full the bar is right now — for the whole setup run, not for one screen.
 * Each screen mounts its own bar, so a value living inside one of them starts
 * over on every screen; and a module-level record of the last *target* is worse
 * still, because a screen you walk back to never re-animates, so the record and
 * what is actually on screen drift apart. Only one bar is ever visible, so one
 * live value is all this needs.
 */
const fill = makeMutable(0);

export function SetupProgressBar({ percent }: SetupProgressBarProps) {
  // The number counts along with the bar rather than snapping to its new value
  // the moment the screen changes.
  const [shown, setShown] = useState(() => Math.round(fill.value));

  // On focus, not on mount: coming back to an earlier step has to pull the bar
  // back down to that step's value. Without it the bar keeps the later value,
  // and moving forward again has nothing left to animate — which is why it
  // sometimes filled smoothly and sometimes just snapped.
  useFocusEffect(
    useCallback(() => {
      fill.value = withTiming(percent, { duration: DURATION, easing: Easing.out(Easing.cubic) });
    }, [percent]),
  );

  useAnimatedReaction(
    () => Math.round(fill.value),
    (current, previous) => {
      if (current !== previous) runOnJS(setShown)(current);
    },
  );

  // scaleX, not width: width is a layout property, so animating it reruns
  // layout every frame and stutters whenever the JS thread is busy — which is
  // exactly when a screen is being pushed. A transform stays on the UI thread.
  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: fill.value / 100 }],
  }));

  return (
    <View className="flex-row items-center pt-2">
      {/* The track clips the fill, so the fill can scale as a plain rectangle
          and still read as a pill. */}
      {/* Pressed into the page, with the lit orange of the app's buttons
          filling it. */}
      <View className="mr-4 h-2 flex-1 overflow-hidden rounded-full bg-cream-200" style={TRACK_INSET}>
        <Animated.View
          className="h-full w-full rounded-full bg-orange-500"
          style={[{ transformOrigin: "left" }, gradients.accent, fillStyle]}
        />
      </View>
      {/* Fixed width, right-aligned: "0%" and "100%" are different widths, so a
          label that sized itself would drag the track's end sideways every time
          the counter gained a digit. */}
      <Text className="eyebrow w-[38px] text-right text-ink-cream-muted">{shown}%</Text>
    </View>
  );
}
