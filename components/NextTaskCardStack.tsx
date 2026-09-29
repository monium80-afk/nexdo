import { Feather } from "@expo/vector-icons";
import { memo, useCallback, useEffect, useState } from "react";
import { Platform, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    cancelAnimation,
    Extrapolation,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    useReducedMotion,
    withSpring,
    withTiming,
    type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { NextTaskCard, type CardBounds } from "@/components/NextTaskCard";
import { MOTION } from "@/constants/theme";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import type { Task } from "@/types/task";

// px-6 at this app's 14dp rem — lines the stack up with the header and the
// Previous/Next buttons.
const SIDE_PADDING = 21;
const CARD_RADIUS = 24;
const FLY_OUT_MS = MOTION.duration.standard;
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
const DEPTH_SCALE = [1, 0.93, 0.86];
// How far each place's bottom edge shows below the active card. At rest only
// the card straight behind shows: a slim band under the active one.
const DEPTH_PEEK = [0, 10, 20];
// The third card is invisible at rest and fades in as it moves up the stack,
// so nothing pops into view behind the card that just landed.
const DEPTH_OPACITY = [1, 1, 0];
// A waiting card sits under a veil of the page colour rather than being made
// see-through, so its band reads as a card set further back — not as a grey
// shadow — and clears as that card comes forward.
const DEPTH_VEIL = [0, 0.2, 0.2];

// iOS only, deliberately. Android draws an elevation shadow as a hard grey
// rectangle once the view it belongs to is partly transparent — and cards fade
// as they move through the stack, so the shadow showed as a box behind them
// and greyed their inside through it. The band of the card behind carries the
// depth on Android instead.
const CARD_SHADOW = Platform.select({
  ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.18, shadowRadius: 24 },
});

const styles = StyleSheet.create({
  stack: { marginTop: 14, marginHorizontal: SIDE_PADDING },
  // The shadow sits out here rather than on the card: the card clips itself to
  // the height the stack gives it, and a clipping view cuts off its own shadow.
  card: { borderRadius: CARD_RADIUS },
  // Every card but the active one. The active one stays in flow so the block
  // keeps its height — and grows and shrinks with it as the cards change over.
  waiting: { position: "absolute", top: 0, left: 0, right: 0 },
  veil: { ...StyleSheet.absoluteFill, borderRadius: CARD_RADIUS },
});

/** Which place a mounted card holds right now: 0 is active, -1 is out on the left. */
function depthOf(slot: number, activeSlot: number) {
  "worklet";
  return ((slot - activeSlot + SLOT_COUNT + 1) % SLOT_COUNT) - 1;
}

/**
 * How far a card is from the active spot at this instant: 0 sits in it, 1 is
 * one step behind it, below 0 it has passed it and is out on the left.
 */
function liveDepth(place: number, dragX: number, track: number) {
  "worklet";
  // The stack moves one place at most, however much further the card that is
  // leaving still has to travel to clear the screen.
  return place + Math.min(Math.max(dragX / track, -1), 1);
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
  onBoundsChange,
  onStart,
  onDetails,
  hidden,
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
  onBoundsChange?: (taskId: string, bounds: CardBounds) => void;
  onStart: (task: Task, plannedMinutes: number, bounds?: CardBounds) => void;
  onDetails: (taskId: string) => void;
  hidden: boolean;
}) {
  const colors = useColors();
  const placeStyle = useAnimatedStyle(() => {
    const place = depthOf(slot, activeSlot.get());
    const depth = liveDepth(place, dragX.get(), track);
    // Out on the left a card follows the finger one to one; behind the active
    // spot it eases back through the stack instead, straight down under it.
    const translateX = depth < 0 ? place * track + dragX.get() : 0;
    // Only a card on its way out tilts, exactly as far as it has travelled.
    const tilt = dragX.get() < 0 ? interpolate(translateX, [-width, 0], [-TILT_DEG, 0], Extrapolation.CLAMP) : 0;
    const scale = interpolate(depth, DEPTHS, DEPTH_SCALE, Extrapolation.CLAMP);
    // Scaled about its centre, a card's bottom edge rises by half the height it
    // lost. Dropping it back by that much lines it up with the active card's
    // bottom edge, and the peek then sets it just below.
    const translateY =
      (stackHeight.get() * (1 - scale)) / 2 + interpolate(depth, DEPTHS, DEPTH_PEEK, Extrapolation.CLAMP);

    return {
      opacity: hidden ? 0 : interpolate(depth, DEPTHS, DEPTH_OPACITY, Extrapolation.CLAMP),
      transform: [{ translateX }, { translateY }, { rotate: `${tilt}deg` }, { scale }],
    };
  });

  const veilStyle = useAnimatedStyle(() => {
    const depth = liveDepth(depthOf(slot, activeSlot.get()), dragX.get(), track);
    return { opacity: interpolate(depth, DEPTHS, DEPTH_VEIL, Extrapolation.CLAMP) };
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
      pointerEvents={hidden ? "none" : "auto"}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      style={[styles.card, { backgroundColor: colors.charcoal[900] }, active ? null : styles.waiting, CARD_SHADOW, placeStyle]}
    >
      <NextTaskCard
        task={task}
        rank={rank}
        preview={!active}
        style={heightStyle}
        onMeasure={(height) => onMeasure(slot, height)}
        onBoundsChange={(bounds) => onBoundsChange?.(task.id, bounds)}
        onStart={(plannedMinutes, bounds) => onStart(task, plannedMinutes, bounds)}
        onDetails={() => onDetails(task.id)}
      />
      <Animated.View pointerEvents="none" style={[styles.veil, { backgroundColor: colors.cream[100] }, veilStyle]} />
    </Animated.View>
  );
}

const MemoizedStackSlot = memo(StackSlot);

export function NextTaskCardStack({
  tasks,
  currentIndex,
  onIndexChange,
  onStart,
  onDetails,
  focusTaskId,
  onFocusBoundsChange,
}: {
  tasks: Task[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
  onStart: (task: Task, plannedMinutes: number, bounds?: CardBounds) => void;
  onDetails: (taskId: string) => void;
  focusTaskId?: string;
  onFocusBoundsChange?: (taskId: string, bounds: CardBounds) => void;
}) {
  const t = useTranslation();
  const colors = useColors();
  const reduceMotion = useReducedMotion();
  const { width } = useWindowDimensions();
  const total = tasks.length;
  // One full step of the stack: far enough for a card to clear the screen.
  const track = width - SIDE_PADDING;
  const flyOutDistance = width * 1.4;
  const swipeThreshold = width * 0.25;

  const dragX = useSharedValue(0);
  const activeSlot = useSharedValue(0);
  // Card sizes stay fixed while the finger moves; the stack only animates its
  // height after release, avoiding per-frame relayout of every card's content.
  const heights = useSharedValue(Array.from({ length: SLOT_COUNT }, () => 0));
  const stackHeight = useSharedValue(0);
  const swipeLocked = useSharedValue(false);
  const [activeSlotIndex, setActiveSlotIndex] = useState(0);
  useEffect(() => {
    swipeLocked.set(false);
  }, [currentIndex, swipeLocked]);

  const commit = (step: 1 | -1, nextIndex: number) => {
    setActiveSlotIndex((slot) => (slot + step + SLOT_COUNT) % SLOT_COUNT);
    onIndexChange(nextIndex);
  };

  const settle = (step: 1 | -1, nextIndex: number) => {
    "worklet";
    // Both of these describe the very same picture — the card that was one step
    // behind now being the active one, at rest — so they have to land in the
    // same frame, on the UI thread. Handing the step to React first would show
    // one frame of the following card in the spot the landing card is in.
    const nextSlot = (activeSlot.get() + step + SLOT_COUNT) % SLOT_COUNT;
    activeSlot.set(nextSlot);
    const nextHeight = heights.get()[nextSlot];
    if (nextHeight > 0) {
      stackHeight.set(withTiming(nextHeight, { duration: MOTION.duration.standard, easing: MOTION.easing.standard }));
    }
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
    if (swipeLocked.get()) return;
    swipeLocked.set(true);
    const nextIndex = (currentIndex + step + total) % total;
    dragX.set(
      withTiming(flyOutTo(step), { duration: reduceMotion ? 0 : FLY_OUT_MS }, (finished) => {
        if (finished) settle(step, nextIndex);
      }),
    );
  };

  const pan = Gesture.Pan()
    .enabled(total > 1)
    .activeOffsetX([-12, 12])
    .failOffsetY([-12, 12])
    .onBegin(() => {
      if (!swipeLocked.get()) cancelAnimation(dragX);
    })
    .onUpdate((event) => {
      if (swipeLocked.get()) return;
      dragX.set(event.translationX);
    })
    .onEnd((event) => {
      if (swipeLocked.get()) return;
      const flung = Math.abs(event.translationX) > swipeThreshold || Math.abs(event.velocityX) > FLING_VELOCITY;
      if (!flung) {
        dragX.set(reduceMotion ? withTiming(0, { duration: 0 }) : withSpring(0, MOTION.spring.gesture));
        return;
      }
      const step = event.translationX < 0 ? 1 : -1;
      const nextIndex = (currentIndex + step + total) % total;
      swipeLocked.set(true);
      dragX.set(
        withTiming(flyOutTo(step), { duration: reduceMotion ? 0 : FLY_OUT_MS }, (finished) => {
          if (finished) settle(step, nextIndex);
        }),
      );
    });

  const handleMeasure = useCallback((slot: number, height: number) => {
    const measured = heights.get();
    if (measured[slot] === height) return;
    const next = [...measured];
    next[slot] = height;
    heights.set(next);
    if (slot === activeSlot.get()) {
      stackHeight.set(
        stackHeight.get() === 0
          ? height
          : withTiming(height, { duration: MOTION.duration.standard, easing: MOTION.easing.standard }),
      );
    }
  }, [activeSlot, heights, stackHeight]);

  // One task left: nothing to swipe between, so the stack stays out of the way.
  if (total <= 1) {
    const only = tasks[0];
    if (!only) return null;
    return (
      <View
        pointerEvents={focusTaskId === only.id ? "none" : "auto"}
        style={[
          styles.stack,
          styles.card,
          { backgroundColor: colors.charcoal[900], opacity: focusTaskId === only.id ? 0 : 1 },
          CARD_SHADOW,
        ]}
      >
        <NextTaskCard
          task={only}
          rank={1}
          onBoundsChange={(bounds) => onFocusBoundsChange?.(only.id, bounds)}
          onStart={(plannedMinutes, bounds) => onStart(only, plannedMinutes, bounds)}
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
            <MemoizedStackSlot
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
              onBoundsChange={onFocusBoundsChange}
              onStart={onStart}
              onDetails={onDetails}
              hidden={task.id === focusTaskId}
            />
          ))}
        </View>
      </GestureDetector>

      {/* 30 = the card behind's 10dp peek + 20 of air. Same size and corner
          for both; Next is the solid one because it's the way forward. */}
      <View className="mt-[30px] flex-row items-center gap-3 px-6">
        <AnimatedPressable
          onPress={() => fling(-1)}
          accessibilityRole="button"
          className="min-h-[44px] flex-1 flex-row items-center justify-center gap-2 rounded-[14px] bg-cream-50 hairline-cream px-3"
        >
          <Feather name="arrow-left" size={16} color={colors.ink.cream} />
          <Text className="font-grotesk-semibold text-[14px] text-ink-cream">{t.next.previous}</Text>
        </AnimatedPressable>
        <AnimatedPressable
          onPress={() => fling(1)}
          accessibilityRole="button"
          className="min-h-[44px] flex-1 flex-row items-center justify-center gap-2 rounded-[14px] bg-charcoal-900 hairline-charcoal px-3"
        >
          <Text className="font-grotesk-semibold text-[14px] text-ink-charcoal">{t.next.nextCard}</Text>
          <Feather name="arrow-right" size={16} color={colors.ink.charcoal} />
        </AnimatedPressable>
      </View>
    </>
  );
}
