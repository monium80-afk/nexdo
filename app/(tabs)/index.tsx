import { Feather, Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { PrimaryButton } from "@/components/Button";
import { GemLogo } from "@/components/GemLogo";
import { NextTaskCard, type CardBounds } from "@/components/NextTaskCard";
import { NextTaskCardStack } from "@/components/NextTaskCardStack";
import { useTabBarHeight } from "@/components/TabBar";
import { MOTION, gradients } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";
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

// The Next card's corners (NextTaskCardStack's CARD_RADIUS), which the
// session grows out of and shrinks back into.
const CARD_RADIUS = 28;
// Opening decelerates hard into place; closing accelerates away — Material's
// "emphasized" curves, which read as one confident movement each way.
const GROW = { duration: 360, easing: Easing.bezier(0.05, 0.7, 0.1, 1) };
const SHRINK = { duration: 300, easing: Easing.bezier(0.3, 0, 0.8, 0.15) };
const CONTENT_IN_MS = 220;
const CONTENT_OUT_MS = 140;
const HAND_BACK_MS = 180;

/**
 * A session opening out of its Next card, and closing back into it.
 *
 * Only an empty shell changes size: a card-coloured shape that grows to fill
 * the screen, taking on the session's glow as it goes. The session itself is
 * laid out at full size once, faded in when the shell is there — resizing it
 * every frame used to squeeze and re-wrap everything in it on the way. Closing
 * runs the other way: the session fades, the shell shrinks onto the card it
 * came from (or the one that took its place), and melts away over it.
 */
function FocusCardTransition({
  focus,
  screenWidth,
  screenHeight,
  closing,
  onLanded,
  onExited,
  onDetails,
}: {
  focus: FocusCardState;
  screenWidth: number;
  screenHeight: number;
  closing: boolean;
  /** The shell is back over the card: time to show the card again under it. */
  onLanded: () => void;
  onExited: () => void;
  onDetails: (taskId: string) => void;
}) {
  const colors = useColors();
  const reduceMotion = useReducedMotion();
  const x = useSharedValue(focus.origin.x);
  const y = useSharedValue(focus.origin.y);
  const width = useSharedValue(focus.origin.width);
  const height = useSharedValue(focus.origin.height);
  // 0 = the Next card it grew out of, 1 = the full-screen session.
  const expand = useSharedValue(0);
  const content = useSharedValue(0);
  const shell = useSharedValue(1);
  // The session's content is mounted once the shell has finished growing:
  // mounting it alongside the growth cost the first frames of the animation.
  const [contentMounted, setContentMounted] = useState(reduceMotion);

  useEffect(() => {
    if (closing) return;
    const grow = { ...GROW, duration: reduceMotion ? 0 : GROW.duration };
    x.set(withTiming(0, grow));
    y.set(withTiming(0, grow));
    width.set(withTiming(screenWidth, grow));
    height.set(withTiming(screenHeight, grow));
    expand.set(
      withTiming(1, grow, (finished) => {
        if (finished) scheduleOnRN(setContentMounted, true);
      }),
    );
  }, [closing, expand, height, reduceMotion, screenHeight, screenWidth, width, x, y]);

  // Fades in once it's mounted — the frame after, so it's never seen at full strength first.
  useEffect(() => {
    if (!contentMounted || closing) return;
    content.set(withTiming(1, { duration: reduceMotion ? 0 : CONTENT_IN_MS, easing: MOTION.easing.enter }));
  }, [closing, content, contentMounted, reduceMotion]);

  useEffect(() => {
    if (!closing) return;
    const target = focus.returnBounds;
    const wait = reduceMotion ? 0 : CONTENT_OUT_MS;
    const shrink = { ...SHRINK, duration: reduceMotion ? 0 : SHRINK.duration };
    content.set(withTiming(0, { duration: wait, easing: MOTION.easing.exit }));
    x.set(withDelay(wait, withTiming(target.x, shrink)));
    y.set(withDelay(wait, withTiming(target.y, shrink)));
    width.set(withDelay(wait, withTiming(target.width, shrink)));
    height.set(withDelay(wait, withTiming(target.height, shrink)));
    expand.set(
      withDelay(
        wait,
        withTiming(0, shrink, (finished) => {
          if (!finished) return;
          scheduleOnRN(onLanded);
          // The card is showing again underneath: let the shell melt into it.
          shell.set(
            withTiming(0, { duration: reduceMotion ? 0 : HAND_BACK_MS }, (done) => {
              if (done) scheduleOnRN(onExited);
            }),
          );
        }),
      ),
    );
  }, [closing, content, expand, focus.returnBounds, height, onExited, onLanded, reduceMotion, shell, width, x, y]);

  const shellStyle = useAnimatedStyle(() => ({
    left: x.value,
    top: y.value,
    width: width.value,
    height: height.value,
    borderRadius: CARD_RADIUS * (1 - expand.value),
    opacity: shell.value,
  }));
  // The Next card's own surface over the session's glow, fading as it grows.
  const cardSurfaceStyle = useAnimatedStyle(() => ({ opacity: 1 - expand.value }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: content.value,
    transform: [{ translateY: (1 - content.value) * 14 }],
  }));

  return (
    <>
      {/* Blocks the task stack while leaving the persistent tab bar outside this screen interactive. */}
      <View pointerEvents="auto" style={StyleSheet.absoluteFill} />
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            zIndex: 20,
            overflow: "hidden",
            backgroundColor: colors.charcoal[900],
            borderWidth: 1,
            borderColor: colors.hairlineCharcoal,
          },
          // Embers glowing behind the glass of the session card.
          gradients.session,
          shellStyle,
        ]}
      >
        <Animated.View style={[StyleSheet.absoluteFill, gradients.charcoalCard, cardSurfaceStyle]} />
      </Animated.View>
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
            onDetails={() => onDetails(focus.task.id)}
          />
        </Animated.View>
      ) : null}
    </>
  );
}

// However long the queue, the dots stay a short row: past this many, each one
// stands for a stretch of it and the lit one shows roughly where you are.
const MAX_DOTS = 5;

/** Where you are in the queue, as a row of dots. */
function QueueDots({ index, total }: { index: number; total: number }) {
  const count = Math.min(total, MAX_DOTS);
  const active = total <= MAX_DOTS ? index : Math.round((index / Math.max(1, total - 1)) * (count - 1));
  return (
    <View className="flex-row items-center gap-[5px]" importantForAccessibility="no-hide-descendants">
      {Array.from({ length: count }, (_, dot) =>
        dot === active ? (
          <View key={dot} className="h-[8px] w-[8px] rounded-full bg-orange-500" style={DOT_GLOW} />
        ) : (
          <View key={dot} className="h-[6px] w-[6px] rounded-full bg-orange-200" />
        ),
      )}
    </View>
  );
}

const DOT_GLOW = { boxShadow: "0 2px 6px rgba(242, 101, 42, 0.55)" };

/**
 * Soft peach dunes along the foot of the page, behind the buttons. They sit
 * just above the tab bar, which floats over the page, and their solid foot
 * runs on down to the bottom of the screen — so that's what the bar's rounded
 * corners show.
 */
function BottomWaves() {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const tabBarHeight = useTabBarHeight();
  return (
    <View pointerEvents="none" className="absolute bottom-0 left-0 right-0">
      <Svg width={width} height={130} viewBox="0 0 360 130" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="duneBack" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FBDDBC" stopOpacity={0.85} />
            <Stop offset="1" stopColor="#F9D0A6" stopOpacity={0.9} />
          </LinearGradient>
          {/* Solid at the foot, in the colour it carries on in below. */}
          <LinearGradient id="duneFront" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#F8CFA2" stopOpacity={0.8} />
            <Stop offset="1" stopColor={colors.pageFoot.dunes} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Path d="M0 58 C 70 30, 150 40, 220 58 S 320 70, 360 36 L 360 130 L 0 130 Z" fill="url(#duneBack)" />
        <Path d="M0 96 C 60 70, 130 78, 200 94 S 310 104, 360 80 L 360 130 L 0 130 Z" fill="url(#duneFront)" />
      </Svg>
      <View style={{ height: tabBarHeight, backgroundColor: colors.pageFoot.dunes }} />
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
      setFocusLanded(false);
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
    setFocusLanded(false);
  }, []);

  if (!currentTask && !focusState) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream[100] }} edges={["top"]}>
        <BottomWaves />
        {/* Faded in rather than cut to: it usually arrives the moment the last task is done. */}
        <Animated.View
          entering={reduceMotion ? undefined : FadeIn.duration(MOTION.duration.screen)}
          className="flex-1 items-center justify-center gap-3 px-6"
          // Centred in what the tab bar leaves showing.
          style={{ paddingBottom: tabBarHeight }}
        >
          <View
            pointerEvents="none"
            className="absolute left-0 right-0"
            style={[{ top: -insets.top, height: 420 + insets.top }, gradients.creamGlow]}
          />
          <View
            className="tile tile--orange h-[52px] w-[52px] rounded-[16px]"
            style={gradients.tileOrange}
          >
            <Ionicons name="checkmark-done" size={26} color={colors.orange[500]} />
          </View>
          <Text className="text-card-title text-center text-ink-cream">{t.next.allCaughtUp}</Text>
          <Text className="text-body text-center text-ink-cream-muted">{t.next.allCaughtUpBody}</Text>
          <PrimaryButton icon="plus" size="lg" label={t.next.addATask} onPress={() => router.push("/add")} className="mt-2" />
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
      {/* Warm light from the top-right corner, running up under the status
          bar, and peach dunes along the foot — the page's own scenery. */}
      <View
        pointerEvents="none"
        className="absolute left-0 right-0"
        style={[{ top: -insets.top, height: 420 + insets.top }, gradients.creamGlow]}
      />
      <BottomWaves />

      <View className="px-6 pb-1 pt-2">
        <View className="flex-row items-center gap-1.5">
          <GemLogo size={16} />
          <Text className="eyebrow text-orange-500">{t.next.eyebrow}</Text>
        </View>
        <Text className="mt-2 font-grotesk-bold text-[19px] leading-[24px] tracking-tight text-ink-cream" style={rtl}>
          {t.next.heading}
        </Text>
      </View>

      <View className="flex-1">
        <ScrollView
          // Clear of the tab bar, which floats over the foot of the page.
          contentContainerStyle={{ paddingTop: 18, paddingBottom: 28 + tabBarHeight }}
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
                className="flex-row items-center gap-3 px-6"
              >
                <View className="card card--cream-soft rounded-[12px] px-2.5 py-1" style={gradients.card}>
                  <Text className="font-grotesk-bold text-[15px] text-ink-cream">
                    {currentIndex + 1}
                    <Text className="font-grotesk-medium text-ink-cream-subtle">{` / ${total}`}</Text>
                  </Text>
                </View>
                <QueueDots index={currentIndex} total={total} />
              </View>

              <NextTaskCardStack
                tasks={pendingTasks}
                currentIndex={currentIndex}
                onIndexChange={handleIndexChange}
                onStart={handleStartSession}
                onDetails={handleDetails}
                focusTaskId={focusState && !focusLanded ? focusState.task.id : undefined}
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
          onLanded={handleFocusLanded}
          onExited={clearFocus}
          onDetails={handleDetails}
        />
      ) : null}
      </View>
    </SafeAreaView>
  );
}
