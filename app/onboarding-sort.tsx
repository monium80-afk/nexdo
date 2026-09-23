import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";

import { GemLogo } from "@/components/GemLogo";
import { OnboardingLayout } from "@/components/OnboardingLayout";
import { colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/useTranslation";
import { posthog } from "@/lib/posthog";

// Two cards of equal height stacked with the filter between them: what is
// still loose in your head on top, the plan underneath, and the app itself
// sitting in the line everything has to pass through. None of it moves — only
// what travels through it does.

// One task, drawn the same way on both sides of the filter. It is wider once
// sorted: a loose idea becoming something you could actually pick up.
const TASK_HEIGHT = 18;
const MESS_TASK_WIDTH = 0.3;
const PLAN_TASK_WIDTH = 0.72;
/** Where a loose task lines up as it is drawn down — the middle. */
const MESS_CENTER_LEFT = (1 - MESS_TASK_WIDTH) / 2;

// Tasks cross the filter one after another rather than as a block, each
// starting LEAD_STEP of the drag behind the one before it.
const LEAD_STEP = 0.13;
const TRAVEL_SPAN = 0.42;

// The idle drift on the loose notes — a few pixels, slowly, so the pile reads
// as unsettled rather than pinned down.
const FLOAT_DISTANCE = 3.5;
const FLOAT_DURATION = 2600;
/** Each note starts its drift later than the last, so they never move as one. */
const FLOAT_STAGGER = 420;

// Five ideas, scattered, each carrying the two orders that matter. `lead` is
// when it leaves the pile — lowest note first, so the drag feels like pulling
// the heap down from the bottom. `slot` is its place in the plan, the two
// urgent ones first, and also when it arrives: the plan fills top row down.
// So the two sides run in opposite directions at once, which is the sort made
// visible — chaos leaves from the bottom, order arrives from the top.
// `lead` is kept by hand rather than derived from `top`, so it needs redoing
// if these positions are ever moved around.
const TASKS = [
  { left: 0.52, top: 0.08, rotate: -9, urgent: true, slot: 0, lead: 4 },
  { left: 0.12, top: 0.54, rotate: 8, urgent: true, slot: 1, lead: 1 },
  { left: 0.14, top: 0.26, rotate: 6, urgent: false, slot: 2, lead: 3 },
  { left: 0.56, top: 0.42, rotate: -7, urgent: false, slot: 3, lead: 2 },
  { left: 0.3, top: 0.72, rotate: -11, urgent: false, slot: 4, lead: 0 },
] as const;

const PLAN_ORDER = [...TASKS].sort((a, b) => a.slot - b.slot);

// How far down its rail the grip can travel, as a fraction of the rail.
const GRIP_TOP = 0.05;
const GRIP_BOTTOM = 0.95;
const GRIP_SIZE = 34;
/** A transparent square around the grip, so it is thumb-sized. */
const GRIP_TOUCH = 48;

/** How far the `lead`-th task to be drawn has come through the filter, 0–1. */
function taskTravel(progress: number, lead: number) {
  "worklet";
  return Math.min(Math.max((progress - lead * LEAD_STEP) / TRAVEL_SPAN, 0), 1);
}

/** The warm haze behind the scatter — the chaos the app clears. */
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
 * One loose idea, drifting in place until it is drawn down. As the grip travels
 * it slides toward the filter, pulling into the middle and straightening out on
 * the way, then passes through it.
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
  // Runs 0 → 1 → 0 forever, offset per note so the five are never in step.
  const float = useSharedValue(0);

  useEffect(() => {
    float.value = withDelay(
      task.lead * FLOAT_STAGGER,
      withRepeat(withTiming(1, { duration: FLOAT_DURATION, easing: Easing.inOut(Easing.quad) }), -1, true),
    );
  }, [float, task.lead]);

  const taskStyle = useAnimatedStyle(() => {
    const travelled = taskTravel(progress.value, task.lead);
    // The drift fades out as the note starts moving: something being pulled
    // through the filter should not still be bobbing about.
    const drift = (float.value - 0.5) * 2 * FLOAT_DISTANCE * (1 - travelled);
    return {
      opacity: 1 - interpolate(travelled, [0.8, 1], [0, 1], Extrapolation.CLAMP),
      transform: [
        { translateY: travelled * (size.height * (1 - task.top) + TASK_HEIGHT) + drift },
        { translateX: travelled * (MESS_CENTER_LEFT - task.left) * size.width },
        { rotate: `${task.rotate * (1 - travelled) + drift * 0.4}deg` },
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
    // Keyed to `slot`, not `lead`: rows arrive down the plan in order, however
    // scattered the order they left the pile in.
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
    router.push("/onboarding-goals");
  };

  return (
    <OnboardingLayout
      percent={20}
      headline={t.onboardingSort.headline}
      body={t.onboardingSort.body}
      onNext={handleNext}
    >
      <View className="flex-1 flex-row gap-3">
        <View className="flex-1">
          {/* Everything loose, above the filter. */}
          <View className="flex-1" style={styles.cardShadow}>
            <GestureDetector gesture={pushMess}>
              <View
                onLayout={handleMessLayout}
                className="flex-1 overflow-hidden rounded-[22px] bg-charcoal-900"
                style={{ borderCurve: "continuous" }}
              >
                <MessGlow />
                {TASKS.map((task) => (
                  <MessTask key={task.slot} task={task} progress={progress} size={messSize} />
                ))}
                <Text className="eyebrow absolute left-4 top-4 text-ink-charcoal-muted">
                  {t.onboardingSort.head}
                </Text>
              </View>
            </GestureDetector>
          </View>

          {/* The filter — fixed, and the one thing between the two cards.
              The app sits in the line, because the app is what does the
              sorting: everything passes through it to get to the plan. */}
          <View className="flex-row items-center gap-2.5 py-2">
            <View className="h-[3px] flex-1 rounded-full bg-orange-500" style={styles.filterGlow} />
            <View
              className="h-8 w-8 items-center justify-center rounded-full border border-cream-300 bg-cream-50"
              style={styles.filterBadge}
            >
              <GemLogo size={17} />
            </View>
            <View className="h-[3px] flex-1 rounded-full bg-orange-500" style={styles.filterGlow} />
          </View>

          {/* What comes out the other side. */}
          <View className="flex-1" style={styles.cardShadow}>
            <View
              className="flex-1 gap-1.5 overflow-hidden rounded-[22px] bg-cream-50 px-4 pb-2.5 pt-3"
              style={{ borderCurve: "continuous" }}
            >
              <Text className="eyebrow text-ink-cream-muted">{t.onboardingSort.plan}</Text>
              <View className="flex-1 items-center justify-center gap-1.5">
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
  // Lifted off the line it sits on, so the logo reads as sitting *in* the
  // filter rather than being another dot on it.
  filterBadge: Platform.select({
    ios: {
      shadowColor: colors.ink.cream,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.16,
      shadowRadius: 6,
    },
    android: { shadowColor: colors.ink.cream, elevation: 10 },
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
