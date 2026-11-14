import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
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
    withSequence,
    withSpring,
    withTiming,
    type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { CELEBRATION_MS, NextTaskCard, type CardBounds, type TodayDoneMotion } from "@/components/NextTaskCard";
import { MOTION } from "@/constants/theme";
import { useColors } from "@/hooks/useTheme";
import { translate } from "@/lib/i18n";
import { useTaskStore } from "@/store/useTaskStore";
import { withUndo } from "@/store/useUndoStore";
import type { Task } from "@/types/task";

// The page's 20 plus the mockup's 4 (Final-Today.html). Corners a size down
// from its 28, like the rest of the card (2026-11-03).
const SIDE_PADDING = 24;
/** Every card in the stack, front and back, so the edges line up as clean steps. */
const CARD_RADIUS = 28;
const FLING_VELOCITY = 800;
// These one-shot timings are the reference keyframes' percentages of 5 seconds.
const TODAY_DONE_MS = 3200;
const TODAY_DONE_CHECK_DELAY_MS = 750;
const TODAY_DONE_RING_DELAY_MS = 900;
const TODAY_DONE_TITLE_DELAY_MS = 1100;
const TODAY_DONE_CARD_DELAY_MS = 2200;
const TODAY_DONE_CARD_EXIT_DELAY_MS = 2350;
const TODAY_DONE_NEXT_DELAY_MS = 2450;

// The top card flies off the side it was swiped to, turning a little in 3D
// and fading, while the card behind comes forward (the user's call,
// 2026-10-28: it used to swing out and tuck in behind the deck). FLY_MS is the
// whole flight; the card behind is already in front after RISE_MS. Previous
// plays the flight backwards: the last card flies back in from the left.
const FLY_MS = 420;
const RISE_MS = 320;
/** How far out it flies, in card widths: clear of the screen, turn and all. */
const OUT_WIDTHS = 1.3;
const TURN_DEG = 24;
const PERSPECTIVE = 1000;
// While dragged, the card turns with the finger and fades a little.
const DRAG_TURN_PER_DP = 0.16;
const DRAG_FADE = 0.3;
/** How far the card behind rises while the top one is only being dragged. */
const PREVIEW_RISE = 0.3;
// Drawing order: the card being thrown goes over everything; then the deck in
// place order.
const Z_THROWN = 40;

// A waiting card is a plain card — its text and buttons showing in the band
// under the top card only looked broken. Its content fades out as it goes
// back into the deck (gone by CONTENT_GONE_DEPTH), and once it has come to
// the top it fades back in over REVEAL_MS, rising the last few points — starting
// as soon as it begins to move up, not when it lands.
const CONTENT_GONE_DEPTH = 0.6;
const REVEAL_MS = 340;
const REVEAL_OUT_MS = 140;
const REVEAL_RISE = 6;

/**
 * The stack keeps five cards mounted at once — one per place in it — and a
 * swipe only rotates which place each one holds. No mounted card ever swaps
 * the task it shows while that card is on screen, which is what makes the
 * hand-over invisible: the moment the stack steps on, every visible card is
 * already showing what it should show afterwards, so nothing flickers.
 */
const SLOT_COUNT = 5;
/**
 * Place 0 is the active card, 1 and 2 show behind it (Final-Today.html), 3
 * waits unseen behind those, and -1 is the previous task, flown off to the
 * side and hidden there (where Previous brings it back from).
 */
const DEPTHS = [0, 1, 2, 3];
/** The deepest place in the deck. */
const BACK_DEPTH = 3;
/** The deepest place that shows at rest. */
const SHOWN_DEPTH = 2;
// The stack (the user's spec, 2026-11-13): the cards behind are clearly
// lighter and narrower than the front one, so it reads as a stack.
// How far in from each side each place's card is drawn.
const DEPTH_INSET = [0, 10, 22, 26];
// How much lower each place's top edge is than the front card's.
const DEPTH_TOP = [0, 10, 22, 22];
// How far each place's bottom edge sticks out below the front card's.
const DEPTH_OUT = [0, 10, 20, 20];
// A waiting card is a flat band of brown, lighter the further back it sits:
// #352A23 second, #4A3C32 third — veils of those over the card's own ink
// (#221C17), clearing as the card comes forward. The app has one palette for
// light and dark, so in dark mode too each card is a shade lighter than the
// one in front of it.
const VEIL_SECOND = "#352A23";
const VEIL_THIRD = "#4A3C32";
const DEPTH_VEIL_SECOND = [0, 1, 1, 1];
const DEPTH_VEIL_THIRD = [0, 0, 1, 1];

// No shadows under the stack (the user's call, 2026-11-13: the shadow was cut
// off partway and looked wrong) — the steps of lighter brown carry the depth.

const styles = StyleSheet.create({
  stack: { marginHorizontal: SIDE_PADDING },
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

/** Where a card is drawn: sideways travel, 3D turn, how deep in the deck, how visible, drawing order. */
type Pose = { x: number; turn: number; depth: number; opacity: number; z: number };

/**
 * A card sitting in (or moving between) the deck's places. Places past
 * `shownDepth` are invisible, and a card fades in as it moves up from there —
 * so nothing pops into view behind the card that just landed.
 */
function restPose(depth: number, shownDepth: number): Pose {
  "worklet";
  return {
    x: 0,
    turn: 0,
    depth,
    opacity: interpolate(depth, [shownDepth, shownDepth + 1], [1, 0], Extrapolation.CLAMP),
    // One drawing order per place, switching halfway between two — each
    // change makes Android re-sort the cards, so it shouldn't happen every
    // few frames of a move.
    z: depth < 0.5 ? 30 : depth < 1.5 ? 20 : depth < 2.5 ? 10 : 5,
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
 * The flight at `s` (0 = on top, 1 = gone off the side), starting from
 * wherever the finger let go (`fromX`) and flying out to `dir`'s side. It
 * keeps its size and content all the way, fading as it goes. Previous plays
 * it from 1 back to 0.
 */
function flyPose(s: number, dir: number, fromX: number, cardWidth: number): Pose {
  "worklet";
  const from = dragPose(fromX, cardWidth);
  const e = easeOut(s);
  return {
    x: from.x + (dir * OUT_WIDTHS * cardWidth - from.x) * e,
    turn: from.turn + (dir * TURN_DEG - from.turn) * e,
    depth: 0,
    opacity: from.opacity * (1 - s),
    z: Z_THROWN,
  };
}

/** The stack's moving parts, shared by every card. */
type StackMotion = {
  activeSlot: SharedValue<number>;
  /** The finger's travel on the top card. Held where it let go until the shuffle lands. */
  dragX: SharedValue<number>;
  /** The top card's flight off the side, 0 → 1. */
  shuffle: SharedValue<number>;
  /** The previous card's place in its flight: 1 gone off the side; Previous plays it back to 0. */
  back: SharedValue<number>;
  /** How far the rest of the deck has moved up one place (1) — or down one, for Previous (-1). */
  rise: SharedValue<number>;
  /** Which side the card flies out to (or, for Previous, back in from): -1 left, 1 right. */
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
  onNavigate,
  hidden,
  shownDepth,
  depthScale,
  completionMotion,
  todayDoneEnabled,
  todayDoneMotion,
  completionTaskId,
  completionNextTaskId,
}: {
  slot: number;
  task: Task;
  rank: number;
  active: boolean;
  motion: StackMotion;
  cardWidth: number;
  /** The deepest place that shows at rest: fewer bands behind when there are fewer tasks. */
  shownDepth: number;
  /** Each place's scale, from DEPTH_INSET and the card's width. */
  depthScale: number[];
  completionMotion?: TodayDoneMotion;
  todayDoneEnabled: boolean;
  todayDoneMotion?: TodayDoneMotion;
  completionTaskId: string | null;
  completionNextTaskId: string | null;
  onNavigate: (step: 1 | -1) => void;
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
  // whatever the stack is doing: the top card is dragged or thrown, the
  // previous card is flown back in by Previous, and the rest move up or down a place.
  const pose = useDerivedValue(() => {
    const place = depthOf(slot, activeSlot.get());
    if (place === -1) return flyPose(back.get(), dir.get(), 0, cardWidth);
    if (place === 0 && shuffle.get() > 0) return flyPose(shuffle.get(), dir.get(), dragX.get(), cardWidth);
    if (place === 0 && rise.get() >= 0) {
      return dragX.get() === 0 ? restPose(0, shownDepth) : dragPose(dragX.get(), cardWidth);
    }
    return restPose(Math.min(Math.max(place - rise.get(), 0), BACK_DEPTH), shownDepth);
  });

  const placeStyle = useAnimatedStyle(() => {
    const { x, turn, depth, opacity, z } = pose.get();
    const slotDepth = depthOf(slot, activeSlot.get());
    const started = completionMotion?.started.get() ?? 0;
    if (started && slotDepth === 0 && task.id === completionTaskId) {
      const squeeze = completionMotion?.cardSqueeze.get() ?? 0;
      const exit = completionMotion?.cardExit.get() ?? 0;
      return {
        zIndex: Z_THROWN,
        opacity: 1 - exit,
        transform: [
          { perspective: PERSPECTIVE },
          { translateX: 0 },
          { translateY: -26 * exit },
          { rotateY: "0deg" },
          { scale: 1 - 0.02 * squeeze + 0.09 * exit },
        ],
      };
    }
    if (started && slotDepth === 1 && task.id === completionNextTaskId) {
      const move = completionMotion?.nextMove.get() ?? 0;
      const nextOpacity = completionMotion?.nextOpacity.get() ?? 0;
      return {
        zIndex: z,
        opacity: nextOpacity * opacity,
        transform: [
          { perspective: PERSPECTIVE },
          { translateX: 0 },
          { translateY: 16 * (1 - move) },
          { rotateY: "0deg" },
          { scale: 0.93 + 0.07 * move },
        ],
      };
    }
    // Narrower by DEPTH_INSET on each side; its top DEPTH_TOP lower and its
    // bottom DEPTH_OUT below the front card's — the height is set by scaling
    // about the card's centre, then moving it down into place.
    const scaleX = interpolate(depth, DEPTHS, depthScale, Extrapolation.CLAMP);
    const height = stackHeight.get();
    const top = interpolate(depth, DEPTHS, DEPTH_TOP, Extrapolation.CLAMP);
    const out = interpolate(depth, DEPTHS, DEPTH_OUT, Extrapolation.CLAMP);
    const scaleY = height > 0 ? (height + out - top) / height : 1;
    const translateY = top + (height * (scaleY - 1)) / 2;

    return {
      zIndex: z,
      opacity: hidden ? 0 : opacity,
      transform: [
        { perspective: PERSPECTIVE },
        { translateX: x },
        { translateY },
        { rotateY: `${turn}deg` },
        { scaleX },
        { scaleY },
      ],
    };
  });

  const veilSecondStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pose.get().depth, DEPTHS, DEPTH_VEIL_SECOND, Extrapolation.CLAMP),
  }));
  const veilThirdStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pose.get().depth, DEPTHS, DEPTH_VEIL_THIRD, Extrapolation.CLAMP),
  }));


  // 1 once this card's content has faded in; 0 while it waits. The fade
  // starts the moment the card begins moving up from its place behind the top
  // card — the first points of a drag on the card in front, or the first frame
  // of a button press — rather than once it has landed. `arriving` is true
  // from then until it lands, so the depth fade below (which hides a card's
  // content as it goes back into the deck) doesn't hold it hidden on the way.
  const reveal = useSharedValue(active ? 1 : 0);
  const arriving = useSharedValue(false);
  useAnimatedReaction(
    () => pose.get().depth,
    (depth, previous) => {
      if (previous === null) return;
      if (depth >= 0.99) {
        // Waiting in the deck (or back there after a drag that let go): hidden,
        // ready to fade in again next time. Quick rather than cut, in case a
        // let-go drag brought it back with its content still showing.
        if (arriving.get() || (previous < 0.99 && reveal.get() > 0)) {
          arriving.set(false);
          cancelAnimation(reveal);
          reveal.set(withTiming(0, { duration: reduceMotion ? 0 : REVEAL_OUT_MS }));
        }
        return;
      }
      if (depth <= 0.02) {
        // Landed on top without passing through the way up — Reduce Motion
        // moves it there in one frame: its content shows now.
        if (!arriving.get() && reveal.get() < 1) {
          reveal.set(withTiming(1, { duration: reduceMotion ? 0 : REVEAL_MS, easing: Easing.out(Easing.quad) }));
        }
        // Landed on top: from here, leaving is the depth fade's job.
        arriving.set(false);
        return;
      }
      // Only from the place straight behind the top card: the card further
      // back, moving up to that place, keeps its content hidden.
      if (depth < previous && !arriving.get() && reveal.get() < 1) {
        arriving.set(true);
        reveal.set(withTiming(1, { duration: reduceMotion ? 0 : REVEAL_MS, easing: Easing.out(Easing.quad) }));
      }
    },
  );
  // The card off to the side keeps its content: Previous flies it back in
  // showing what it is. Once it has landed on top, its content stays shown.
  useAnimatedReaction(
    () => depthOf(slot, activeSlot.get()),
    (place, previous) => {
      if (previous === -1 && place === 0) {
        cancelAnimation(reveal);
        arriving.set(false);
        reveal.set(1);
      }
    },
  );
  const contentStyle = useAnimatedStyle(() => {
    if (depthOf(slot, activeSlot.get()) === -1) return { opacity: 1, transform: [{ translateY: 0 }] };
    const shown = reveal.get();
    const inDeck = arriving.get() ? 1 : 1 - Math.min(Math.max(pose.get().depth / CONTENT_GONE_DEPTH, 0), 1);
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
      pointerEvents={
        hidden || task.id === completionTaskId || task.id === completionNextTaskId ? "none" : "auto"
      }
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      style={[
        styles.card,
        { backgroundColor: colors.palette.ink },
        active ? null : styles.waiting,
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
        onNavigate={active ? onNavigate : undefined}
        todayDoneEnabled={todayDoneEnabled}
        todayDoneMotion={todayDoneMotion}
      />
      <Animated.View pointerEvents="none" style={[styles.veil, { backgroundColor: VEIL_SECOND }, veilSecondStyle]} />
      <Animated.View pointerEvents="none" style={[styles.veil, { backgroundColor: VEIL_THIRD }, veilThirdStyle]} />
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
  animateTodayCompletion = false,
}: {
  tasks: Task[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
  onStart: (task: Task, plannedMinutes: number, bounds?: CardBounds) => void;
  onDetails: (taskId: string) => void;
  focusTaskId?: string;
  onFocusBoundsChange?: (taskId: string, bounds: CardBounds) => void;
  animateTodayCompletion?: boolean;
}) {
  const colors = useColors();
  const reduceMotion = useReducedMotion();
  const { width } = useWindowDimensions();
  const total = tasks.length;
  const cardWidth = width - SIDE_PADDING * 2;
  const swipeThreshold = width * 0.25;
  // Each place's card is a set number of points narrower on each side.
  const depthScale = useMemo(() => DEPTH_INSET.map((inset) => (cardWidth - inset * 2) / cardWidth), [cardWidth]);
  // Two bands behind the top card — or one, with only two tasks.
  const shownDepth = Math.min(SHOWN_DEPTH, total - 1);

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
  const todayDoneStarted = useSharedValue(0);
  const todayDoneCheckScale = useSharedValue(0);
  const todayDoneRingStarted = useSharedValue(0);
  const todayDoneRingProgress = useSharedValue(0);
  const todayDoneTitleProgress = useSharedValue(0);
  const todayDoneFadeProgress = useSharedValue(0);
  const todayDoneCardSqueeze = useSharedValue(0);
  const todayDoneCardExit = useSharedValue(0);
  const todayDoneNextMove = useSharedValue(0);
  const todayDoneNextOpacity = useSharedValue(0);
  const todayDoneMotion = useMemo<TodayDoneMotion>(
    () => ({
      started: todayDoneStarted,
      checkScale: todayDoneCheckScale,
      ringStarted: todayDoneRingStarted,
      ringProgress: todayDoneRingProgress,
      titleProgress: todayDoneTitleProgress,
      fadeProgress: todayDoneFadeProgress,
      cardSqueeze: todayDoneCardSqueeze,
      cardExit: todayDoneCardExit,
      nextMove: todayDoneNextMove,
      nextOpacity: todayDoneNextOpacity,
    }),
    [
      todayDoneCardExit,
      todayDoneCardSqueeze,
      todayDoneCheckScale,
      todayDoneFadeProgress,
      todayDoneNextMove,
      todayDoneNextOpacity,
      todayDoneRingProgress,
      todayDoneRingStarted,
      todayDoneStarted,
      todayDoneTitleProgress,
    ],
  );
  const [completionTaskId, setCompletionTaskId] = useState<string | null>(null);
  const [completionNextTaskId, setCompletionNextTaskId] = useState<string | null>(null);
  // One object for every card, so the memoized cards don't re-render for it.
  const motion = useMemo<StackMotion>(
    () => ({ activeSlot, dragX, shuffle, back, rise, dir, stackHeight }),
    [activeSlot, back, dir, dragX, rise, shuffle, stackHeight],
  );
  const [activeSlotIndex, setActiveSlotIndex] = useState(0);

  const completeTask = useTaskStore((state) => state.completeTask);
  // "Mark complete" is one tap from Start session, so it can be taken back.
  const completeWithUndo = useCallback(
    (taskId: string) => {
      const title = useTaskStore.getState().tasks.find((task) => task.id === taskId)?.title ?? "";
      withUndo(translate().undoToast.done(title), () => completeTask(taskId));
    },
    [completeTask],
  );
  // A card finished with its Complete button stays mounted until it has left
  // the queue, so the stack can finish its send-off before completing the task.
  const sendOff = useRef<{ taskId: string; timer: ReturnType<typeof setTimeout> | null } | null>(null);
  useEffect(() => {
    if (!sendOff.current) swipeLocked.set(false);
  }, [currentIndex, swipeLocked]);
  useEffect(() => {
    const pending = sendOff.current;
    if (pending && !tasks.some((task) => task.id === pending.taskId)) {
      if (pending.timer) clearTimeout(pending.timer);
      sendOff.current = null;
      swipeLocked.set(false);
    }
  }, [swipeLocked, tasks]);
  useEffect(() => {
    if (completionTaskId && tasks.some((task) => task.id === completionTaskId)) return;
    todayDoneStarted.set(0);
    todayDoneCheckScale.set(0);
    todayDoneRingStarted.set(0);
    todayDoneRingProgress.set(0);
    todayDoneTitleProgress.set(0);
    todayDoneFadeProgress.set(0);
    todayDoneCardSqueeze.set(0);
    todayDoneCardExit.set(0);
    todayDoneNextMove.set(0);
    todayDoneNextOpacity.set(0);
  }, [
    completionTaskId,
    tasks,
    todayDoneCardExit,
    todayDoneCardSqueeze,
    todayDoneCheckScale,
    todayDoneFadeProgress,
    todayDoneNextMove,
    todayDoneNextOpacity,
    todayDoneRingProgress,
    todayDoneRingStarted,
    todayDoneStarted,
    todayDoneTitleProgress,
  ]);

  // `finishedTaskId`: the card that just flew off was finished, not swiped.
  const commit = useCallback(
    (step: 1 | -1, nextIndex: number, finishedTaskId: string | null) => {
      setActiveSlotIndex((slot) => (slot + step + SLOT_COUNT) % SLOT_COUNT);
      onIndexChange(nextIndex);
      // The finished card has cleared and the next one is in place: only now
      // is its task completed, so the queue never reshuffles under it mid-flight.
      // Its place in the queue may not change, so the stack unlocks here.
      if (finishedTaskId) {
        completeWithUndo(finishedTaskId);
        swipeLocked.set(false);
      }
    },
    [completeWithUndo, onIndexChange, swipeLocked],
  );

  const finishTodayCompletion = useCallback(
    (taskId: string) => {
      if (sendOff.current?.taskId !== taskId) return;
      sendOff.current.timer = null;
      if (total > 1 && tasks[currentIndex]?.id === taskId) {
        const preferredNextIndex = completionNextTaskId
          ? tasks.findIndex((task) => task.id === completionNextTaskId)
          : -1;
        const nextIndex = preferredNextIndex >= 0 ? preferredNextIndex : (currentIndex + 1) % total;
        const nextSlot = (activeSlot.get() + 1) % SLOT_COUNT;
        activeSlot.set(nextSlot);
        const nextHeight = heights.get()[nextSlot];
        if (nextHeight > 0) {
          stackHeight.set(
            withTiming(nextHeight, {
              duration: reduceMotion ? 0 : MOTION.duration.standard,
              easing: MOTION.easing.standard,
            }),
          );
        }
        dragX.set(0);
        shuffle.set(0);
        back.set(1);
        rise.set(0);
        commit(1, nextIndex, taskId);
        return;
      }
      // The card wasn't on top any more: the deck goes back to rest rather
      // than staying risen, with the card behind drawn over the top one.
      rise.set(0);
      sendOff.current = null;
      swipeLocked.set(false);
      completeWithUndo(taskId);
    },
    [
      activeSlot,
      back,
      commit,
      completeWithUndo,
      completionNextTaskId,
      currentIndex,
      dragX,
      heights,
      reduceMotion,
      rise,
      shuffle,
      stackHeight,
      swipeLocked,
      tasks,
      total,
    ],
  );

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
  // Linear: the flight eases itself (flyPose).
  const flyTiming = { duration: reduceMotion ? 0 : FLY_MS, easing: Easing.linear };
  // Previous plays the flight backwards, so its clock slows as it lands.
  const flyBackTiming = { duration: reduceMotion ? 0 : FLY_MS, easing: Easing.out(Easing.cubic) };

  // Always the full set of values, back at rest when nothing is being
  // completed. Returning {} left the faded-out card's last values on the view:
  // when the one card left was done and another task took its place in the
  // same view (a repeating task's next one, a task coming in), that card
  // showed up invisible.
  const singleCardDoneStyle = useAnimatedStyle(() => {
    // Hidden while its focus session opens out of it.
    const shown = tasks[0] && focusTaskId === tasks[0].id ? 0 : 1;
    if (!animateTodayCompletion || !tasks[0] || completionTaskId !== tasks[0].id) {
      return { opacity: shown, transform: [{ translateY: 0 }, { scale: 1 }] };
    }
    const squeeze = todayDoneCardSqueeze.get();
    const exit = todayDoneCardExit.get();
    return {
      opacity: shown * (1 - exit),
      transform: [
        { translateY: -26 * exit },
        { scale: 1 - 0.02 * squeeze + 0.09 * exit },
      ],
    };
  });

  // Next: the top card flies off to `swingDir`'s side.
  // The Next button and the send-off take the same move a swipe does; the
  // swipe's copy is written out in the gesture below — the callback that lands
  // the step has to be a worklet, and it is the call site that makes it one.
  const shuffleForward = (swingDir: number, nextIndex: number, finishedTaskId: string | null = null) => {
    swipeLocked.set(true);
    dir.set(swingDir);
    rise.set(withTiming(1, riseTiming));
    shuffle.set(
      withTiming(1, flyTiming, (finished) => {
        if (finished) settle(1, nextIndex, finishedTaskId);
      }),
    );
  };

  const showNext = () => {
    if (swipeLocked.get()) return;
    shuffleForward(-1, (currentIndex + 1) % total);
  };

  // Previous: the flight played backwards — the previous card flies back in
  // from the left and lands on top, while the deck steps back a place just
  // as it arrives.
  const showPrevious = () => {
    if (swipeLocked.get()) return;
    swipeLocked.set(true);
    dir.set(-1);
    rise.set(withDelay(reduceMotion ? 0 : FLY_MS - RISE_MS, withTiming(-1, riseTiming)));
    back.set(
      withTiming(0, flyBackTiming, (finished) => {
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
      if (animateTodayCompletion) {
        finishTodayCompletion(taskId);
        return;
      }
      // Still the card on top, with a next one to bring in: it's shuffled away
      // like a swipe, and commit completes the task once it's gone.
      if (total > 1 && !reduceMotion && tasks[currentIndex]?.id === taskId) {
        shuffleForward(-1, (currentIndex + 1) % total, taskId);
        return;
      }
      // The last card (or no motion wanted): nowhere to fly — just complete it.
      sendOff.current = null;
      swipeLocked.set(false);
      completeWithUndo(taskId);
    };
  });

  // A screen reader's Next / Previous on the top card (the stack had buttons
  // for these until the 2026-11 redesign; a swipe does the same). Read
  // through a ref so the memoized cards keep one callback.
  const navigateNow = useRef<(step: 1 | -1) => void>(() => {});
  useEffect(() => {
    navigateNow.current = (step) => (step === 1 ? showNext() : showPrevious());
  });
  const handleNavigate = useCallback((step: 1 | -1) => navigateNow.current(step), []);

  const handleComplete = useCallback(
    (task: Task) => {
      if (sendOff.current) return;
      // A tap that lands while a card is still flying (a lagging swipe) would
      // celebrate a card that's no longer the one on top.
      if (shuffle.get() > 0 || back.get() < 1) return;
      swipeLocked.set(true);
      if (animateTodayCompletion) {
        sendOff.current = { taskId: task.id, timer: null };
        if (reduceMotion) {
          finishTodayCompletion(task.id);
          return;
        }

        const nextTask = total > 1 ? tasks[(currentIndex + 1) % total] : undefined;
        setCompletionTaskId(task.id);
        setCompletionNextTaskId(nextTask?.id ?? null);
        todayDoneStarted.set(1);
        todayDoneCheckScale.set(
          withDelay(
            TODAY_DONE_CHECK_DELAY_MS,
            withSequence(
              withTiming(1.18, { duration: 250, easing: Easing.bezier(0.2, 0.8, 0.2, 1) }),
              withTiming(1, { duration: 200, easing: Easing.bezier(0.2, 0.8, 0.2, 1) }),
            ),
          ),
        );
        todayDoneRingStarted.set(
          withDelay(
            TODAY_DONE_RING_DELAY_MS,
            withTiming(1, { duration: 100, easing: Easing.bezier(0, 0, 0.58, 1) }),
          ),
        );
        todayDoneRingProgress.set(
          withDelay(
            TODAY_DONE_RING_DELAY_MS + 100,
            withTiming(1, { duration: 700, easing: Easing.bezier(0, 0, 0.58, 1) }),
          ),
        );
        todayDoneTitleProgress.set(
          withDelay(
            TODAY_DONE_TITLE_DELAY_MS,
            withTiming(1, { duration: 600, easing: Easing.bezier(0.42, 0, 0.58, 1) }),
          ),
        );
        todayDoneFadeProgress.set(
          withDelay(
            TODAY_DONE_TITLE_DELAY_MS,
            withTiming(1, { duration: 600, easing: Easing.bezier(0.42, 0, 0.58, 1) }),
          ),
        );
        todayDoneCardSqueeze.set(
          withDelay(
            TODAY_DONE_CARD_DELAY_MS,
            withTiming(1, { duration: 150, easing: Easing.bezier(0.5, 0, 0.3, 1) }),
          ),
        );
        todayDoneCardExit.set(
          withDelay(
            TODAY_DONE_CARD_EXIT_DELAY_MS,
            withTiming(1, { duration: 550, easing: Easing.bezier(0.5, 0, 0.3, 1) }),
          ),
        );
        todayDoneNextMove.set(
          withDelay(
            TODAY_DONE_NEXT_DELAY_MS,
            withTiming(1, { duration: 750, easing: Easing.bezier(0.2, 0.8, 0.2, 1) }),
          ),
        );
        todayDoneNextOpacity.set(
          withDelay(
            TODAY_DONE_NEXT_DELAY_MS,
            withTiming(1, { duration: 300, easing: Easing.bezier(0.2, 0.8, 0.2, 1) }),
          ),
        );
        rise.set(
          withDelay(
            TODAY_DONE_NEXT_DELAY_MS,
            withTiming(1, { duration: 750, easing: Easing.bezier(0.2, 0.8, 0.2, 1) }),
          ),
        );
        const timer = setTimeout(() => {
          if (sendOff.current?.taskId !== task.id) return;
          sendOff.current.timer = null;
          sendOffNow.current(task.id);
        }, TODAY_DONE_MS);
        sendOff.current.timer = timer;
        return;
      }
      // Held still while the card celebrates — no swiping it away mid-flood.
      const timer = setTimeout(() => {
        if (sendOff.current) sendOff.current.timer = null;
        sendOffNow.current(task.id);
      }, CELEBRATION_MS);
      sendOff.current = { taskId: task.id, timer };
    },
    [
      animateTodayCompletion,
      currentIndex,
      reduceMotion,
      swipeLocked,
      tasks,
      total,
      todayDoneCardExit,
      todayDoneCardSqueeze,
      todayDoneCheckScale,
      todayDoneFadeProgress,
      todayDoneNextMove,
      todayDoneNextOpacity,
      todayDoneRingProgress,
      todayDoneRingStarted,
      todayDoneStarted,
      todayDoneTitleProgress,
      rise,
      shuffle,
      back,
      finishTodayCompletion,
    ],
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
      // Either way brings up the next card: the top card flies off the way it
      // was thrown, from where the finger let go (dragX is held there until
      // it's gone).
      const swingDir = Math.sign(event.translationX || event.velocityX) || -1;
      const nextIndex = (currentIndex + 1) % total;
      swipeLocked.set(true);
      dir.set(swingDir);
      rise.set(withTiming(1, riseTiming));
      shuffle.set(
        withTiming(1, flyTiming, (finished) => {
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

  if (completionTaskId && !tasks.some((task) => task.id === completionTaskId)) {
    setCompletionTaskId(null);
    setCompletionNextTaskId(null);
  }

  // One task left: nothing to swipe between, so the stack stays out of the way.
  if (total <= 1) {
    const only = tasks[0];
    if (!only) return null;
    return (
      <Animated.View
        pointerEvents={focusTaskId === only.id || completionTaskId === only.id ? "none" : "auto"}
        style={[
          styles.stack,
          styles.card,
          // Its opacity, focus session included, is singleCardDoneStyle's.
          { backgroundColor: colors.palette.ink },
          singleCardDoneStyle,
        ]}
      >
        <NextTaskCard
          task={only}
          rank={1}
          todayDoneEnabled={animateTodayCompletion}
          todayDoneMotion={only.id === completionTaskId ? todayDoneMotion : undefined}
          onBoundsChange={(bounds) => onFocusBoundsChange?.(only.id, bounds)}
          onStart={(plannedMinutes, bounds) => onStart(only, plannedMinutes, bounds)}
          onComplete={() => handleComplete(only)}
          onDetails={() => onDetails(only.id)}
        />
      </Animated.View>
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
              onNavigate={handleNavigate}
              hidden={task.id === focusTaskId}
              shownDepth={shownDepth}
              depthScale={depthScale}
              completionMotion={animateTodayCompletion ? todayDoneMotion : undefined}
              todayDoneEnabled={animateTodayCompletion && depth === 0}
              todayDoneMotion={animateTodayCompletion && depth === 0 && task.id === completionTaskId ? todayDoneMotion : undefined}
              completionTaskId={completionTaskId}
              completionNextTaskId={completionNextTaskId}
            />
          ))}
        </View>
      </GestureDetector>
    </>
  );
}
