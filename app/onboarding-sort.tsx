import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { Platform, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";

import { OnboardingLayout } from "@/components/OnboardingLayout";
import { colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/useTranslation";
import { posthog } from "@/lib/posthog";

// The card is split once and stays split: the fog on top, the filter bar
// across the middle, the plan underneath. None of it moves — only what
// travels through it does.
// The plan side gets the slightly larger share: the fog only has to hold a
// scatter, but the plan has to fit every task at full width on a small phone.
const MESS_FLEX = 48;
const PLAN_FLEX = 52;
const FILTER_HEIGHT = 4;

// One task, drawn the same way on both sides of the filter. It is wider once
// sorted: a loose idea becoming something you could actually pick up.
const TASK_HEIGHT = 14;
const MESS_TASK_WIDTH = 0.3;
const PLAN_TASK_WIDTH = 0.72;
/** Where a loose task lines up as it is drawn down — the middle. */
const MESS_CENTER_LEFT = (1 - MESS_TASK_WIDTH) / 2;

// Tasks go through the filter one after another, in the order they end up in.
const LEAD_STEP = 0.13;
const TRAVEL_SPAN = 0.42;

// Five ideas, scattered. `slot` is where each one lands once sorted — the two
// urgent ones first — so the order they come through is the sort itself.
const TASKS = [
  { left: 0.52, top: 0.08, rotate: -9, urgent: true, slot: 0 },
  { left: 0.12, top: 0.54, rotate: 8, urgent: true, slot: 1 },
  { left: 0.14, top: 0.26, rotate: 6, urgent: false, slot: 2 },
  { left: 0.56, top: 0.42, rotate: -7, urgent: false, slot: 3 },
  { left: 0.3, top: 0.72, rotate: -11, urgent: false, slot: 4 },
] as const;

const PLAN_ORDER = [...TASKS].sort((a, b) => a.slot - b.slot);

// How far down its rail the grip can travel, as a fraction of the rail.
const GRIP_TOP = 0.05;
const GRIP_BOTTOM = 0.95;
const GRIP_SIZE = 34;
/** A transparent square around the grip, so it is thumb-sized. */
const GRIP_TOUCH = 48;

/** How far the task in `slot` has been drawn through the filter, 0–1. */
function taskTravel(progress: number, slot: number) {
  "worklet";
  return Math.min(Math.max((progress - slot * LEAD_STEP) / TRAVEL_SPAN, 0), 1);
}

/** The warm haze behind the fog — the chaos the app clears. */
function MessGlow() {
  return (
    <Svg style={StyleSheet.absoluteFill}>
      <Defs>
        <RadialGradient id="messGlow" cx="72%" cy="30%" rx="58%" ry="46%">
          <Stop offset="0" stopColor={colors.orange[500]} stopOpacity="0.32" />
          <Stop offset="1" stopColor={colors.orange[500]} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#messGlow)" />
    </Svg>
  );
}

/**
 * One loose idea. As the grip travels it slides down toward the filter,
 * pulling into the middle and straightening out on the way, then goes under
 * the bar.
 */
function MessTask({
  task,
  progress,
  size,
}: {
  task: (typeof TASKS)[number];
  progress: SharedValue<number>;
  size: { width: number; height: number };
}) {
  const taskStyle = useAnimatedStyle(() => {
    const travelled = taskTravel(progress.value, task.slot);
    return {
      opacity: 1 - interpolate(travelled, [0.8, 1], [0, 1], Extrapolation.CLAMP),
      transform: [
        { translateY: travelled * (size.height * (1 - task.top) + TASK_HEIGHT) },
        { translateX: travelled * (MESS_CENTER_LEFT - task.left) * size.width },
        { rotate: `${task.rotate * (1 - travelled)}deg` },
      ],
    };
  });

  return (
    <Animated.View
      className={task.urgent ? "absolute rounded-full bg-orange-600" : "absolute rounded-full bg-charcoal-600"}
      style={[
        {
          left: `${task.left * 100}%`,
          top: `${task.top * 100}%`,
          width: `${MESS_TASK_WIDTH * 100}%`,
          height: TASK_HEIGHT,
        },
        taskStyle,
      ]}
    />
  );
}

/** The same task once it is through — every one the same size, in order. */
function PlanTask({ task, progress }: { task: (typeof TASKS)[number]; progress: SharedValue<number> }) {
  const taskStyle = useAnimatedStyle(() => {
    // It lands exactly as its loose counterpart vanishes under the bar.
    const landed = interpolate(taskTravel(progress.value, task.slot), [0.75, 1], [0, 1], Extrapolation.CLAMP);
    return { opacity: landed, transform: [{ translateY: (1 - landed) * 10 }] };
  });

  return (
    <Animated.View
      className={task.urgent ? "rounded-full bg-orange-500" : "rounded-full bg-cream-300"}
      style={[{ width: `${PLAN_TASK_WIDTH * 100}%`, height: TASK_HEIGHT }, taskStyle]}
    />
  );
}

export default function OnboardingSort() {
  const t = useTranslation();
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();

  // Both measured rather than hardcoded: the card takes whatever height the
  // copy above and the button below leave it.
  const [messSize, setMessSize] = useState({ width: 0, height: 0 });
  const [railHeight, setRailHeight] = useState(0);

  const gripY = useSharedValue(0);
  const gripStart = useSharedValue(0);

  // 0 with everything still loose, 1 once it has all been through the filter.
  const progress = useDerivedValue(() => {
    const top = railHeight * GRIP_TOP;
    const bottom = railHeight * GRIP_BOTTOM;
    if (bottom <= top) return 0;
    return (gripY.value - top) / (bottom - top);
  });

  // The same drag, built twice: a gesture belongs to one detector, and both
  // the grip on the rail and the fog itself are worth pushing down.
  const buildPush = () =>
    Gesture.Pan()
      .onStart(() => {
        gripStart.value = gripY.value;
      })
      .onUpdate((event) => {
        const top = railHeight * GRIP_TOP;
        const bottom = railHeight * GRIP_BOTTOM;
        gripY.value = Math.min(Math.max(gripStart.value + event.translationY, top), bottom);
      });

  const pushGrip = buildPush();
  const pushMess = buildPush();

  const gripStyle = useAnimatedStyle(() => ({ transform: [{ translateY: gripY.value - GRIP_TOUCH / 2 }] }));

  if (!isLoaded) return null;
  if (isSignedIn) return <Redirect href="/" />;

  const handleMessLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width === messSize.width && height === messSize.height) return;
    setMessSize({ width, height });
  };

  const handleRailLayout = (event: LayoutChangeEvent) => {
    const { height } = event.nativeEvent.layout;
    if (height === railHeight) return;
    setRailHeight(height);
    gripY.value = height * GRIP_TOP;
  };

  const handleNext = () => {
    posthog.capture("onboarding_sort_continued");
    router.push("/(auth)/sign-up");
  };

  return (
    <OnboardingLayout
      percent={20}
      headline={t.onboardingSort.headline}
      body={t.onboardingSort.body}
      onNext={handleNext}
    >
      <View className="flex-1 flex-row gap-3">
        <View className="flex-1" style={styles.cardShadow}>
          <View
            className="flex-1 overflow-hidden rounded-[22px] bg-cream-50"
            style={{ borderCurve: "continuous" }}
          >
            {/* Everything loose, above the filter. */}
            <GestureDetector gesture={pushMess}>
              <View
                onLayout={handleMessLayout}
                className="overflow-hidden bg-charcoal-900"
                style={{ flex: MESS_FLEX }}
              >
                <MessGlow />
                {TASKS.map((task) => (
                  <MessTask key={task.slot} task={task} progress={progress} size={messSize} />
                ))}
                <Text className="eyebrow absolute left-4 top-4 text-ink-charcoal-muted">
                  {t.onboardingSort.unsorted}
                </Text>
              </View>
            </GestureDetector>

            {/* The filter bar — fixed. Everything passes through it. */}
            <View className="bg-orange-500" style={[{ height: FILTER_HEIGHT }, styles.filterGlow]} />

            {/* What comes out the other side. */}
            <View className="gap-2 px-4 pb-3 pt-3.5" style={{ flex: PLAN_FLEX }}>
              <Text className="eyebrow text-ink-cream-muted">{t.onboardingSort.sorted}</Text>
              <View className="flex-1 items-center justify-center gap-2">
                {PLAN_ORDER.map((task) => (
                  <PlanTask key={task.slot} task={task} progress={progress} />
                ))}
              </View>
            </View>
          </View>
        </View>

        {/* The rail the grip is scrolled down. */}
        <View className="w-9 items-center" onLayout={handleRailLayout}>
          <Feather name="chevron-up" size={15} color={colors.ink.creamSubtle} />
          <View className="my-1.5 w-[3px] flex-1 rounded-full bg-cream-200" />
          <Feather name="chevron-down" size={15} color={colors.ink.creamSubtle} />

          <GestureDetector gesture={pushGrip}>
            {/* top-0 is load-bearing: without it an absolute child falls to
                its static position, which here is below the chevron. */}
            <Animated.View className="absolute inset-x-0 top-0 items-center" style={gripStyle}>
              <View
                className="items-center justify-center"
                style={{ height: GRIP_TOUCH, width: GRIP_TOUCH }}
                accessibilityRole="adjustable"
                accessibilityLabel={t.onboardingSort.dragHandle}
              >
                <View
                  className="items-center justify-center gap-[3px] rounded-full border-[3px] border-cream-50 bg-orange-500"
                  style={[{ height: GRIP_SIZE, width: GRIP_SIZE }, styles.gripGlow]}
                >
                  <View className="h-[2px] w-3 rounded-full bg-cream-50" />
                  <View className="h-[2px] w-3 rounded-full bg-cream-50" />
                </View>
              </View>
            </Animated.View>
          </GestureDetector>
        </View>
      </View>
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  cardShadow: Platform.select({
    ios: {
      shadowColor: colors.ink.cream,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.1,
      shadowRadius: 20,
    },
    android: { shadowColor: colors.ink.cream, elevation: 6 },
    default: {},
  }),
  filterGlow: Platform.select({
    ios: {
      shadowColor: colors.orange[500],
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.7,
      shadowRadius: 10,
    },
    android: { shadowColor: colors.orange[500], elevation: 8 },
    default: {},
  }),
  gripGlow: Platform.select({
    ios: {
      shadowColor: colors.orange[500],
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.55,
      shadowRadius: 12,
    },
    android: { shadowColor: colors.orange[500], elevation: 10 },
    default: {},
  }),
});
