import { Feather, Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { SafeAreaView } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { GemLogo } from "@/components/GemLogo";
import { NextTaskCard, type CardBounds } from "@/components/NextTaskCard";
import { NextTaskCardStack } from "@/components/NextTaskCardStack";
import { MOTION } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDuration } from "@/lib/formatDuration";
import { posthog } from "@/lib/posthog";
import { recommendTasks } from "@/lib/priority";
import { useSessionStore } from "@/store/useSessionStore";
import { useTaskStore } from "@/store/useTaskStore";
import type { Task } from "@/types/task";

type FocusCardState = {
  task: Task;
  rank: number;
  origin: CardBounds;
  returnBounds: CardBounds;
};

function FocusCardTransition({
  focus,
  screenWidth,
  screenHeight,
  closing,
  onExited,
  onDetails,
}: {
  focus: FocusCardState;
  screenWidth: number;
  screenHeight: number;
  closing: boolean;
  onExited: () => void;
  onDetails: (taskId: string) => void;
}) {
  const colors = useColors();
  const reduceMotion = useReducedMotion();
  const x = useSharedValue(focus.origin.x);
  const y = useSharedValue(focus.origin.y);
  const width = useSharedValue(focus.origin.width);
  const height = useSharedValue(focus.origin.height);
  const radius = useSharedValue(24);

  useEffect(() => {
    if (closing) return;
    const target = { x: 0, y: 0, width: screenWidth, height: screenHeight };
    const config = {
      duration: reduceMotion ? 0 : MOTION.duration.screen,
      easing: MOTION.easing.standard,
    };
    x.set(withTiming(target.x, config));
    y.set(withTiming(target.y, config));
    width.set(withTiming(target.width, config));
    height.set(withTiming(target.height, config));
    radius.set(withTiming(0, config));
  }, [closing, height, radius, reduceMotion, screenHeight, screenWidth, width, x, y]);

  useEffect(() => {
    if (!closing) return;
    const target = focus.returnBounds;
    const config = {
      duration: reduceMotion ? 0 : MOTION.duration.screen,
      easing: MOTION.easing.standard,
    };
    x.set(withTiming(target.x, config));
    y.set(withTiming(target.y, config));
    width.set(withTiming(target.width, config));
    height.set(withTiming(target.height, config, (finished) => {
      if (finished) scheduleOnRN(onExited);
    }));
    radius.set(withTiming(24, config));
  }, [closing, focus.returnBounds, height, onExited, radius, reduceMotion, width, x, y]);

  const cardStyle = useAnimatedStyle(() => ({
    left: x.value,
    top: y.value,
    width: width.value,
    height: height.value,
    borderRadius: radius.value,
  }));

  return (
    <>
      {/* Blocks the task stack while leaving the persistent tab bar outside this screen interactive. */}
      <View pointerEvents="auto" style={StyleSheet.absoluteFill} />
      <Animated.View
        style={[
          {
            position: "absolute",
            zIndex: 20,
            overflow: "hidden",
            backgroundColor: colors.charcoal[900],
            borderWidth: 1,
            borderColor: colors.hairlineCharcoal,
          },
          cardStyle,
        ]}
      >
        <NextTaskCard
          task={focus.task}
          rank={focus.rank}
          focusMode
          onStart={() => {}}
          onDetails={() => onDetails(focus.task.id)}
        />
      </Animated.View>
    </>
  );
}

/** "01", "12" — the queue counter keeps two digits so it doesn't jump in width at 10. */
const twoDigits = (value: number) => String(value).padStart(2, "0");

export default function Next() {
  const colors = useColors();
  const t = useTranslation();
  const rtl = useRtlText();
  const router = useRouter();
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
  const [focusState, setFocusState] = useState<FocusCardState | null>(null);
  const [focusClosing, setFocusClosing] = useState(false);

  // "I've only got 20 minutes" in the AI chat routes here carrying that budget
  // (see REDIRECT_NEXT in lib/ai/classifyIntent.ts). Without reading it back
  // out the redirect was just an ordinary tab switch.
  const { minutes } = useLocalSearchParams<{ minutes?: string }>();
  const parsedMinutes = minutes ? Number.parseInt(minutes, 10) : Number.NaN;
  const activeBudget = Number.isFinite(parsedMinutes) && parsedMinutes > 0 ? parsedMinutes : undefined;

  // The task on top last time, so a point or two of score drift (the clock
  // moving on) doesn't swap it for another — see recommendTasks.
  const [stickyTopId, setStickyTopId] = useState<string | undefined>(undefined);
  // The task whose card is showing — the card follows its task, not its place.
  const [followedId, setFollowedId] = useState<string | undefined>(undefined);

  // What to do next, best first: open tasks only (never completed, skipped or
  // archived), pinned ones ahead, then the priority engine's ranking — which
  // counts how well each fits the time budget, when one was given.
  const allPendingTasks = useMemo(
    () => recommendTasks(tasks, { now: new Date(), availableMinutes: activeBudget }, stickyTopId).map((entry) => entry.task),
    [tasks, activeBudget, stickyTopId],
  );
  // Narrowed to what actually fits the stated window — but never down to an
  // empty screen: if nothing fits, the whole queue is better than nothing,
  // and the banner says so.
  const fittingTasks = useMemo(
    () =>
      activeBudget === undefined
        ? allPendingTasks
        : allPendingTasks.filter(
            (task) =>
              // A task with a session running on it is never filtered away:
              // the clock, and the only way to stop it, live in that card.
              activeSession?.taskIds.includes(task.id) ||
              (task.estimatedMinutes > 0 && task.estimatedMinutes <= activeBudget),
          ),
    [allPendingTasks, activeBudget, activeSession],
  );
  const budgetHasMatches =
    activeBudget === undefined || allPendingTasks.some(
      (task) => task.estimatedMinutes > 0 && task.estimatedMinutes <= activeBudget,
    );
  const pendingTasks = budgetHasMatches ? fittingTasks : allPendingTasks;
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
  const topId = allPendingTasks[0]?.id;
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
  // every pending task, not the ones the time filter is showing: a running
  // task that simply doesn't fit the stated window is still running.
  useEffect(() => {
    if (!activeSession) return;
    const stillRunning = allPendingTasks.some((task) => activeSession.taskIds.includes(task.id));
    if (!stillRunning) leaveSession();
  }, [activeSession, allPendingTasks, leaveSession]);

  useEffect(() => {
    if (!focusState || focusClosing) return;
    if (focusedTask?.status === "completed") {
      const timer = setTimeout(() => setFocusClosing(true), 1100);
      return () => clearTimeout(timer);
    }
    const stillFocused = activeSession?.taskIds.includes(focusState.task.id) ?? false;
    if (!stillFocused) {
      const timer = setTimeout(() => setFocusClosing(true), 0);
      return () => clearTimeout(timer);
    }
  }, [activeSession, focusClosing, focusState, focusedTask?.status]);

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
      posthog.capture("session_started", {
        available_minutes: plannedMinutes,
        task_count: 1,
      });
      startSession({ taskIds: [task.id], plannedMinutes, energy: "ready" });
      setFocusClosing(false);
      const taskIndex = pendingTasks.findIndex((entry) => entry.id === task.id);
      setFocusState({ task, rank: Math.max(1, taskIndex + 1), origin, returnBounds: origin });
      startingSession.current = false;
    };

    if (bounds) {
      measureInRoot(bounds, begin);
    } else {
      begin({ x: 0, y: 0, width: rootSize.width, height: rootSize.height });
    }
  }, [measureInRoot, pendingTasks, rootSize.height, rootSize.width, startSession]);

  const handleDetails = useCallback((taskId: string) => {
    router.push({ pathname: "/task/[id]", params: { id: taskId } });
  }, [router]);

  const clearFocus = useCallback(() => {
    setFocusState(null);
    setFocusClosing(false);
  }, []);

  if (!currentTask && !focusState) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.charcoal[900] }} edges={["top"]}>
        <View className="flex-1 items-center justify-center gap-3 bg-cream-100 px-6">
          <Ionicons name="checkmark-done-circle" size={40} color={colors.orange[500]} />
          <Text className="text-card-title text-ink-cream">{t.next.allCaughtUp}</Text>
          <Text className="text-body text-center text-ink-cream-muted">{t.next.allCaughtUpBody}</Text>
          <AnimatedPressable onPress={() => router.push("/add")} className="btn btn--primary mt-2 flex-row gap-2 px-6">
            <Feather name="plus" size={16} color={colors.onAccent} />
            <Text className="font-grotesk-bold text-base text-on-accent">{t.next.addATask}</Text>
          </AnimatedPressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.charcoal[900] }} edges={["top"]}>
      <View ref={rootRef} style={{ flex: 1 }} onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setRootSize((current) => current.width === width && current.height === height ? current : { width, height });
      }}>
      <View className="gap-2 bg-charcoal-900 px-6 pb-[18px] pt-2">
        <View className="flex-row items-center gap-1.5">
          <GemLogo size={16} onDark />
          <Text className="eyebrow text-orange-500">{t.next.eyebrow}</Text>
        </View>
        <Text className="font-grotesk-bold text-[19px] leading-[24px] tracking-tight text-ink-charcoal" style={rtl}>
          {t.next.heading}
        </Text>
      </View>

      <View className="screen-body">
        <ScrollView
          contentContainerStyle={{ paddingTop: 18, paddingBottom: 28 }}
          showsVerticalScrollIndicator={false}
        >
          {activeBudget !== undefined ? (
            <View className="mx-6 mb-4 flex-row items-center gap-2 rounded-2xl border border-orange-500/40 bg-orange-100 px-4 py-2.5">
              <Feather name="clock" size={14} color={colors.orange[600]} />
              <Text className="flex-1 font-grotesk-semibold text-sm text-orange-600" style={rtl}>
                {budgetHasMatches
                  ? t.next.timeFilter(formatDuration(activeBudget))
                  : t.next.timeFilterEmpty(formatDuration(activeBudget))}
              </Text>
              <AnimatedPressable
                // Cleared on the route rather than in local state, so coming
                // back later with the same budget still shows the banner.
                onPress={() => {
                  router.setParams({ minutes: "" });
                  setFollowedId(undefined);
                  setActiveIndex(0);
                }}
                hitSlop={8}
                accessibilityRole="button"
              >
                <Text className="font-grotesk-bold text-sm text-orange-600">{t.next.timeFilterClear}</Text>
              </AnimatedPressable>
            </View>
          ) : null}

          {/* Read out as one phrase ("#1 of 12 in priority") rather than digit by digit. */}
          {currentTask ? (
            <>
              <View
                accessible
                accessibilityLabel={t.next.rankOf(currentIndex + 1, total)}
                className="px-6"
              >
                <Text className="font-grotesk-bold text-[15px] text-ink-cream">
                  {twoDigits(currentIndex + 1)}
                  <Text className="font-grotesk-medium text-ink-cream-subtle">{` / ${twoDigits(total)}`}</Text>
                </Text>
              </View>

              <NextTaskCardStack
                tasks={pendingTasks}
                currentIndex={currentIndex}
                onIndexChange={handleIndexChange}
                onStart={handleStartSession}
                onDetails={handleDetails}
                focusTaskId={focusState?.task.id}
                onFocusBoundsChange={handleFocusBoundsChange}
              />
            </>
          ) : null}
        </ScrollView>
      </View>
      {focusState && focusedTask ? (
        <FocusCardTransition
          focus={{ ...focusState, task: focusedTask }}
          screenWidth={rootSize.width}
          screenHeight={rootSize.height}
          closing={focusClosing}
          onExited={clearFocus}
          onDetails={handleDetails}
        />
      ) : null}
      </View>
    </SafeAreaView>
  );
}
