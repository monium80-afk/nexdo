import { Feather } from "@expo/vector-icons";
import { useLayoutEffect } from "react";
import { Text, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    Extrapolation,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { NextTaskCard } from "@/components/NextTaskCard";
import { colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/useTranslation";
import type { Task } from "@/types/task";

const SIDE_PADDING = 24;
const BACK_CARD_SCALE = 0.94;
const BACK_CARD_OFFSET = 18;
const UNDER_CARD_OPACITY = 0.5;
const FLY_OUT_MS = 220;

export function NextTaskCardStack({
  currentTask,
  nextTask,
  previousTask,
  currentIndex,
  total,
  onIndexChange,
  onStart,
  onDetails,
}: {
  currentTask: Task;
  nextTask?: Task;
  previousTask?: Task;
  currentIndex: number;
  total: number;
  onIndexChange: (index: number) => void;
  onStart: (task: Task, plannedMinutes: number) => void;
  onDetails: (taskId: string) => void;
}) {
  const t = useTranslation();
  const { width } = useWindowDimensions();
  const dragX = useSharedValue(0);
  const swipeThreshold = width * 0.25;
  const flyOutDistance = width * 1.4;
  const returnDistance = width - SIDE_PADDING;
  const trackDistance = width * 0.6;
  const hasPrevious = Boolean(previousTask);
  const hasNext = Boolean(nextTask);

  const goTo = (step: 1 | -1) => {
    onIndexChange(Math.min(Math.max(currentIndex + step, 0), total - 1));
  };

  useLayoutEffect(() => {
    dragX.set(0);
  }, [currentIndex, currentTask.id, dragX]);

  const swipe = (direction: "next" | "previous") => {
    if (direction === "next" ? !hasNext : !hasPrevious) return;
    dragX.set(
      withTiming(direction === "next" ? -flyOutDistance : returnDistance, { duration: FLY_OUT_MS }, (finished) => {
        if (finished) scheduleOnRN(goTo, direction === "next" ? 1 : -1);
      }),
    );
  };

  const pan = Gesture.Pan()
    .enabled(total > 1)
    .activeOffsetX([-12, 12])
    .failOffsetY([-12, 12])
    .onUpdate((event) => {
      if (event.translationX > 0 && !hasPrevious) return;
      if (event.translationX < 0 && !hasNext) return;
      dragX.set(event.translationX);
    })
    .onEnd((event) => {
      const toLeft = event.translationX < 0;
      const flung = Math.abs(event.translationX) > swipeThreshold || Math.abs(event.velocityX) > 800;
      if (!flung || (toLeft && !hasNext) || (!toLeft && !hasPrevious)) {
        dragX.set(withSpring(0, { damping: 18, stiffness: 180 }));
        return;
      }
      dragX.set(
        withTiming(toLeft ? -flyOutDistance : returnDistance, { duration: FLY_OUT_MS }, (finished) => {
          if (finished) scheduleOnRN(goTo, toLeft ? 1 : -1);
        }),
      );
    });

  const topCardStyle = useAnimatedStyle(() => {
    const drag = dragX.value;
    const returning = Math.min(Math.max(drag, 0) / trackDistance, 1);
    return {
      opacity: interpolate(returning, [0, 1], [1, UNDER_CARD_OPACITY]),
      transform: [
        { translateX: drag < 0 ? drag : interpolate(returning, [0, 1], [0, BACK_CARD_OFFSET]) },
        { rotate: `${drag < 0 ? interpolate(drag, [-width, 0], [-8, 0], Extrapolation.CLAMP) : 0}deg` },
        { scale: interpolate(returning, [0, 1], [1, BACK_CARD_SCALE]) },
      ],
    };
  });

  const underCardStyle = useAnimatedStyle(() => {
    const drag = dragX.value;
    const leaving = Math.min(Math.max(-drag, 0) / trackDistance, 1);
    const returning = Math.min(Math.max(drag, 0) / trackDistance, 1);
    return {
      opacity: interpolate(leaving, [0, 1], [UNDER_CARD_OPACITY, 1]) * (1 - returning),
      transform: [
        { translateX: interpolate(leaving, [0, 1], [BACK_CARD_OFFSET, 0]) },
        { scale: interpolate(leaving, [0, 1], [BACK_CARD_SCALE, 1]) },
      ],
    };
  });

  const returningCardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: Math.min(dragX.value - returnDistance, 0) }],
  }));

  return (
    <>
      <View style={{ marginTop: 28, marginHorizontal: SIDE_PADDING }}>
        {nextTask ? (
          <Animated.View
            pointerEvents="none"
            style={[{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }, underCardStyle]}
          >
            <NextTaskCard task={nextTask} rank={currentIndex + 2} preview onStart={() => {}} onDetails={() => {}} />
          </Animated.View>
        ) : null}

        <GestureDetector gesture={pan}>
          <Animated.View style={topCardStyle}>
            <NextTaskCard
              task={currentTask}
              rank={currentIndex + 1}
              onStart={(plannedMinutes) => onStart(currentTask, plannedMinutes)}
              onDetails={() => onDetails(currentTask.id)}
            />
          </Animated.View>
        </GestureDetector>

        {previousTask ? (
          <Animated.View
            pointerEvents="none"
            style={[{ position: "absolute", top: 0, right: 0, left: 0 }, returningCardStyle]}
          >
            <NextTaskCard task={previousTask} rank={currentIndex} onStart={() => {}} onDetails={() => {}} />
          </Animated.View>
        ) : null}
      </View>

      {total > 1 ? (
        <View className="mt-8 flex-row items-center gap-3 px-6">
          <AnimatedPressable
            onPress={() => swipe("previous")}
            disabled={!hasPrevious}
            accessibilityRole="button"
            accessibilityState={{ disabled: !hasPrevious }}
            className="flex-1 flex-row items-center justify-center gap-2 rounded-full border border-cream-300 bg-cream-50 py-3.5"
            style={hasPrevious ? undefined : { opacity: 0.4 }}
          >
            <Feather name="arrow-left" size={17} color={colors.ink.cream} />
            <Text className="font-grotesk-bold text-base text-ink-cream">{t.next.previous}</Text>
          </AnimatedPressable>
          <AnimatedPressable
            onPress={() => swipe("next")}
            disabled={!hasNext}
            accessibilityRole="button"
            accessibilityState={{ disabled: !hasNext }}
            className="flex-1 flex-row items-center justify-center gap-2 rounded-full bg-charcoal-900 py-3.5"
            style={hasNext ? undefined : { opacity: 0.4 }}
          >
            <Text className="font-grotesk-bold text-base text-ink-charcoal">{t.next.nextCard}</Text>
            <Feather name="arrow-right" size={17} color={colors.ink.charcoal} />
          </AnimatedPressable>
        </View>
      ) : null}
    </>
  );
}