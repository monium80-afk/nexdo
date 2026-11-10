import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { View, useWindowDimensions, type TextLayoutEvent } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { AppIcon } from "@/components/icons/AppIcons";
import { colors } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import { formatTaskLength } from "@/lib/formatDuration";
import { measureView } from "@/lib/measureView";
import type { ScreenRect } from "@/store/useMagicMicStore";
import { describeRule } from "@/lib/recurrence";
import { playSound } from "@/lib/sounds";
import { getDueInfo } from "@/lib/taskMeta";
import type { Task } from "@/types/task";
import { SOFT_SHADOW } from "@/constants/shadow";

const SCORE_HIGHLIGHT = { backgroundColor: "#FFFFFF", borderWidth: 3, borderColor: "#FFE1D0" } as const;

export type ScoreAnchor ={ pill: ScreenRect | null; row: ScreenRect | null };

// The mockup's soft lift under an open card.
const CARD_SHADOW = SOFT_SHADOW;
const DIAMOND = { transform: [{ rotate: "45deg" }] };
/** What a ticked task's title, strike and details fade to (Anim-TaskDone.html). */
const DONE_GREY = "#A79C92";
/** The score and Overdue pills, greyed. */
const DONE_PILL = "#EFE3D4";

// The title's text-[15px], and where Android draws its line-through on it: centred
// 6/21 em above the baseline, 1/18 em thick. The animated strike is drawn there.
const TITLE_SIZE = 15;
const STRIKE_CENTER_EM = 6 / 21;
const STRIKE_THICKNESS_EM = 1 / 18;

/*
 * Ticking a task off — nexdo-design-handoff/animations/Anim-TaskDone.html,
 * played once from the tap instead of on its 4 s loop. Each step's timing is
 * its keyframe percentage of those 4 s, counted from the tap (17 %):
 *   check pops in        0 → 360 ms   (17 → 22 → 26 %, scale 0 → 1.25 → 1)
 *   ring ripples out     40 → 680 ms  (18 → 20 → 34 %)
 *   eight sparks fly     80 → 760 ms  (19 → 22 → 36 %, ease-out, 30 px)
 *   title and details    160 → 480 ms (21 → 29 %: grey, details at half)
 *   strike crosses       200 → 600 ms (22 → 32 %)
 *   card slides off      760 → 1240 ms (36 → 48 %: 115 % right, 4°, fading;
 *                                       cubic-bezier(.5, 0, .2, 1))
 * Then the task is completed, and the cards under it slide up into its place
 * (the list's own layout animation). Reduce Motion: it's simply completed.
 */
const CHECK_UP_MS = 200;
const CHECK_SETTLE_MS = 160;
const RIPPLE_DELAY_MS = 40;
const RIPPLE_IN_MS = 80;
const RIPPLE_OUT_MS = 560;
const SPARK_DELAY_MS = 80;
const SPARK_MS = 680;
const GREY_DELAY_MS = 160;
const GREY_MS = 320;
const STRIKE_DELAY_MS = 200;
const STRIKE_MS = 400;
const SLIDE_DELAY_MS = 760;
const SLIDE_MS = 480;
const COMPLETE_AT_MS = SLIDE_DELAY_MS + SLIDE_MS;
const SLIDE_EASING = Easing.bezier(0.5, 0, 0.2, 1);
/** After a completed card has left the list (its exit), it's put back as it was, in case it stays. */
const RESET_AFTER_MS = 450;

const SPARK_COLORS = ["#F26A2E", "#FFC33E", "#1F8A55", "#F26A2E", "#FFC33E", "#F26A2E", "#1F8A55", "#FFC33E"];
const SPARK_DISTANCE = 30;
const BOX = 25;

type TitleLine = TextLayoutEvent["nativeEvent"]["lines"][number];

/** A text colour going from `from` to the done grey as the task is ticked (or already done: `floor` 1). */
function useGreyText(grey: SharedValue<number>, floor: number, from: string) {
  return useAnimatedStyle(() => ({ color: interpolateColor(Math.max(grey.value, floor), [0, 1], [from, DONE_GREY]) }));
}

/** One line of the title's strike, drawn across in its turn as the task is ticked. */
function StrikeLine({
  line,
  index,
  count,
  progress,
  fontSize,
  fromRight,
}: {
  line: TitleLine;
  index: number;
  count: number;
  progress: SharedValue<number>;
  fontSize: number;
  fromRight: boolean;
}) {
  const thickness = Math.max(1.5, fontSize * STRIKE_THICKNESS_EM);
  const top = line.y + line.ascender - fontSize * STRIKE_CENTER_EM - thickness / 2;

  const style = useAnimatedStyle(() => {
    // A wrapped title is crossed out line by line, top to bottom.
    const drawn =
      line.width * interpolate(progress.value, [index / count, (index + 1) / count], [0, 1], Extrapolation.CLAMP);
    return {
      width: drawn,
      left: fromRight ? line.x + line.width - drawn : line.x,
    };
  });

  return <Animated.View className="absolute rounded-full" style={[{ top, height: thickness, backgroundColor: DONE_GREY }, style]} />;
}

/** One of the eight sparks thrown out of the box as it's ticked (aSp). */
function Spark({ index, progress }: { index: number; progress: SharedValue<number> }) {
  const angle = index * 45;
  const style = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      opacity: p <= 0 ? 0 : interpolate(p, [0, 0.12, 1], [0, 1, 0], Extrapolation.CLAMP),
      transform: [{ rotate: `${angle}deg` }, { translateY: -SPARK_DISTANCE * p }],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      className="absolute h-[5px] w-[5px] rounded-full"
      style={[{ left: BOX / 2 - 2.5, top: BOX / 2 - 2.5, backgroundColor: SPARK_COLORS[index] }, style]}
    />
  );
}

type TaskCardProps = {
  task: Task;
  onPress: () => void;
  onToggle: () => void;
  /** Tapping the score pill: what the score means. */
  /** Where the score pill and the whole row are on screen, for the score card to point at. */
  onScorePress?: (anchor: ScoreAnchor) => void;
  /** Its score card is open (components/ScoreSheet.tsx). */
  scoreHighlighted?: boolean;
};

export function TaskCard({ task, onPress, onToggle, onScorePress, scoreHighlighted = false }: TaskCardProps) {
  const t = useTranslation();
  const rtl = useRtlText();
  const { fontScale } = useWindowDimensions();
  const due = getDueInfo(task);
  const isOverdue = due.tone === "overdue";
  const isCompleted = task.status === "completed";
  const reduceMotion = useReducedMotion();

  // Ticked but not yet completed: the card plays its tick first, and only then
  // is the task completed, which is what moves it out of the list.
  const [checking, setChecking] = useState(false);
  const celebrating = checking && !isCompleted;
  const [strikeLines, setStrikeLines] = useState<TitleLine[]>([]);
  const titleLines = useRef<TitleLine[]>([]);
  const completeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const successBeat = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardWidth = useRef(0);
  const rowRef = useRef<ComponentRef<typeof View>>(null);
  const pillRef = useRef<ComponentRef<typeof View>>(null);
  // What the timer sees when it fires — the task may have been completed
  // elsewhere (Task Details, AI) while the tick was playing.
  const latest = useRef({ isCompleted, onToggle });
  useEffect(() => {
    latest.current = { isCompleted, onToggle };
  });

  const check = useSharedValue(0);
  const ripple = useSharedValue(0);
  const sparks = useSharedValue(0);
  const grey = useSharedValue(0);
  const strike = useSharedValue(0);
  const slide = useSharedValue(0);
  const slideDistance = useSharedValue(0);

  const resetAll = () => {
    [check, ripple, sparks, grey, strike, slide].forEach((value) => {
      cancelAnimation(value);
      value.set(0);
    });
  };

  // Leaving mid-tick still completes the task: the tap was real.
  useEffect(
    () => () => {
      if (successBeat.current) clearTimeout(successBeat.current);
      if (!completeTimer.current) return;
      clearTimeout(completeTimer.current);
      if (!latest.current.isCompleted) latest.current.onToggle();
    },
    [],
  );

  // Once completed, the card has left (To do) — or it stays, moved down the
  // list (All, Done): then it's put back in place, drawn as done.
  useEffect(() => {
    if (checking) return;
    const timer = setTimeout(() => {
      slide.set(0);
      grey.set(0);
      strike.set(0);
      ripple.set(0);
      sparks.set(0);
    }, RESET_AFTER_MS);
    return () => clearTimeout(timer);
  }, [checking, grey, isCompleted, ripple, slide, sparks, strike]);

  const finishCheck = () => {
    completeTimer.current = null;
    if (!latest.current.isCompleted) latest.current.onToggle();
    setChecking(false);
  };

  const handleToggle = () => {
    // A second tap during the tick takes it back before it lands.
    if (celebrating) {
      if (completeTimer.current) clearTimeout(completeTimer.current);
      if (successBeat.current) clearTimeout(successBeat.current);
      completeTimer.current = null;
      successBeat.current = null;
      resetAll();
      setChecking(false);
      return;
    }
    if (isCompleted) {
      onToggle();
      return;
    }

    if (reduceMotion) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      playSound("complete");
      onToggle();
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // The success buzz and sound as the strike lands.
    successBeat.current = setTimeout(() => {
      successBeat.current = null;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      playSound("complete");
    }, STRIKE_DELAY_MS + STRIKE_MS);

    setStrikeLines(titleLines.current);
    setChecking(true);
    slideDistance.set(cardWidth.current * 1.15);

    check.set(
      withSequence(
        withTiming(1.25, { duration: CHECK_UP_MS }),
        withTiming(1, { duration: CHECK_SETTLE_MS }),
      ),
    );
    ripple.set(
      withDelay(
        RIPPLE_DELAY_MS,
        withSequence(withTiming(0.12, { duration: RIPPLE_IN_MS }), withTiming(1, { duration: RIPPLE_OUT_MS })),
      ),
    );
    sparks.set(withDelay(SPARK_DELAY_MS, withTiming(1, { duration: SPARK_MS, easing: Easing.out(Easing.ease) })));
    grey.set(withDelay(GREY_DELAY_MS, withTiming(1, { duration: GREY_MS })));
    strike.set(withDelay(STRIKE_DELAY_MS, withTiming(1, { duration: STRIKE_MS })));
    slide.set(withDelay(SLIDE_DELAY_MS, withTiming(1, { duration: SLIDE_MS, easing: SLIDE_EASING })));
    completeTimer.current = setTimeout(finishCheck, COMPLETE_AT_MS);
  };

  // The orange disc with its tick, over the empty box (aChk).
  const checkStyle = useAnimatedStyle(() => ({ transform: [{ scale: check.value }] }));
  // The ring: 0 → 0.12 fades in from 60 % to 80 % size, then it grows to 230 % and fades (aRip).
  const rippleStyle = useAnimatedStyle(() => {
    const p = ripple.value;
    return {
      opacity: p <= 0 ? 0 : p < 0.12 ? p / 0.12 : 1 - (p - 0.12) / 0.88,
      transform: [{ scale: p < 0.12 ? 0.6 + (0.2 * p) / 0.12 : 0.8 + (1.5 * (p - 0.12)) / 0.88 }],
    };
  });
  const titleStyle = useAnimatedStyle(() => ({
    color: interpolateColor(grey.value, [0, 1], [colors.palette.ink, DONE_GREY]),
  }));
  // Everything but the check turns light grey as the task is ticked — a
  // colour change, not a fade (the user's call, 2026-11-04). A completed card
  // left in the list (All, Done) stays grey.
  const greyFloor = isCompleted ? 1 : 0;
  const greyStart = {
    due: isOverdue ? "#FFFFFF" : due.tone === "today" ? colors.palette.accentInk : colors.palette.inkMuted,
    overdueBg: colors.palette.alert,
    muted: colors.palette.inkMuted,
    pillBg: colors.palette.peach,
    pillText: colors.palette.ink,
    diamond: colors.palette.accent,
  };
  const dueTextStyle = useGreyText(grey, greyFloor, greyStart.due);
  const mutedTextStyle = useGreyText(grey, greyFloor, greyStart.muted);
  const pillTextStyle = useGreyText(grey, greyFloor, greyStart.pillText);
  const overduePillStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(Math.max(grey.value, greyFloor), [0, 1], [greyStart.overdueBg, DONE_PILL]),
  }));
  const pillStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(Math.max(grey.value, greyFloor), [0, 1], [greyStart.pillBg, DONE_PILL]),
  }));
  const diamondStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(Math.max(grey.value, greyFloor), [0, 1], [greyStart.diamond, DONE_GREY]),
  }));
  // Icons are SVG: the grey copy fades in over the coloured one.
  const iconOutStyle = useAnimatedStyle(() => ({ opacity: 1 - Math.max(grey.value, greyFloor) }));
  const iconInStyle = useAnimatedStyle(() => ({ opacity: Math.max(grey.value, greyFloor) }));
  const greyIcon = (normal: ReactNode, greyed: ReactNode) => (
    <View>
      <Animated.View style={iconOutStyle}>{normal}</Animated.View>
      <Animated.View style={[{ position: "absolute", left: 0, top: 0 }, iconInStyle]}>{greyed}</Animated.View>
    </View>
  );
  const slideStyle = useAnimatedStyle(() => ({
    opacity: 1 - slide.value,
    transform: [{ translateX: slideDistance.value * slide.value }, { rotate: `${4 * slide.value}deg` }],
  }));

  const ticked = isCompleted || celebrating;
  const dueToday = due.tone === "today";
  const dueColor = isOverdue ? "#FFFFFF" : dueToday ? colors.palette.accentInk : colors.palette.inkMuted;
  // "Today" and "Tomorrow" on their own, without "Due" (the user's call, 2026-11-03).
  const dueLabel = isOverdue
    ? t.due.overdue
    : dueToday
      ? t.due.todayShort
      : due.label === t.due.dueTomorrow
        ? t.due.tomorrowShort
        : due.label;

  // The 2026-11 redesign (Final-Tasks.html), a size down for the phone: a
  // thin light card — round box, title, when · how long, and the score in a
  // peach pill with a small orange diamond.
  // The score card points at the pill and sits under the row (components/ScoreSheet.tsx).
  const handleScorePress = async () => {
    if (!onScorePress) return;
    const [pill, row] = await Promise.all([measureView(pillRef.current), measureView(rowRef.current)]);
    onScorePress({ pill, row });
  };

  return (
    <Animated.View ref={rowRef} collapsable={false} style={slideStyle} onLayout={(event) => (cardWidth.current = event.nativeEvent.layout.width)}>
      <AnimatedPressable
        onPress={onPress}
        scaleTo={0.98}
        className={`flex-row items-start gap-[11px] rounded-[16px] py-[12px] pl-[14px] pr-[12px] ${isCompleted ? "bg-paper-card/60" : "bg-paper-card"}`}
        style={isCompleted ? undefined : CARD_SHADOW}
      >
        <AnimatedPressable
          onPress={handleToggle}
          hitSlop={10}
          scaleTo={0.9}
          accessibilityRole="checkbox"
          accessibilityLabel={task.title}
          accessibilityState={{ checked: ticked }}
        >
          <View
            className={`items-center justify-center rounded-full border-2 ${isCompleted ? "border-accent bg-accent" : "border-ring-soft"}`}
            style={{ width: BOX, height: BOX }}
          >
            {isCompleted ? <AppIcon name="check" size={13} strokeWidth={3.2} color="#FFFFFF" /> : null}
          </View>
          {celebrating ? (
            <>
              <Animated.View
                pointerEvents="none"
                className="absolute rounded-full border-[3px] border-accent"
                style={[{ left: -4, top: -4, width: BOX + 8, height: BOX + 8 }, rippleStyle]}
              />
              <Animated.View
                pointerEvents="none"
                className="absolute items-center justify-center rounded-full bg-accent"
                style={[{ left: -2, top: -2, width: BOX + 4, height: BOX + 4 }, checkStyle]}
              >
                <AppIcon name="check" size={14} strokeWidth={3.2} color="#FFFFFF" />
              </Animated.View>
              {SPARK_COLORS.map((_, index) => (
                <Spark key={index} index={index} progress={sparks} />
              ))}
            </>
          ) : null}
        </AnimatedPressable>

        {/* Title and details share one column, so the details line up under the title. */}
        <View className="flex-1 gap-[5px]">
          <View className="flex-row items-start">
            <View className="shrink">
              <Animated.Text
                className={
                  isCompleted
                    ? "font-grotesk-semibold text-[15px] leading-[19px] line-through"
                    : "font-grotesk-semibold text-[15px] leading-[19px] text-ink"
                }
                style={[rtl, isCompleted ? { color: DONE_GREY } : titleStyle]}
                onTextLayout={(event) => {
                  titleLines.current = event.nativeEvent.lines;
                }}
              >
                {task.title}
              </Animated.Text>
              {celebrating
                ? strikeLines.map((line, index) => (
                    <StrikeLine
                      key={index}
                      line={line}
                      index={index}
                      count={strikeLines.length}
                      progress={strike}
                      fontSize={TITLE_SIZE * fontScale}
                      fromRight={rtl !== undefined}
                    />
                  ))
                : null}
            </View>
            {/* A repeating task (a routine or a recurring task): arrows after its name. */}
            {task.recurrence ? (
              <View className="ml-[6px] mt-[3px]" accessibilityLabel={describeRule(task.recurrence.rule, t)}>
                {greyIcon(
                  <Feather name="repeat" size={13} color={colors.palette.accent} />,
                  <Feather name="repeat" size={13} color={DONE_GREY} />,
                )}
              </View>
            ) : null}
          </View>

          <View className="flex-row flex-wrap items-center gap-x-[12px] gap-y-[4px]">
            {/* Past its deadline a task simply reads "Overdue", in a red pill
                (red is for overdue only); how late is left to Task Details. */}
            {task.deadline || !isCompleted ? (
              <Animated.View
                accessibilityLabel={due.label}
                className={`flex-row items-center gap-[4px] ${isOverdue ? "h-[21px] rounded-full px-[8px]" : ""}`}
                style={isOverdue ? overduePillStyle : undefined}
              >
                {greyIcon(
                  <AppIcon name="calendar" size={13} strokeWidth={2} color={dueColor} />,
                  <AppIcon name="calendar" size={13} strokeWidth={2} color={DONE_GREY} />,
                )}
                <Animated.Text
                  numberOfLines={1}
                  className={`text-[12.5px] ${isOverdue ? "font-grotesk-bold" : dueToday ? "font-grotesk-semibold" : "font-grotesk-regular"}`}
                  style={dueTextStyle}
                >
                  {dueLabel}
                </Animated.Text>
              </Animated.View>
            ) : null}
            {task.estimatedMinutes > 0 ? (
              <View className="flex-row items-center gap-[4px]">
                {greyIcon(
                  <AppIcon name="clock" size={13} strokeWidth={2} color={colors.palette.inkMuted} />,
                  <AppIcon name="clock" size={13} strokeWidth={2} color={DONE_GREY} />,
                )}
                <Animated.Text className="font-grotesk-regular text-[12.5px]" style={mutedTextStyle}>
                  {formatTaskLength(task.estimatedMinutes)}
                </Animated.Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* The score: a small orange diamond and the number, in a peach pill.
            Tapping it explains what the score is. */}
        <View className="self-center">
          <AnimatedPressable
            onPress={() => void handleScorePress()}
            disabled={!onScorePress}
            hitSlop={8}
            scaleTo={0.92}
            accessibilityRole="button"
            accessibilityLabel={t.tasks.score(task.priorityScore)}
          >
            {/* Its score card open: the pill itself lights up, white with a peach ring. */}
            <Animated.View
              ref={pillRef}
              collapsable={false}
              className="h-[24px] flex-row items-center gap-[6px] rounded-full px-[9px]"
              style={[pillStyle, scoreHighlighted ? SCORE_HIGHLIGHT : null]}
            >
              <Animated.View className="h-[7px] w-[7px] rounded-[2px]" style={[DIAMOND, diamondStyle]} />
              <Animated.Text className="font-grotesk-bold text-[11.5px]" style={pillTextStyle}>
                {task.priorityScore}
              </Animated.Text>
            </Animated.View>
          </AnimatedPressable>
        </View>
      </AnimatedPressable>
    </Animated.View>
  );
}
