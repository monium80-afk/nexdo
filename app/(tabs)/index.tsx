import { Feather, Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { PrimaryButton, SecondaryButton, TextButton } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { GemLogo } from "@/components/GemLogo";
import { NextTaskCard, type CardBounds } from "@/components/NextTaskCard";
import { NextTaskCardStack } from "@/components/NextTaskCardStack";
import { useTabBarHeight } from "@/components/TabBar";
import { MOTION, gradients } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { keyToLocalDate, toLocalDateKey } from "@/lib/localDate";
import { posthog } from "@/lib/posthog";
import { recommendTasks } from "@/lib/priority";
import { buildSchedule } from "@/lib/schedule";
import { useSessionStore } from "@/store/useSessionStore";
import { useTaskStore } from "@/store/useTaskStore";
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
const SESSION_BACKDROP = "#201E1C";

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
  onLanded,
  onExited,
  onCelebrated,
  onDetails,
}: {
  focus: FocusCardState;
  screenWidth: number;
  screenHeight: number;
  closing: boolean;
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
  const contentStyle = useAnimatedStyle(() => ({ opacity: content.value }));

  return (
    <>
      {/* Blocks the task stack while leaving the persistent tab bar outside this screen interactive. */}
      <View pointerEvents="auto" style={StyleSheet.absoluteFill} />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 20, overflow: "hidden" }]}>
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
        <Animated.View style={[StyleSheet.absoluteFill, gradients.session, backdropStyle]} />
      </View>
      {contentMounted ? (
        <Animated.View
          pointerEvents={closing ? "none" : "auto"}
          style={[{ position: "absolute", zIndex: 21, left: 0, top: 0, width: screenWidth, height: screenHeight }, contentStyle]}
        >
          <NextTaskCard
            task={focus.task}
            rank={focus.rank}
            focusMode
            onStart={() => {}}
            onComplete={() => {}}
            onCelebrated={onCelebrated}
            onDetails={() => onDetails(focus.task.id)}
          />
        </Animated.View>
      ) : null}
    </>
  );
}

const PROGRESS_MS = 650;
// Pressed into the card, like the setup bar (SetupProgressBar).
const TRACK_INSET = { boxShadow: "inset 0 1px 3px rgba(92, 58, 26, 0.16)" };

/**
 * Today at a glance, under the page's title: how many of today's tasks are
 * left, how many are done, and one thick bar that fills a step each time one
 * is finished. Full — and green — means nothing is left for today. No hours
 * of work left (the user's call, 2026-10-08): a guess at the day's length
 * read as a promise, and tasks without a set time made it wrong anyway.
 */
function TodayCard({ done, left }: { done: number; left: number }) {
  const t = useTranslation();
  const colors = useColors();
  const reduceMotion = useReducedMotion();
  const total = done + left;
  const fraction = total > 0 ? Math.min(1, done / total) : 0;
  const finished = total > 0 && left === 0;
  const fill = useSharedValue(fraction);
  // The track's width, so the fill can slide in from the left as a whole pill
  // — its rounded end stays round at any length, which scaling would squash.
  const trackWidth = useSharedValue(0);

  useEffect(() => {
    fill.set(withTiming(fraction, { duration: reduceMotion ? 0 : PROGRESS_MS, easing: MOTION.easing.enter }));
  }, [fill, fraction, reduceMotion]);

  // A transform, not a width: it stays on the UI thread (see SetupProgressBar).
  const fillStyle = useAnimatedStyle(() => ({
    opacity: trackWidth.value > 0 ? 1 : 0,
    transform: [{ translateX: (fill.value - 1) * trackWidth.value }],
  }));

  return (
    <View className="card card--cream-soft gap-3 px-4 pb-4 pt-3.5" style={gradients.card}>
      <View className="flex-row items-center justify-between gap-3">
        <View className="shrink flex-row items-center gap-2">
          {finished ? <Feather name="check-circle" size={17} color={colors.success[500]} /> : null}
          <Text className={`font-grotesk-bold text-[17px] ${finished ? "text-success-500" : "text-ink-cream"}`}>
            {finished ? t.next.doneForToday : t.next.tasksLeft(left)}
          </Text>
        </View>
        <Text className="font-grotesk-semibold text-[13px] text-ink-cream-muted">{t.next.doneOfTotal(done, total)}</Text>
      </View>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={t.next.todayProgress(done, total)}
        accessibilityValue={{ min: 0, max: total, now: done }}
        onLayout={(event) => trackWidth.set(event.nativeEvent.layout.width)}
        className="h-[14px] overflow-hidden rounded-full bg-cream-200"
        style={TRACK_INSET}
      >
        <Animated.View
          className={`h-full w-full rounded-full ${finished ? "bg-success-500" : "bg-orange-500"}`}
          style={[finished ? gradients.success : gradients.accent, fillStyle]}
        />
      </View>
    </View>
  );
}

export default function Next() {
  const colors = useColors();
  const t = useTranslation();
  const rtl = useRtlText();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useTabBarHeight();
  const reduceMotion = useReducedMotion();
  const rootRef = useRef<View>(null);
  const startingSession = useRef(false);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const tasks = useTaskStore((state) => state.tasks);
  // A session runs inside its own task's card (see NextTaskCard), so the
  // stack stays swipeable while the clock ticks.
  const activeSession = useSessionStore((state) => state.session);
  const startSession = useSessionStore((state) => state.start);
  const leaveSession = useSessionStore((state) => state.leave);

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

  // The task on top last time, so a point or two of score drift (the clock
  // moving on) doesn't swap it for another — see recommendTasks.
  const [stickyTopId, setStickyTopId] = useState<string | undefined>(undefined);
  // The task whose card is showing — the card follows its task, not its place.
  const [followedId, setFollowedId] = useState<string | undefined>(undefined);

  // The day the page is for — checked again whenever the tab comes back into
  // view, so a phone left open overnight moves on to the new day.
  const [dayKey, setDayKey] = useState(() => toLocalDateKey(new Date()));
  useFocusEffect(
    useCallback(() => {
      setDayKey(toLocalDateKey(new Date()));
    }, []),
  );

  // Today, as the Schedule shows it (lib/schedule.ts): the open tasks due
  // today and the ones due today already done. Late tasks stay on the day
  // they were due, and tasks without a deadline aren't on any day — neither
  // is on this page (the user's call, 2026-10-07).
  const today = useMemo(() => {
    const now = new Date();
    const key = toLocalDateKey(now);
    const [plan] = buildSchedule(tasks, { now, from: key, until: key });
    return {
      ids: new Set(plan.items.map((item) => item.task.id)),
      done: plan.done.length,
    };
    // dayKey isn't read: it's there to work today out again on a new day.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, dayKey]);

  // Every open task, best first: pinned ones ahead, then the priority
  // engine's ranking.
  const rankedTasks = useMemo(
    () => recommendTasks(tasks, { now: new Date() }, stickyTopId).map((entry) => entry.task),
    [tasks, stickyTopId],
  );
  // Today's tasks, in that order. A task with a session running on it always
  // stays — its card is the way back into the session, and a session started
  // from Task Details on a task due another day (or never) runs here too.
  const pendingTasks = useMemo(
    () => rankedTasks.filter((task) => today.ids.has(task.id) || activeSession?.taskIds.includes(task.id)),
    [rankedTasks, today, activeSession],
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
  // every open task, not just today's.
  useEffect(() => {
    if (!activeSession) return;
    const stillRunning = rankedTasks.some((task) => activeSession.taskIds.includes(task.id));
    if (!stillRunning) leaveSession();
  }, [activeSession, rankedTasks, leaveSession]);

  // Finished in the session, the card closes it itself once its celebration
  // has played (onCelebrated), before the task is marked done. This catches
  // the rest: the session ended, or the task was finished somewhere else.
  useEffect(() => {
    if (!focusState || focusClosing) return;
    const stillFocused = activeSession?.taskIds.includes(focusState.task.id) ?? false;
    if (focusedTask?.status === "completed" || !stillFocused) {
      const timer = setTimeout(() => setFocusClosing(true), 0);
      return () => clearTimeout(timer);
    }
  }, [activeSession, focusClosing, focusState, focusedTask?.status]);

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

  const handleDetails = useCallback((taskId: string) => {
    router.push({ pathname: "/task/[id]", params: { id: taskId } });
  }, [router]);

  const clearFocus = useCallback(() => {
    setFocusState(null);
    setFocusClosing(false);
    setFocusLanded(false);
  }, []);

  const openSchedule = () => {
    posthog.capture("schedule_opened", { from: "next" });
    router.push("/schedule");
  };

  // Done against what's left of today's tasks — not a session's task from
  // another day. The card shows once there's a day to measure: anything due
  // today, open or done.
  const todayLeft = pendingTasks.filter((task) => today.ids.has(task.id)).length;
  const todayTotal = today.done + todayLeft;
  const dateLabel = keyToLocalDate(dayKey).toLocaleDateString(t.locale, { weekday: "long", month: "long", day: "numeric" });

  // The page says what it is at the top: today's date over "Today", then
  // today's progress — so it reads as today's list, not the whole backlog.
  const header = (
    <>
      {/* Warm light from the top-right corner, running up under the status bar. */}
      <View
        pointerEvents="none"
        className="absolute left-0 right-0"
        style={[{ top: -insets.top, height: 420 + insets.top }, gradients.creamGlow]}
      />

      <View className="px-6 pb-1 pt-2">
        <View className="flex-row items-start gap-3">
          <View className="flex-1">
            <View className="flex-row items-center gap-1.5">
              <GemLogo size={16} />
              <Text className="eyebrow text-orange-500">{dateLabel}</Text>
            </View>
            <Text className="mt-1 font-grotesk-bold text-[30px] leading-[36px] tracking-tight text-ink-cream" style={rtl}>
              {t.next.today}
            </Text>
          </View>
          {/* The one way into the Schedule: the week ahead, day by day. */}
          <Chip
            label={t.next.schedule}
            icon={() => <Feather name="calendar" size={14} color={colors.orange[500]} />}
            onPress={openSchedule}
            className="mt-1"
          />
        </View>
        {todayTotal > 0 ? (
          <View className="mt-4">
            <TodayCard done={today.done} left={todayLeft} />
          </View>
        ) : null}
      </View>
    </>
  );

  if (!currentTask && !focusState) {
    // Nothing left for today: all of today's tasks are done (the bar is
    // full), or none is due today while there are open tasks elsewhere — on
    // other days, late, or without a deadline — or no open task at all.
    const finishedToday = today.done > 0;
    const laterOnly = !finishedToday && rankedTasks.length > 0;
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream[100] }} edges={["top"]}>
        {header}
        {/* Faded in rather than cut to: it usually arrives the moment the last task is done. */}
        <Animated.View
          entering={reduceMotion ? undefined : FadeIn.duration(MOTION.duration.screen)}
          className="flex-1 items-center justify-center gap-3 px-6"
          // Centred in what the tab bar leaves showing.
          style={{ paddingBottom: tabBarHeight }}
        >
          <View
            className={`tile h-[52px] w-[52px] rounded-[16px] ${finishedToday ? "tile--green" : "tile--orange"}`}
            style={finishedToday ? gradients.tileGreen : gradients.tileOrange}
          >
            <Ionicons
              name={laterOnly ? "calendar-outline" : "checkmark-done"}
              size={26}
              color={finishedToday ? colors.success[500] : colors.orange[500]}
            />
          </View>
          <Text className="text-card-title text-center text-ink-cream">
            {finishedToday ? t.next.doneForToday : laterOnly ? t.next.nothingToday : t.next.allCaughtUp}
          </Text>
          <Text className="text-body text-center text-ink-cream-muted">
            {finishedToday ? t.next.doneForTodayBody : laterOnly ? t.next.nothingTodayBody : t.next.allCaughtUpBody}
          </Text>
          {finishedToday || laterOnly ? (
            <>
              <SecondaryButton icon="calendar" size="lg" label={t.next.openSchedule} onPress={openSchedule} className="mt-2" />
              {/* Tasks without a deadline are on no day — this is the way to them. */}
              {laterOnly ? (
                <TextButton label={t.next.seeTasks} tone="accent" onPress={() => router.navigate("/tasks")} />
              ) : null}
            </>
          ) : (
            <PrimaryButton icon="plus" size="lg" label={t.next.addATask} onPress={() => router.push("/add")} className="mt-2" />
          )}
        </Animated.View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream[100] }} edges={["top"]}>
      <View ref={rootRef} style={{ flex: 1 }} onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setRootSize((current) => current.width === width && current.height === height ? current : { width, height });
      }}>
      {header}

      <View className="flex-1">
        <ScrollView
          // Clear of the tab bar, which floats over the foot of the page.
          contentContainerStyle={{ paddingTop: 18, paddingBottom: 28 + tabBarHeight }}
          showsVerticalScrollIndicator={false}
        >
          {currentTask ? (
            <NextTaskCardStack
              tasks={pendingTasks}
              currentIndex={currentIndex}
              onIndexChange={handleIndexChange}
              onStart={handleStartSession}
              onDetails={handleDetails}
              focusTaskId={focusState && !focusLanded ? focusState.task.id : undefined}
              onFocusBoundsChange={handleFocusBoundsChange}
            />
          ) : null}
        </ScrollView>
      </View>
      {focusState && focusedTask ? (
        <FocusCardTransition
          focus={{ ...focusState, task: focusedTask }}
          screenWidth={rootSize.width}
          screenHeight={rootSize.height}
          closing={focusClosing}
          onLanded={handleFocusLanded}
          onExited={clearFocus}
          onCelebrated={handleFocusCelebrated}
          onDetails={handleDetails}
        />
      ) : null}
      </View>
    </SafeAreaView>
  );
}
