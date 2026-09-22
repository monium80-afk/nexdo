import { Feather } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    Extrapolation,
    interpolate,
    useAnimatedStyle,
    useDerivedValue,
    useSharedValue,
    withSpring,
    withTiming,
    type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { NextTaskCard } from "@/components/NextTaskCard";
import { colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/useTranslation";
import type { Task } from "@/types/task";

const SIDE_PADDING = 24;
const CARD_RADIUS = 28;
const FLY_OUT_MS = 220;
const FLING_VELOCITY = 800;
const TILT_DEG = 8;

/**
 * The stack keeps four cards mounted at once — one per place in it — and a
 * swipe only rotates which place each one holds. No mounted card ever swaps
 * the task it shows while that card is on screen, which is what makes the
 * hand-over invisible: the moment the stack steps on, every visible card is
 * already showing what it should show afterwards, so nothing flickers.
 */
const SLOT_COUNT = 4;
/** Place 0 is the active card, 1 and 2 wait behind it, -1 is out on the left. */
const DEPTHS = [0, 1, 2];
const DEPTH_OFFSET = [0, 18, 36];
const DEPTH_SCALE = [1, 0.94, 0.88];
// The third card is invisible at rest and fades in as it moves up the stack,
// so nothing pops into view behind the card that just landed.
const DEPTH_OPACITY = [1, 0.5, 0];

// iOS only, deliberately. Android draws an elevation shadow as a hard grey
// rectangle once the view it belongs to is partly transparent — and cards fade
// as they move through the stack, so the shadow showed as a box behind them
// and greyed their inside through it. The card's hairline border carries the
// depth on Android instead.
const CARD_SHADOW = Platform.select({
  ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 18 }, shadowOpacity: 0.28, shadowRadius: 28 },
});

const styles = StyleSheet.create({
  stack: { marginTop: 28, marginHorizontal: SIDE_PADDING },
  // The shadow sits out here rather than on the card: the card clips itself to
  // the height the stack gives it, and a clipping view cuts off its own shadow.
  card: { borderRadius: CARD_RADIUS, backgroundColor: colors.charcoal[900] },
  // Every card but the active one. The active one stays in flow so the block
  // keeps its height — and grows and shrinks with it as the cards change over.
  waiting: { position: "absolute", top: 0, left: 0, right: 0 },
});

/** Which place a mounted card holds right now: 0 is active, -1 is out on the left. */
function depthOf(slot: number, activeSlot: number) {
  "worklet";
  return ((slot - activeSlot + SLOT_COUNT + 1) % SLOT_COUNT) - 1;
}

function StackSlot({
  slot,
  task,
  rank,
  active,
  activeSlot,
  dragX,
  stackHeight,
  track,
  width,
  onMeasure,
  onStart,
  onDetails,
}: {
  slot: number;
  task: Task;
  rank: number;
  active: boolean;
  activeSlot: SharedValue<number>;
  dragX: SharedValue<number>;
  stackHeight: SharedValue<number>;
  track: number;
  width: number;
  onMeasure: (slot: number, height: number) => void;
  onStart: (task: Task, plannedMinutes: number) => void;
  onDetails: (taskId: string) => void;
}) {
  const placeStyle = useAnimatedStyle(() => {
    const place = depthOf(slot, activeSlot.get());
    // The stack moves one place at most, however much further the card that is
    // leaving still has to travel to clear the screen.
    const step = Math.min(Math.max(dragX.get() / track, -1), 1);
    // How far this card is from the active spot right now: 0 sits in it, 1 is
    // one step behind it, below 0 it has passed it and is out on the left.
    const depth = place + step;
    // Out on the left a card follows the finger one to one; behind the active
    // spot it eases back through the stack instead.
    const translateX =
      depth < 0 ? place * track + dragX.get() : interpolate(depth, DEPTHS, DEPTH_OFFSET, Extrapolation.CLAMP);
    // Only a card on its way out tilts, exactly as far as it has travelled.
    const tilt = dragX.get() < 0 ? interpolate(translateX, [-width, 0], [-TILT_DEG, 0], Extrapolation.CLAMP) : 0;

    return {
      opacity: interpolate(depth, DEPTHS, DEPTH_OPACITY, Extrapolation.CLAMP),
      transform: [
        { translateX },
        { rotate: `${tilt}deg` },
        { scale: interpolate(depth, DEPTHS, DEPTH_SCALE, Extrapolation.CLAMP) },
      ],
    };
  });

  // Every card is as tall as the stack is at this instant, so a longer card
  // grows into place on its way forward instead of snapping when it lands.
  // Until the first card has measured itself the stack has no height of its
  // own, and the cards simply take the one their content asks for.
  const heightStyle = useAnimatedStyle(() => {
    const height = stackHeight.get();
    return { height: height > 0 ? height : "auto" };
  });

  return (
    <Animated.View
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      style={[styles.card, active ? null : styles.waiting, CARD_SHADOW, placeStyle]}
    >
      <NextTaskCard
        task={task}
        rank={rank}
        preview={!active}
        style={heightStyle}
        onMeasure={(height) => onMeasure(slot, height)}
        onStart={(plannedMinutes) => onStart(task, plannedMinutes)}
        onDetails={() => onDetails(task.id)}
      />
    </Animated.View>
  );
}

export function NextTaskCardStack({
  tasks,
  currentIndex,
  onIndexChange,
  onStart,
  onDetails,
}: {
  tasks: Task[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
  onStart: (task: Task, plannedMinutes: number) => void;
  onDetails: (taskId: string) => void;
}) {
  const t = useTranslation();
  const { width } = useWindowDimensions();
  const total = tasks.length;
  // One full step of the stack: far enough for a card to clear the screen.
  const track = width - SIDE_PADDING;
  const flyOutDistance = width * 1.4;
  const swipeThreshold = width * 0.25;

  const dragX = useSharedValue(0);
  const activeSlot = useSharedValue(0);
  // What each mounted card's content asks for, kept in one shared value so the
  // stack's height can be worked out on the UI thread as the cards move.
  const heights = useSharedValue(Array.from({ length: SLOT_COUNT }, () => 0));
  const [activeSlotIndex, setActiveSlotIndex] = useState(0);
  const [commitVersion, setCommitVersion] = useState(0);
  const latestCurrentIndex = useRef(currentIndex);
  const flingInFlight = useRef(false);
  useEffect(() => {
    latestCurrentIndex.current = currentIndex;
    flingInFlight.current = false;
  }, [commitVersion, currentIndex]);

  const stackHeight = useDerivedValue(() => {
    const measured = heights.get();
    const current = measured[activeSlot.get()];
    if (!current) return 0;
    const progress = Math.min(Math.max(-dragX.get() / track, -1), 1);
    // Whichever card the swipe is pulling into the active spot: the next one
    // behind when swiping left, the one out on the left when swiping right.
    const incoming = measured[(activeSlot.get() + (progress < 0 ? SLOT_COUNT - 1 : 1)) % SLOT_COUNT];
    if (!incoming) return current;
    return current + (incoming - current) * Math.abs(progress);
  });

  const commit = (step: 1 | -1, nextIndex: number) => {
    setActiveSlotIndex((slot) => (slot + step + SLOT_COUNT) % SLOT_COUNT);
    onIndexChange(nextIndex);
    setCommitVersion((version) => version + 1);
  };

  const settle = (step: 1 | -1, nextIndex: number) => {
    "worklet";
    // Both of these describe the very same picture — the card that was one step
    // behind now being the active one, at rest — so they have to land in the
    // same frame, on the UI thread. Handing the step to React first would show
    // one frame of the following card in the spot the landing card is in.
    activeSlot.set((activeSlot.get() + step + SLOT_COUNT) % SLOT_COUNT);
    dragX.set(0);
    scheduleOnRN(commit, step, nextIndex);
  };

  // Where the leaving card is sent: right off the screen on its way out, or
  // back to the spot the previous card waits in on the left.
  const flyOutTo = (step: 1 | -1) => {
    "worklet";
    return step === 1 ? -flyOutDistance : track;
  };

  // The buttons take exactly the step a swipe does. The animation is written
  // out again in the gesture below rather than shared: the callback that lands
  // the step has to be a worklet, and it is the call site that makes it one.
  const fling = (step: 1 | -1) => {
    if (flingInFlight.current) return;
    flingInFlight.current = true;
    const nextIndex = (latestCurrentIndex.current + step + total) % total;
    dragX.set(
      withTiming(flyOutTo(step), { duration: FLY_OUT_MS }, (finished) => {
        if (finished) settle(step, nextIndex);
      }),
    );
  };

  const pan = Gesture.Pan()
    .enabled(total > 1)
    .activeOffsetX([-12, 12])
    .failOffsetY([-12, 12])
    .onUpdate((event) => {
      dragX.set(event.translationX);
    })
    .onEnd((event) => {
      const flung = Math.abs(event.translationX) > swipeThreshold || Math.abs(event.velocityX) > FLING_VELOCITY;
      if (!flung) {
        dragX.set(withSpring(0, { damping: 18, stiffness: 180 }));
        return;
      }
      const step = event.translationX < 0 ? 1 : -1;
      const nextIndex = (currentIndex + step + total) % total;
      dragX.set(
        withTiming(flyOutTo(step), { duration: FLY_OUT_MS }, (finished) => {
          if (finished) settle(step, nextIndex);
        }),
      );
    });

  const handleMeasure = (slot: number, height: number) => {
    const measured = heights.get();
    if (measured[slot] === height) return;
    const next = [...measured];
    next[slot] = height;
    heights.set(next);
  };

  // One task left: nothing to swipe between, so the stack stays out of the way.
  if (total <= 1) {
    const only = tasks[0];
    if (!only) return null;
    return (
      <View style={[styles.stack, styles.card, CARD_SHADOW]}>
        <NextTaskCard
          task={only}
          rank={1}
          onStart={(plannedMinutes) => onStart(only, plannedMinutes)}
          onDetails={() => onDetails(only.id)}
        />
      </View>
    );
  }

  const slots = Array.from({ length: SLOT_COUNT }, (_, slot) => {
    const depth = depthOf(slot, activeSlotIndex);
    const index = (((currentIndex + depth) % total) + total) % total;
    return { slot, depth, task: tasks[index], rank: index + 1 };
  })
    // Deepest first, so the card coming back in from the left covers the stack.
    .sort((a, b) => b.depth - a.depth);

  return (
    <>
      <GestureDetector gesture={pan}>
        <View style={styles.stack}>
          {slots.map(({ slot, depth, task, rank }) => (
            <StackSlot
              key={slot}
              slot={slot}
              task={task}
              rank={rank}
              active={depth === 0}
              activeSlot={activeSlot}
              dragX={dragX}
              stackHeight={stackHeight}
              track={track}
              width={width}
              onMeasure={handleMeasure}
              onStart={onStart}
              onDetails={onDetails}
            />
          ))}
        </View>
      </GestureDetector>

      <View className="mt-8 flex-row items-center gap-3 px-6">
        <AnimatedPressable
          onPress={() => fling(-1)}
          accessibilityRole="button"
          className="flex-1 flex-row items-center justify-center gap-2 rounded-full border border-cream-300 bg-cream-50 py-3.5"
        >
          <Feather name="arrow-left" size={17} color={colors.ink.cream} />
          <Text className="font-grotesk-bold text-base text-ink-cream">{t.next.previous}</Text>
        </AnimatedPressable>
        <AnimatedPressable
          onPress={() => fling(1)}
          accessibilityRole="button"
          className="flex-1 flex-row items-center justify-center gap-2 rounded-full bg-charcoal-900 py-3.5"
        >
          <Text className="font-grotesk-bold text-base text-ink-charcoal">{t.next.nextCard}</Text>
          <Feather name="arrow-right" size={17} color={colors.ink.charcoal} />
        </AnimatedPressable>
      </View>
    </>
  );
}
