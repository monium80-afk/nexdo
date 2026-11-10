import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, {
  Easing,
  Extrapolation,
  FadeIn,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { SafeAreaView } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { GemGlow, GemMascot, gemLevelFor } from "@/components/GemMascot";
import { AppIcon } from "@/components/icons/AppIcons";
import { NextTaskCard, type CardBounds } from "@/components/NextTaskCard";
import { NextTaskCardStack } from "@/components/NextTaskCardStack";
import { TaskEditModal } from "@/components/TaskEditCard";
import { RoutineTimeline } from "@/components/RoutineTimeline";
import { useTabBarHeight } from "@/components/TabBar";
import { routinesFor } from "@/components/TodayRoutines";
import { FOCUS_FINISH } from "@/constants/focusFinish";
import { MOTION } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";
import { useColors } from "@/hooks/useTheme";
import { useToday } from "@/hooks/useToday";
import { useTranslation } from "@/hooks/useTranslation";
import { useVisibleTasks } from "@/hooks/useVisibleTasks";
import { keyToLocalDate } from "@/lib/localDate";
import { posthog } from "@/lib/posthog";
import { recommendTasks } from "@/lib/priority";
import { isRoutine } from "@/lib/recurrence";
import { buildToday } from "@/lib/schedule";
import { playSound } from "@/lib/sounds";
import { openAddSheet } from "@/store/useAddSheetStore";
import { useFocusPageStore } from "@/store/useFocusPageStore";
import { useSessionStore } from "@/store/useSessionStore";
import type { Task } from "@/types/task";

type FocusCardState = {
  task: Task;
  rank: number;
  origin: CardBounds;
  returnBounds: CardBounds;
};

// The session opens as a circle of its own charcoal growing out of the Start
// button until it fills the screen — decelerating hard into place — and
// closes by shrinking back into the card, accelerating away.
const REVEAL_OPEN = { duration: 520, easing: Easing.bezier(0.2, 0, 0, 1) };
const REVEAL_CLOSE = { duration: 360, easing: Easing.bezier(0.3, 0, 0.8, 0.15) };
/** Partway through the reveal, the session's parts start rising in (NextTaskCard's sessionEnter). */
const CONTENT_AT_MS = 200;
const CONTENT_OUT_MS = 150;
/** The circle's colour: the middle of the session's own gradient, which takes over once it's open. */
// The focus page's cream (Final-Focus.html).
const SESSION_BACKDROP = "#FAF1E4";

function centerOf(bounds: CardBounds) {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

/** From `point`, how far it is to the screen's farthest corner. */
function reachFrom(point: { x: number; y: number }, width: number, height: number) {
  return Math.max(
    Math.hypot(point.x, point.y),
    Math.hypot(width - point.x, point.y),
    Math.hypot(point.x, height - point.y),
    Math.hypot(width - point.x, height - point.y),
  );
}

/**
 * A session opening out of its Start button, and closing back into its card.
 *
 * Only a transform animates: the circle is laid out once at its full size and
 * scaled up from nothing, and the session itself is laid out once too — its
 * parts rise in on their own (NextTaskCard) while the circle finishes. Closing
 * runs the other way: the session fades, the circle shrinks onto the card it
 * came from (or the one that took its place), and is gone.
 */
function FocusCardTransition({
  focus,
  screenWidth,
  screenHeight,
  closing,
  finishing,
  onLanded,
  onExited,
  onCelebrated,
  onFinishing,
  onDetails,
  onBack,
}: {
  /** The page's Back: closes it, the session still running. */
  onBack: () => void;
  focus: FocusCardState;
  screenWidth: number;
  screenHeight: number;
  closing: boolean;
  /**
   * Done was tapped (constants/focusFinish.ts): no circle back into the card
   * — once its ending has played, the page fades out in place over Today.
   */
  finishing: boolean;
  onFinishing: () => void;
  /** The task was finished in the session and its celebration has played: close. */
  onCelebrated: () => void;
  /** The circle starts shrinking: time to show the card again under it. */
  onLanded: () => void;
  onExited: () => void;
  onDetails: (taskId: string) => void;
}) {
  const reduceMotion = useReducedMotion();
  const reveal = useSharedValue(0);
  const content = useSharedValue(1);
  const [contentMounted, setContentMounted] = useState(reduceMotion);

  // Out of the Start button, back into the card. One radius that covers the
  // whole screen from either point, so moving the centre while the circle
  // fills the screen is never seen.
  const from = centerOf(focus.origin);
  const to = centerOf(focus.returnBounds);
  const radius = Math.max(reachFrom(from, screenWidth, screenHeight), reachFrom(to, screenWidth, screenHeight)) + 2;
  const center = closing ? to : from;

  // No tab bar over a session; it comes back as the page closes — or, once
  // the task is done, fading in with the rest of Today (ftToday).
  const setFocusPageOpen = useFocusPageStore((store) => store.setOpen);
  const [barBack, setBarBack] = useState(false);
  useEffect(() => {
    setFocusPageOpen(!closing && !barBack, barBack ? (reduceMotion ? FOCUS_FINISH.reducedMs : FOCUS_FINISH.todayInMs) : 0);
  }, [barBack, closing, reduceMotion, setFocusPageOpen]);
  useEffect(() => () => setFocusPageOpen(false), [setFocusPageOpen]);

  // Done: hold for the page's ending, then fade it out in place — no circle,
  // no card shape — while Today fades in under it (Next's todayOpacity).
  const sheet = useSharedValue(1);
  useEffect(() => {
    if (!finishing) return;
    const F = FOCUS_FINISH;
    sheet.set(
      withDelay(
        reduceMotion ? F.reducedAt : F.sheetOutAt,
        withTiming(0, { duration: reduceMotion ? F.reducedMs : F.sheetOutMs, easing: F.ease }, (finished) => {
          if (finished) scheduleOnRN(onExited);
        }),
      ),
    );
    const bar = setTimeout(() => setBarBack(true), reduceMotion ? F.reducedAt : F.todayInAt);
    return () => clearTimeout(bar);
  }, [finishing, onExited, reduceMotion, sheet]);
  // ftSheet: opacity 1 → 0, scale 1 → 0.97 about 50 % 40 %. A plain fade with Reduce Motion.
  const sheetStyle = useAnimatedStyle(() => ({
    opacity: sheet.value,
    transform: [{ scale: reduceMotion ? 1 : 0.97 + 0.03 * sheet.value }],
  }));

  useEffect(() => {
    if (closing) return;
    reveal.set(withTiming(1, { ...REVEAL_OPEN, duration: reduceMotion ? 0 : REVEAL_OPEN.duration }));
    const timer = setTimeout(() => setContentMounted(true), reduceMotion ? 0 : CONTENT_AT_MS);
    return () => clearTimeout(timer);
  }, [closing, reduceMotion, reveal]);

  useEffect(() => {
    if (!closing) return;
    const wait = reduceMotion ? 0 : CONTENT_OUT_MS;
    content.set(withTiming(0, { duration: wait, easing: MOTION.easing.exit }));
    // The card shows again under the circle as it starts to shrink.
    const landed = setTimeout(onLanded, wait);
    reveal.set(
      withDelay(
        wait,
        withTiming(0, { ...REVEAL_CLOSE, duration: reduceMotion ? 0 : REVEAL_CLOSE.duration }, (finished) => {
          if (finished) scheduleOnRN(onExited);
        }),
      ),
    );
    return () => clearTimeout(landed);
  }, [closing, content, onExited, onLanded, reduceMotion, reveal]);

  const circleStyle = useAnimatedStyle(() => ({ transform: [{ scale: reveal.value }] }));
  // The real backdrop — the session's gradient — takes over as the circle
  // fills the screen, and hands back to the circle first on the way out.
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(reveal.value, [0.75, 1], [0, 1], Extrapolation.CLAMP),
  }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: content.value * sheet.value,
    transform: [{ scale: reduceMotion ? 1 : 0.97 + 0.03 * sheet.value }],
  }));

  return (
    <>
      {/* Blocks the task stack while leaving the persistent tab bar outside this screen interactive. */}
      <View pointerEvents="auto" style={StyleSheet.absoluteFill} />
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { zIndex: 20, overflow: "hidden", transformOrigin: "50% 40%" }, sheetStyle]}
      >
        <Animated.View
          style={[
            {
              position: "absolute",
              left: center.x - radius,
              top: center.y - radius,
              width: radius * 2,
              height: radius * 2,
              borderRadius: radius,
              backgroundColor: SESSION_BACKDROP,
            },
            circleStyle,
          ]}
        />
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: SESSION_BACKDROP }, backdropStyle]} />
      </Animated.View>
      {contentMounted ? (
        <Animated.View
          pointerEvents={closing || finishing ? "none" : "auto"}
          style={[
            { position: "absolute", zIndex: 21, left: 0, top: 0, width: screenWidth, height: screenHeight, transformOrigin: "50% 40%" },
            contentStyle,
          ]}
        >
          <NextTaskCard
            task={focus.task}
            rank={focus.rank}
            focusMode
            onStart={() => {}}
            onComplete={() => {}}
            onCelebrated={onCelebrated}
            onFinishing={onFinishing}
            onDetails={() => onDetails(focus.task.id)}
            onBack={onBack}
          />
        </Animated.View>
      ) : null}
    </>
  );
}

/** After the last task's own sound has had its moment (lib/sounds.ts). */
const DAY_DONE_SOUND_DELAY_MS = 650;

// The gem's corner of the page (Final-Today.html): a 118-point band under the
// title, the gem drawn 42 above it and running down behind the cards.
// A size down from the mockup's 118 / 190 / -42 / 300 / -10 (the user's
// call, 2026-11-03: everything a little smaller on the phone).
const GEM_AREA_HEIGHT = 98;
const GEM_WIDTH = 158;
const GEM_TOP = -35;
const GLOW_SIZE = 250;
const GLOW_TOP = -8;

/** The one action under an empty state's message: a dark pill, or orange for adding a task. */
function EmptyStateButton({
  icon,
  label,
  onPress,
  accent = false,
}: {
  icon: "calendar" | "list" | "plus";
  label: string;
  onPress: () => void;
  accent?: boolean;
}) {
  return (
    <AnimatedPressable
      onPress={onPress}
      scaleTo={0.97}
      accessibilityRole="button"
      className={`mt-[8px] h-[44px] flex-row items-center justify-center gap-2 rounded-full px-[20px] ${accent ? "bg-accent" : "bg-ink"}`}
    >
      <AppIcon name={icon} size={16} strokeWidth={2.2} color="#FFFFFF" />
      <Text className="font-grotesk-bold text-[14px] text-white">{label}</Text>
    </AnimatedPressable>
  );
}

/** One side of the quiet Today / All switch. */
function ViewSwitchOption({
  label,
  count,
  selected,
  onPress,
}: {
  label: string;
  count: number;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <AnimatedPressable
      onPress={onPress}
      scaleTo={0.95}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${label}, ${count}`}
      className={`h-[21px] flex-row items-center gap-[4px] rounded-full px-[9px] ${selected ? "bg-ink" : ""}`}
    >
      <Text className={`font-grotesk-semibold text-[11px] ${selected ? "text-paper" : "text-ink-muted"}`}>{label}</Text>
      <Text className={`font-mono-bold text-[9.5px] ${selected ? "text-peach-on-dark" : "text-ink-muted"}`}>{count}</Text>
    </AnimatedPressable>
  );
}

export default function Next() {
  const colors = useColors();
  const t = useTranslation();
  const rtl = useRtlText();
  const router = useRouter();
  const tabBarHeight = useTabBarHeight();
  const reduceMotion = useReducedMotion();
  const rootRef = useRef<ComponentRef<typeof View>>(null);
  const startingSession = useRef(false);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  // While Magic mic is open over Today, the list as it was when it opened.
  const tasks = useVisibleTasks();
  // A session runs inside its own task's card (see NextTaskCard), so the
  // stack stays swipeable while the clock ticks.
  const activeSession = useSessionStore((state) => state.session);
  const startSession = useSessionStore((state) => state.start);
  const leaveSession = useSessionStore((state) => state.leave);

  // The gem and the routines' pulse only move while Today is the tab on screen.
  const [pageFocused, setPageFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setPageFocused(true);
      return () => setPageFocused(false);
    }, []),
  );

  const [activeIndex, setActiveIndex] = useState(0);
  const [rootSize, setRootSize] = useState({ width: windowWidth, height: windowHeight });
  // Cream at the top, so dark status bar icons. A focus session fills the
  // screen below the status bar, which stays on the cream.
  useStatusBarStyle("dark");
  const [focusState, setFocusState] = useState<FocusCardState | null>(null);
  const [focusClosing, setFocusClosing] = useState(false);
  // The closing session's shell is back over its card, so the card shows again under it.
  const [focusLanded, setFocusLanded] = useState(false);
  const handleFocusLanded = useCallback(() => setFocusLanded(true), []);
  // Done tapped in the session: the page plays its ending, then fades out
  // while Today — already up to date, the next task on top — fades in as it
  // is (constants/focusFinish.ts). Nothing on Today moves.
  const [focusFinishing, setFocusFinishing] = useState(false);
  const todayOpacity = useSharedValue(1);
  const todayStyle = useAnimatedStyle(() => ({ opacity: todayOpacity.value }));
  const handleFocusFinishing = useCallback(() => {
    const F = FOCUS_FINISH;
    setFocusFinishing(true);
    todayOpacity.set(0);
    todayOpacity.set(
      withDelay(
        reduceMotion ? F.reducedAt : F.todayInAt,
        withTiming(1, { duration: reduceMotion ? F.reducedMs : F.todayInMs, easing: F.ease }),
      ),
    );
  }, [reduceMotion, todayOpacity]);

  // The task on top last time, so a point or two of score drift (the clock
  // moving on) doesn't swap it for another — see recommendTasks.
  const [stickyTopId, setStickyTopId] = useState<string | undefined>(undefined);
  // The task whose card is showing — the card follows its task, not its place.
  const [followedId, setFollowedId] = useState<string | undefined>(undefined);

  // The day the page is for — it moves on at midnight, on coming back to the
  // app and on coming back to the tab, so a phone left open overnight shows
  // the new day.
  const dayKey = useToday();

  // Routines (lib/recurrence.ts isRoutine) are never one of the cards, nor in
  // the progress bar: they're listed under the cards instead (TodayRoutines).
  // Repeating tasks that aren't routines stay cards, like any task.
  const cardTasks = useMemo(() => tasks.filter((task) => !isRoutine(task)), [tasks]);
  const routines = useMemo(() => routinesFor(tasks, dayKey), [tasks, dayKey]);

  // Today's list (lib/schedule.ts buildToday): the open tasks due today, the
  // late ones carried over from earlier days until they're done (the user's
  // call, 2026-10-26 — before, a task missed yesterday never showed here
  // again), and what's been finished. Tasks without a deadline aren't on it.
  const today = useMemo(() => buildToday(cardTasks, { now: new Date(), today: dayKey }), [cardTasks, dayKey]);

  // "Today" or "All tasks": the same stack of cards, either today's list or
  // every open task, so any task can be picked up and focused on from here.
  const [view, setView] = useState<"today" | "all">("today");
  const showAll = view === "all";

  // Every open task, best first: pinned ones ahead, then the priority
  // engine's ranking.
  const rankedTasks = useMemo(
    () => recommendTasks(cardTasks, { now: new Date() }, stickyTopId).map((entry) => entry.task),
    [cardTasks, stickyTopId],
  );
  // Today's tasks, in that order — only today's, even when none are left or
  // none were due: other days' tasks are under "All tasks" (the user's call,
  // 2026-10-29; Today used to fill an empty day with them). A task with a
  // session running on it always stays — its card is the way back into it.
  const pendingTasks = useMemo(
    () =>
      showAll
        ? rankedTasks
        : rankedTasks.filter((task) => today.ids.has(task.id) || activeSession?.taskIds.includes(task.id)),
    [rankedTasks, today, activeSession, showAll],
  );

  const total = pendingTasks.length;

  // The card follows its task, not its position: if the ranking moves while
  // it's on screen (a task added, a score changing) the same task stays up.
  // If it's gone — finished, snoozed, archived — the one that took its place
  // in the ranking comes up, which is the next best thing to do.
  const followedIndex = followedId ? pendingTasks.findIndex((task) => task.id === followedId) : -1;
  const currentIndex = total === 0 ? 0 : followedIndex >= 0 ? followedIndex : Math.min(activeIndex, total - 1);
  const currentTask = pendingTasks[currentIndex];
  const focusedTask = focusState
    ? tasks.find((task) => task.id === focusState.task.id) ?? focusState.task
    : undefined;

  // Kept in step during render (React's "adjusting state when a prop
  // changes"), not in an effect, so the stack never draws a frame out of step.
  // Each only changes when what it tracks does, so this settles in one pass.
  const topId = pendingTasks[0]?.id;
  if (topId !== stickyTopId) setStickyTopId(topId);
  if (currentTask?.id !== followedId) setFollowedId(currentTask?.id);
  if (currentIndex !== activeIndex) setActiveIndex(currentIndex);

  // A swipe or the Previous/Next buttons: follow the task that's now showing.
  const handleIndexChange = useCallback((index: number) => {
    setFollowedId(pendingTasks[index]?.id);
    setActiveIndex(index);
  }, [pendingTasks]);

  // The session's card is gone once its task is finished or deleted — nothing
  // is left to show the clock, so the session ends with it. Checked against
  // every open task, not just today's — a routine's too, started from its page.
  useEffect(() => {
    if (!activeSession) return;
    const stillRunning = tasks.some((task) => task.status === "pending" && activeSession.taskIds.includes(task.id));
    if (!stillRunning) leaveSession();
  }, [activeSession, tasks, leaveSession]);

  // Finished in the session, the card closes it itself once its celebration
  // has played (onCelebrated), before the task is marked done. This catches
  // the rest: the session ended, or the task was finished somewhere else.
  useEffect(() => {
    // Done in the session: the page closes itself once its ending has played.
    if (!focusState || focusClosing || focusFinishing) return;
    const stillFocused = activeSession?.taskIds.includes(focusState.task.id) ?? false;
    if (focusedTask?.status === "completed" || !stillFocused) {
      const timer = setTimeout(() => setFocusClosing(true), 0);
      return () => clearTimeout(timer);
    }
  }, [activeSession, focusClosing, focusFinishing, focusState, focusedTask?.status]);

  const handleFocusCelebrated = useCallback(() => setFocusClosing(true), []);

  const measureInRoot = useCallback((bounds: CardBounds, onMeasured: (localBounds: CardBounds) => void) => {
    const root = rootRef.current;
    if (!root) {
      onMeasured(bounds);
      return;
    }
    let measured = false;
    const fallback = setTimeout(() => {
      if (measured) return;
      measured = true;
      onMeasured(bounds);
    }, 120);
    root.measureInWindow((x, y) => {
      if (measured) return;
      measured = true;
      clearTimeout(fallback);
      onMeasured({ ...bounds, x: bounds.x - x, y: bounds.y - y });
    });
  }, []);

  const handleFocusBoundsChange = useCallback((taskId: string, bounds: CardBounds) => {
    measureInRoot(bounds, (localBounds) => {
      setFocusState((current) => {
        if (!current) return current;
        const belongsToFocusedTask = current.task.id === taskId;
        const belongsToNextCard = !activeSession?.taskIds.includes(current.task.id) && currentTask?.id === taskId;
        return belongsToFocusedTask || belongsToNextCard ? { ...current, returnBounds: localBounds } : current;
      });
    });
  }, [activeSession, currentTask?.id, measureInRoot]);

  const handleStartSession = useCallback((task: Task, plannedMinutes: number, bounds?: CardBounds) => {
    if (startingSession.current) return;
    startingSession.current = true;

    const begin = (origin: CardBounds) => {
      // A card whose session is already running (say, after the app was
      // closed mid-session) reopens it rather than starting the clock again.
      const resuming = useSessionStore.getState().session?.taskIds.includes(task.id) ?? false;
      if (!resuming) {
        posthog.capture("session_started", {
          available_minutes: plannedMinutes,
          task_count: 1,
        });
        startSession({ taskIds: [task.id], plannedMinutes, energy: "ready" });
        playSound("sessionStart");
      }
      setFocusClosing(false);
      setFocusLanded(false);
      // Its place among today's tasks — or, for one started from Task Details
      // that isn't due today, among every open task.
      const todayIndex = pendingTasks.findIndex((entry) => entry.id === task.id);
      const taskIndex = todayIndex >= 0 ? todayIndex : rankedTasks.findIndex((entry) => entry.id === task.id);
      setFocusState({ task, rank: Math.max(1, taskIndex + 1), origin, returnBounds: origin });
      startingSession.current = false;
    };

    if (bounds) {
      measureInRoot(bounds, begin);
    } else {
      begin({ x: 0, y: 0, width: rootSize.width, height: rootSize.height });
    }
  }, [measureInRoot, pendingTasks, rankedTasks, rootSize.height, rootSize.width, startSession]);

  // Task Details' Start session (any task — no deadline, another day): it
  // asks, and the session opens here, full screen, as if started from a card.
  // The task's card joins the stack while its session runs.
  const openRequest = useSessionStore((state) => state.openRequest);
  const clearOpenRequest = useSessionStore((state) => state.clearOpenRequest);
  useEffect(() => {
    if (!openRequest) return;
    clearOpenRequest();
    const task = tasks.find((entry) => entry.id === openRequest.taskId && entry.status === "pending");
    if (task) handleStartSession(task, openRequest.plannedMinutes);
  }, [clearOpenRequest, handleStartSession, openRequest, tasks]);

  // A task's details: the edit card, over the page (the old Task Details page is gone).
  const [editingId, setEditingId] = useState<string | null>(null);
  const handleDetails = useCallback((taskId: string) => setEditingId(taskId), []);

  const clearFocus = useCallback(() => {
    setFocusState(null);
    setFocusClosing(false);
    setFocusLanded(false);
    setFocusFinishing(false);
  }, []);

  // "Done for today" → the days ahead, on the Calendar tab.
  const openSchedule = () => {
    posthog.capture("schedule_opened", { from: "next" });
    router.navigate("/calendar");
  };

  const openInsights = () => {
    posthog.capture("insights_opened", { from: "today" });
    router.push("/insights");
  };

  // Done against what's left of today's tasks — not a session's task from
  // another day. The card shows once there's a day to measure: anything due
  // today, open or done.
  const todayLeft = today.ids.size;
  const todayTotal = today.done + todayLeft;
  const dateLabel = keyToLocalDate(dayKey).toLocaleDateString(t.locale, { weekday: "long", month: "long", day: "numeric" });

  // The last of today's tasks done: a short chime, a beat after the task's
  // own sound. Only on that change, seen here — not on opening the app to a
  // day already finished, and not when the day itself moves on.
  const previousLeft = useRef({ dayKey, left: todayLeft });
  useEffect(() => {
    const before = previousLeft.current;
    previousLeft.current = { dayKey, left: todayLeft };
    if (before.dayKey !== dayKey || before.left === 0 || todayLeft !== 0 || today.done === 0) return;
    const timer = setTimeout(() => playSound("dayDone"), DAY_DONE_SOUND_DELAY_MS);
    return () => clearTimeout(timer);
  }, [dayKey, todayLeft, today.done]);

  // The gem (Final-Today.html) is today's progress: grey and asleep with
  // nothing done, on fire once (nearly) everything is. With nothing due
  // today it's simply awake. Tapping it opens Insights — the way in since the
  // progress card it replaces (2026-11-02).
  const gemLevel = todayTotal > 0 ? gemLevelFor(today.done, todayTotal) : 3;

  // The page says what it is at the top: today's date over "Today", and the
  // + to add a task by hand (here since 2026-11-02, when Magic mic took the
  // middle of the tab bar). The whole page scrolls as one, so the gem's
  // light and flame can reach up behind the title as in the mockup.
  const header = (
    <View className="flex-row items-end justify-between gap-3 px-[20px] pt-[6px]">
      <View className="shrink">
        <Text numberOfLines={1} className="font-grotesk-regular text-[13px] text-ink-muted" style={rtl}>
          {dateLabel}
        </Text>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          className="mt-[1px] font-grotesk-bold text-[33px] leading-[37px] tracking-[-1px] text-ink"
          style={rtl}
        >
          {t.next.today}
        </Text>
      </View>
      <AnimatedPressable
        onPress={() => openAddSheet()}
        scaleTo={0.92}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={t.tasks.addTask}
        className="h-[40px] w-[40px] items-center justify-center rounded-full bg-ink"
      >
        <AppIcon name="plus" size={19} strokeWidth={2.4} color="#FFFFFF" />
      </AnimatedPressable>
    </View>
  );

  // The gem's band under the title — and, tucked into its left corner, the
  // quiet switch between today's cards and every open task (the user's call,
  // 2026-11-03: off the title row, but still there).
  const gemArea = (
    <View style={{ height: GEM_AREA_HEIGHT }}>
      <View pointerEvents="none" className="absolute left-0 right-0 items-center" style={{ top: GLOW_TOP }}>
        {/* No glow while the gem is still grey or bronze (levels 1–2, the user's call 2026-11-03). */}
        {gemLevel >= 3 ? <GemGlow size={GLOW_SIZE} animate={pageFocused} /> : null}
      </View>
      <AnimatedPressable
        onPress={openInsights}
        scaleTo={0.96}
        accessibilityRole="button"
        accessibilityLabel={todayTotal > 0 ? t.next.todayProgress(today.done, todayTotal) : t.next.nothingToday}
        accessibilityHint={t.insights.open}
        className="absolute self-center"
        style={{ top: GEM_TOP }}
      >
        {/* A level-up waits until it can be seen: Today on screen, no focus page over it. */}
        <GemMascot level={gemLevel} width={GEM_WIDTH} animate={pageFocused} holdLevelUps={!pageFocused || focusState !== null} />
      </AnimatedPressable>
      {rankedTasks.length > 0 || showAll ? (
        <View
          accessibilityRole="radiogroup"
          className="absolute left-[20px] top-[6px] h-[26px] flex-row items-center rounded-full border-[1.5px] border-line bg-paper-card px-[1.5px]"
        >
          <ViewSwitchOption label={t.next.today} count={todayLeft} selected={!showAll} onPress={() => setView("today")} />
          <ViewSwitchOption
            label={t.next.allShort}
            count={rankedTasks.length}
            selected={showAll}
            onPress={() => {
              if (!showAll) posthog.capture("today_all_tasks_opened");
              setView("all");
            }}
          />
        </View>
      ) : null}
    </View>
  );

  // Under the cards, on the Today view only — "All tasks" is the cards alone.
  const routineList = showAll ? null : (
    <RoutineTimeline routines={routines} onOpen={handleDetails} onAdd={() => openAddSheet()} animate={pageFocused} />
  );

  // Both of Today's faces sit in one tree with the focus page over them, so a
  // session finished on the last task keeps its page (and its ending) mounted
  // while Today turns into "Done for today" underneath.
  const emptyState = !currentTask && (!focusState || focusFinishing);
  let body: ReactNode;
  if (emptyState) {
    // No card left. On Today: today's tasks are all done — or none were due
    // and the routines are all ticked — "Done for today"; none were due and
    // routines are still open — just the routines; none were due at all —
    // "Nothing due today", with the way to every other task. No open task
    // anywhere (or the All tasks view, empty): "All caught up". The gem
    // stays at the top either way: it's the day's progress.
    const hasRoutines = !showAll && routines.length > 0;
    const routinesDone = hasRoutines && routines.every((task) => task.status === "completed");
    const finishedToday = !showAll && (todayTotal > 0 || routinesDone);
    const routinesOnly = !showAll && !finishedToday && hasRoutines;
    const nothingDue = !showAll && !finishedToday && !hasRoutines && rankedTasks.length > 0;
    body = (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 28 + tabBarHeight }}
          showsVerticalScrollIndicator={false}
        >
          {header}
          {gemArea}
          {routinesOnly ? null : (
            // Faded in rather than cut to: it usually arrives the moment the last task is done.
            <Animated.View
              entering={reduceMotion ? undefined : FadeIn.duration(MOTION.duration.screen)}
              // Clear of the gem's foot, which reaches below its band.
              className="items-center gap-[6px] px-[20px] pt-[44px]"
            >
              <Text className="text-center font-grotesk-bold text-[19px] tracking-[-0.38px] text-ink" style={rtl}>
                {finishedToday ? t.next.doneForToday : nothingDue ? t.next.nothingToday : t.next.allCaughtUp}
              </Text>
              {nothingDue ? null : (
                <Text className="text-center font-grotesk-regular text-[13px] leading-[19px] text-ink-muted" style={rtl}>
                  {finishedToday ? t.next.doneForTodayBody : t.next.allCaughtUpBody}
                </Text>
              )}
              {finishedToday ? (
                <EmptyStateButton icon="calendar" label={t.next.openSchedule} onPress={openSchedule} />
              ) : nothingDue ? (
                <EmptyStateButton icon="list" label={t.next.viewAll(rankedTasks.length)} onPress={() => setView("all")} />
              ) : (
                <EmptyStateButton icon="plus" label={t.next.addATask} onPress={() => openAddSheet()} accent />
              )}
            </Animated.View>
          )}
          {routineList ? <View className={routinesOnly ? "mt-[44px]" : "mt-[24px]"}>{routineList}</View> : null}
        </ScrollView>
    );
  } else {
    body = (
        <ScrollView
          // Clear of the tab bar, which floats over the foot of the page.
          contentContainerStyle={{ paddingBottom: 28 + tabBarHeight }}
          showsVerticalScrollIndicator={false}
        >
          {header}
          {gemArea}
          {currentTask ? (
            <NextTaskCardStack
              tasks={pendingTasks}
              currentIndex={currentIndex}
              onIndexChange={handleIndexChange}
              onStart={handleStartSession}
              onDetails={handleDetails}
              focusTaskId={focusState && !focusLanded ? focusState.task.id : undefined}
              onFocusBoundsChange={handleFocusBoundsChange}
              animateTodayCompletion={!showAll}
            />
          ) : null}
          {routineList ? <View className="mt-[24px]">{routineList}</View> : null}
        </ScrollView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.palette.paper }} edges={["top"]}>
      <View ref={rootRef} style={{ flex: 1 }} onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setRootSize((current) => current.width === width && current.height === height ? current : { width, height });
      }}>
      <Animated.View style={[{ flex: 1 }, todayStyle]}>{body}</Animated.View>
      {focusState && focusedTask ? (
        <FocusCardTransition
          focus={{ ...focusState, task: focusedTask }}
          screenWidth={rootSize.width}
          screenHeight={rootSize.height}
          closing={focusClosing}
          finishing={focusFinishing}
          onLanded={handleFocusLanded}
          onExited={clearFocus}
          onCelebrated={handleFocusCelebrated}
          onFinishing={handleFocusFinishing}
          onDetails={handleDetails}
          onBack={handleFocusCelebrated}
        />
      ) : null}
      </View>
      <TaskEditModal taskId={editingId} onClose={() => setEditingId(null)} />
    </SafeAreaView>
  );
}
