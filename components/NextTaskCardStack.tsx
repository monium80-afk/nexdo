import { Feather } from "@expo/vector-icons";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    cancelAnimation,
    Easing,
    Extrapolation,
    interpolate,
    useAnimatedReaction,
    useAnimatedStyle,
    useDerivedValue,
    useSharedValue,
    useReducedMotion,
    withDelay,
    withSpring,
    withTiming,
    type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { CELEBRATION_MS, NextTaskCard, type CardBounds } from "@/components/NextTaskCard";
import { MOTION } from "@/constants/theme";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { useTaskStore } from "@/store/useTaskStore";
import type { Task } from "@/types/task";

// px-6 at this app's 14dp rem — lines the stack up with the header and the
// Previous/Next buttons.
const SIDE_PADDING = 21;
const CARD_RADIUS = 28;
const FLING_VELOCITY = 800;

// The deck shuffle (after Lightswind's Sliding Cards): the top card swings out
// to the side turning in 3D, turns back the other way, and tucks in behind the
// deck while the next card comes forward. TUCK_MS is the whole move; the
// card behind is already in front after RISE_MS.
const TUCK_MS = 560;
const RISE_MS = 320;
// The move's three beats, as fractions of TUCK_MS: out, turn, back in behind.
const OUT_END = 0.34;
const TURN_END = 0.58;
/** How far out to the side it swings, in card widths. */
const OUT_WIDTHS = 0.82;
const TURN_DEG = 24;
const PERSPECTIVE = 1000;
// While dragged, the card turns with the finger and fades a little.
const DRAG_TURN_PER_DP = 0.16;
const DRAG_FADE = 0.3;
/** How far the card behind rises while the top one is only being dragged. */
const PREVIEW_RISE = 0.3;
// Drawing order: the card being thrown goes over everything, until it turns
// to go behind; then the deck in place order.
const Z_THROWN = 40;
const Z_BACK = 0;

// A waiting card is a plain card — its text and buttons showing in the band
// under the top card only looked broken. Its content fades out as it goes
// back into the deck (gone by CONTENT_GONE_DEPTH), and once it has come to
// the top it fades back in over REVEAL_MS, rising the last few points.
const CONTENT_GONE_DEPTH = 0.6;
const ARRIVED_DEPTH = 0.02;
const REVEAL_MS = 420;
const REVEAL_RISE = 6;

/**
 * The stack keeps four cards mounted at once — one per place in it — and a
 * swipe only rotates which place each one holds. No mounted card ever swaps
 * the task it shows while that card is on screen, which is what makes the
 * hand-over invisible: the moment the stack steps on, every visible card is
 * already showing what it should show afterwards, so nothing flickers.
 */
const SLOT_COUNT = 4;
/**
 * Place 0 is the active card, 1 and 2 wait behind it, and -1 is the previous
 * task, tucked away at the very back of the deck (where Previous brings it
 * back from).
 */
const DEPTHS = [0, 1, 2];
/** The back of the deck: sized and placed like place 2, and hidden. */
const BACK_DEPTH = 2;
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

// A CSS box-shadow rather than Android's elevation: elevation drew a hard grey
// rectangle once a card was partly transparent (they fade as they move through
// the stack) and greyed its inside through it. A box-shadow is only ever drawn
// outside the card, so it's safe on both platforms.
const CARD_SHADOW = { boxShadow: "0 26px 40px -18px rgba(30, 16, 6, 0.6)" };

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

/** Which place a mounted card holds right now: 0 is active, -1 is at the back of the deck. */
function depthOf(slot: number, activeSlot: number) {
  "worklet";
  return ((slot - activeSlot + SLOT_COUNT + 1) % SLOT_COUNT) - 1;
}

function easeOut(u: number) {
  "worklet";
  return 1 - (1 - u) ** 3;
}

function easeInOut(u: number) {
  "worklet";
  return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
}

/** Where a card is drawn: sideways travel, 3D turn, how deep in the deck, how visible, drawing order. */
type Pose = { x: number; turn: number; depth: number; opacity: number; z: number };

/** A card sitting in (or moving between) the deck's places. */
function restPose(depth: number): Pose {
  "worklet";
  return {
    x: 0,
    turn: 0,
    depth,
    opacity: interpolate(depth, DEPTHS, DEPTH_OPACITY, Extrapolation.CLAMP),
    z: Math.round(30 - depth * 10),
  };
}

/** The top card under the finger: following it, turning with it, a little faded. */
function dragPose(dragX: number, cardWidth: number): Pose {
  "worklet";
  return {
    x: dragX,
    turn: Math.max(-TURN_DEG, Math.min(TURN_DEG, dragX * DRAG_TURN_PER_DP)),
    depth: 0,
    opacity: 1 - DRAG_FADE * Math.min(Math.abs(dragX) / cardWidth, 1),
    z: Z_THROWN,
  };
}

/**
 * The shuffle at `s` (0 = on top, 1 = tucked in at the back), starting from
 * wherever the finger let go (`fromX`) and swinging out to `dir`'s side.
 * Previous plays it from 1 back to 0.
 */
function tuckPose(s: number, dir: number, fromX: number, cardWidth: number): Pose {
  "worklet";
  const out = dir * OUT_WIDTHS * cardWidth;
  if (s <= OUT_END) {
    // Out to the side, turning towards it, back to full strength.
    const from = dragPose(fromX, cardWidth);
    const e = easeOut(s / OUT_END);
    return {
      x: from.x + (out - from.x) * e,
      turn: from.turn + (dir * TURN_DEG - from.turn) * e,
      depth: 0,
      opacity: from.opacity + (1 - from.opacity) * e,
      z: Z_THROWN,
    };
  }
  if (s <= TURN_END) {
    // Out at the side, it turns round to face the way back.
    const e = easeInOut((s - OUT_END) / (TURN_END - OUT_END));
    return { x: out, turn: dir * TURN_DEG * (1 - 2 * e), depth: 0, opacity: 1, z: Z_THROWN };
  }
  // Back in, behind the deck: shrinking to its back place and fading out there.
  const e = easeInOut((s - TURN_END) / (1 - TURN_END));
  return {
    x: out * (1 - e),
    turn: -dir * TURN_DEG * (1 - e),
    depth: BACK_DEPTH * e,
    opacity: e < 0.7 ? 1 : 1 - (e - 0.7) / 0.3,
    z: Z_BACK,
  };
}

/** The stack's moving parts, shared by every card. */
type StackMotion = {
  activeSlot: SharedValue<number>;
  /** The finger's travel on the top card. Held where it let go until the shuffle lands. */
  dragX: SharedValue<number>;
  /** The top card's shuffle to the back, 0 → 1. */
  shuffle: SharedValue<number>;
  /** The back card's place in its shuffle: 1 tucked away; Previous plays it back to 0. */
  back: SharedValue<number>;
  /** How far the rest of the deck has moved up one place (1) — or down one, for Previous (-1). */
  rise: SharedValue<number>;
  /** Which side the shuffle swings out to: -1 left, 1 right. */
  dir: SharedValue<number>;
  stackHeight: SharedValue<number>;
};

function StackSlot({
  slot,
  task,
  rank,
  active,
  motion,
  cardWidth,
  onMeasure,
  onBoundsChange,
  onStart,
  onComplete,
  onDetails,
  hidden,
  shadowed,
}: {
  slot: number;
  task: Task;
  rank: number;
  active: boolean;
  /**
   * Only the top card and the one peeking under it cast a shadow: a 40dp blur
   * is redrawn every frame of a swipe on Android, and the other two (out on
   * the left, and invisible at the back) would pay for one nobody sees.
   */
  shadowed: boolean;
  motion: StackMotion;
  cardWidth: number;
  onMeasure: (slot: number, height: number) => void;
  onBoundsChange?: (taskId: string, bounds: CardBounds) => void;
  onStart: (task: Task, plannedMinutes: number, bounds?: CardBounds) => void;
  onComplete: (task: Task) => void;
  onDetails: (taskId: string) => void;
  hidden: boolean;
}) {
  const colors = useColors();
  const reduceMotion = useReducedMotion();
  const { activeSlot, dragX, shuffle, back, rise, dir, stackHeight } = motion;

  // Where this card is at this instant, from its place in the deck and
  // whatever the stack is doing: the top card is dragged or thrown, the back
  // card is brought out again by Previous, and the rest move up or down a place.
  const pose = useDerivedValue(() => {
    const place = depthOf(slot, activeSlot.get());
    if (place === -1) return tuckPose(back.get(), dir.get(), 0, cardWidth);
    if (place === 0 && shuffle.get() > 0) return tuckPose(shuffle.get(), dir.get(), dragX.get(), cardWidth);
    if (place === 0 && rise.get() >= 0) {
      return dragX.get() === 0 ? restPose(0) : dragPose(dragX.get(), cardWidth);
    }
    return restPose(Math.min(Math.max(place - rise.get(), 0), BACK_DEPTH));
  });

  const placeStyle = useAnimatedStyle(() => {
    const { x, turn, depth, opacity, z } = pose.get();
    const scale = interpolate(depth, DEPTHS, DEPTH_SCALE, Extrapolation.CLAMP);
    // Scaled about its centre, a card's bottom edge rises by half the height it
    // lost. Dropping it back by that much lines it up with the active card's
    // bottom edge, and the peek then sets it just below.
    const translateY =
      (stackHeight.get() * (1 - scale)) / 2 + interpolate(depth, DEPTHS, DEPTH_PEEK, Extrapolation.CLAMP);

    return {
      zIndex: z,
      opacity: hidden ? 0 : opacity,
      transform: [
        { perspective: PERSPECTIVE },
        { translateX: x },
        { translateY },
        { rotateY: `${turn}deg` },
        { scale },
      ],
    };
  });

  const veilStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pose.get().depth, DEPTHS, DEPTH_VEIL, Extrapolation.CLAMP),
  }));

  // 1 once this card has come to the top and its content has faded in; 0
  // while it waits. Only the arrival is timed — leaving is the depth's job.
  const reveal = useSharedValue(active ? 1 : 0);
  useAnimatedReaction(
    () => pose.get().depth,
    (depth, previous) => {
      if (previous === null) return;
      if (depth <= ARRIVED_DEPTH && previous > ARRIVED_DEPTH) {
        reveal.set(withTiming(1, { duration: reduceMotion ? 0 : REVEAL_MS, easing: Easing.out(Easing.quad) }));
      } else if (depth >= 0.99 && previous < 0.99) {
        cancelAnimation(reveal);
        reveal.set(0);
      }
    },
  );
  const contentStyle = useAnimatedStyle(() => {
    const shown = reveal.get();
    const inDeck = 1 - Math.min(Math.max(pose.get().depth / CONTENT_GONE_DEPTH, 0), 1);
    return {
      opacity: Math.min(shown, inDeck),
      transform: [{ translateY: (1 - shown) * REVEAL_RISE }],
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
      pointerEvents={hidden ? "none" : "auto"}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      style={[
        styles.card,
        { backgroundColor: colors.charcoal[900] },
        active ? null : styles.waiting,
        shadowed ? CARD_SHADOW : null,
        placeStyle,
      ]}
    >
      <NextTaskCard
        task={task}
        rank={rank}
        preview={!active}
        style={heightStyle}
        contentStyle={contentStyle}
        onMeasure={(height) => onMeasure(slot, height)}
        onBoundsChange={(bounds) => onBoundsChange?.(task.id, bounds)}
        onStart={(plannedMinutes, bounds) => onStart(task, plannedMinutes, bounds)}
        onComplete={() => onComplete(task)}
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
  const cardWidth = width - SIDE_PADDING * 2;
  const swipeThreshold = width * 0.25;

  const dragX = useSharedValue(0);
  const shuffle = useSharedValue(0);
  const back = useSharedValue(1);
  const rise = useSharedValue(0);
  const dir = useSharedValue(-1);
  const activeSlot = useSharedValue(0);
  // Card sizes stay fixed while the finger moves; the stack only animates its
  // height after release, avoiding per-frame relayout of every card's content.
  const heights = useSharedValue(Array.from({ length: SLOT_COUNT }, () => 0));
  const stackHeight = useSharedValue(0);
  const swipeLocked = useSharedValue(false);
  // One object for every card, so the memoized cards don't re-render for it.
  const motion = useMemo<StackMotion>(
    () => ({ activeSlot, dragX, shuffle, back, rise, dir, stackHeight }),
    [activeSlot, back, dir, dragX, rise, shuffle, stackHeight],
  );
  const [activeSlotIndex, setActiveSlotIndex] = useState(0);
  useEffect(() => {
    swipeLocked.set(false);
  }, [currentIndex, swipeLocked]);

  const completeTask = useTaskStore((state) => state.completeTask);
  // A card finished with its Complete button: its task, and the timer holding
  // the card still while it celebrates. Kept until the task has left the queue.
  const sendOff = useRef<{ taskId: string; timer: ReturnType<typeof setTimeout> | null } | null>(null);
  useEffect(() => {
    const pending = sendOff.current;
    if (pending && !tasks.some((task) => task.id === pending.taskId)) sendOff.current = null;
  }, [tasks]);

  // `finishedTaskId`: the card that just flew off was finished, not swiped.
  const commit = (step: 1 | -1, nextIndex: number, finishedTaskId: string | null) => {
    setActiveSlotIndex((slot) => (slot + step + SLOT_COUNT) % SLOT_COUNT);
    onIndexChange(nextIndex);
    // The finished card has flown off and the next one is in place: only now
    // is its task completed, so the queue never reshuffles under it mid-flight.
    // Its place in the queue may not change, so the stack unlocks here.
    if (finishedTaskId) {
      completeTask(finishedTaskId);
      swipeLocked.set(false);
    }
  };

  const settle = (step: 1 | -1, nextIndex: number, finishedTaskId: string | null) => {
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
    // The moving parts back at rest: in the new places, every card's pose is
    // exactly the one it has just finished on.
    dragX.set(0);
    shuffle.set(0);
    back.set(1);
    rise.set(0);
    scheduleOnRN(commit, step, nextIndex, finishedTaskId);
  };

  const riseTiming = { duration: reduceMotion ? 0 : RISE_MS, easing: MOTION.easing.standard };
  // Linear: each beat of the shuffle eases itself (tuckPose).
  const tuckTiming = { duration: reduceMotion ? 0 : TUCK_MS, easing: Easing.linear };

  // Next: the top card is shuffled to the back, swinging out to `swingDir`.
  // The Next button and the send-off take the same move a swipe does; the
  // swipe's copy is written out in the gesture below — the callback that lands
  // the step has to be a worklet, and it is the call site that makes it one.
  const shuffleForward = (swingDir: number, nextIndex: number, finishedTaskId: string | null = null) => {
    swipeLocked.set(true);
    dir.set(swingDir);
    rise.set(withTiming(1, riseTiming));
    shuffle.set(
      withTiming(1, tuckTiming, (finished) => {
        if (finished) settle(1, nextIndex, finishedTaskId);
      }),
    );
  };

  const showNext = () => {
    if (swipeLocked.get()) return;
    shuffleForward(-1, (currentIndex + 1) % total);
  };

  // Previous: the shuffle played backwards — the card tucked at the back comes
  // out on the left, turns, and lands on top, while the deck steps back a
  // place just as it arrives.
  const showPrevious = () => {
    if (swipeLocked.get()) return;
    swipeLocked.set(true);
    dir.set(-1);
    rise.set(withDelay(reduceMotion ? 0 : TUCK_MS - RISE_MS, withTiming(-1, riseTiming)));
    back.set(
      withTiming(0, tuckTiming, (finished) => {
        if (finished) settle(-1, (currentIndex - 1 + total) % total, null);
      }),
    );
  };

  // What the send-off does when its timer fires — read from the stack as it
  // is then, not as it was when the button was pressed.
  const sendOffNow = useRef<(taskId: string) => void>(() => {});
  useEffect(() => {
    sendOffNow.current = (taskId) => {
      if (sendOff.current?.taskId !== taskId) return;
      // Still the card on top, with a next one to bring in: it's shuffled away
      // like a swipe, and commit completes the task once it's gone.
      if (total > 1 && !reduceMotion && tasks[currentIndex]?.id === taskId) {
        shuffleForward(-1, (currentIndex + 1) % total, taskId);
        return;
      }
      // The last card (or no motion wanted): nowhere to fly — just complete it.
      sendOff.current = null;
      swipeLocked.set(false);
      completeTask(taskId);
    };
  });

  const handleComplete = useCallback(
    (task: Task) => {
      if (sendOff.current) return;
      // Held still while the card celebrates — no swiping it away mid-flood.
      swipeLocked.set(true);
      const timer = setTimeout(() => {
        if (sendOff.current) sendOff.current.timer = null;
        sendOffNow.current(task.id);
      }, CELEBRATION_MS);
      sendOff.current = { taskId: task.id, timer };
    },
    [swipeLocked],
  );

  // Leaving mid-celebration still completes the task: the tap was real.
  useEffect(
    () => () => {
      const pending = sendOff.current;
      if (!pending) return;
      if (pending.timer) clearTimeout(pending.timer);
      const { tasks: allTasks, completeTask: complete } = useTaskStore.getState();
      if (allTasks.some((task) => task.id === pending.taskId && task.status === "pending")) complete(pending.taskId);
    },
    [],
  );

  const pan = Gesture.Pan()
    .enabled(total > 1)
    .activeOffsetX([-12, 12])
    .failOffsetY([-12, 12])
    .onBegin(() => {
      if (swipeLocked.get()) return;
      cancelAnimation(dragX);
      cancelAnimation(rise);
    })
    .onUpdate((event) => {
      if (swipeLocked.get()) return;
      dragX.set(event.translationX);
      // The card behind starts to come up as the top one is pulled aside.
      rise.set(Math.min(Math.abs(event.translationX) / cardWidth, 1) * PREVIEW_RISE);
    })
    .onEnd((event) => {
      if (swipeLocked.get()) return;
      const flung = Math.abs(event.translationX) > swipeThreshold || Math.abs(event.velocityX) > FLING_VELOCITY;
      if (!flung) {
        dragX.set(reduceMotion ? withTiming(0, { duration: 0 }) : withSpring(0, MOTION.spring.gesture));
        rise.set(withTiming(0, riseTiming));
        return;
      }
      // Either way brings up the next card, as with a real deck: the top card
      // swings out the way it was thrown and goes to the back. It starts from
      // where the finger let go (dragX is held there until it lands).
      const swingDir = Math.sign(event.translationX || event.velocityX) || -1;
      const nextIndex = (currentIndex + 1) % total;
      swipeLocked.set(true);
      dir.set(swingDir);
      rise.set(withTiming(1, riseTiming));
      shuffle.set(
        withTiming(1, tuckTiming, (finished) => {
          if (finished) settle(1, nextIndex, null);
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
          onComplete={() => handleComplete(only)}
          onDetails={() => onDetails(only.id)}
        />
      </View>
    );
  }

  // Always in slot order: which card is drawn over which is each pose's
  // zIndex. Re-sorting them as they changed places moved the views around,
  // which replayed the button row's fade-in on the card that had just landed.
  const slots = Array.from({ length: SLOT_COUNT }, (_, slot) => {
    const depth = depthOf(slot, activeSlotIndex);
    const index = (((currentIndex + depth) % total) + total) % total;
    return { slot, depth, task: tasks[index], rank: index + 1 };
  });

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
              motion={motion}
              cardWidth={cardWidth}
              onMeasure={handleMeasure}
              onBoundsChange={onFocusBoundsChange}
              onStart={onStart}
              onComplete={handleComplete}
              onDetails={onDetails}
              hidden={task.id === focusTaskId}
              shadowed={depth === 0 || depth === 1}
            />
          ))}
        </View>
      </GestureDetector>

      {/* 30 = the card behind's 10dp peek + 20 of air. Same size and corner
          for both; Next is the solid one because it's the way forward. */}
      <View className="mt-[30px] flex-row items-center gap-3 px-6">
        <AnimatedPressable
          onPress={showPrevious}
          accessibilityRole="button"
          className="btn--secondary-cream min-h-[44px] flex-1 flex-row items-center justify-center gap-2 rounded-[16px] px-3"
        >
          <Feather name="arrow-left" size={16} color={colors.ink.cream} />
          <Text className="font-grotesk-bold text-[14px] text-ink-cream">{t.next.previous}</Text>
        </AnimatedPressable>
        <AnimatedPressable
          onPress={showNext}
          accessibilityRole="button"
          className="btn--charcoal-solid min-h-[44px] flex-1 flex-row items-center justify-center gap-2 rounded-[16px] px-3"
        >
          <Text className="font-grotesk-bold text-[14px] text-ink-charcoal">{t.next.nextCard}</Text>
          <Feather name="arrow-right" size={16} color={colors.ink.charcoal} />
        </AnimatedPressable>
      </View>
    </>
  );
}
