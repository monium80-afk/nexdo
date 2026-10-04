import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Text, View, useWindowDimensions, type TextLayoutEvent } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { Checkbox } from "@/components/Checkbox";
import { CompletionBurst } from "@/components/CompletionBurst";
import { GemLogo } from "@/components/GemLogo";
import { MetaPill } from "@/components/MetaPill";
import { MOTION, colors, gradients } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDuration } from "@/lib/formatDuration";
import { describeRule } from "@/lib/recurrence";
import { getDueInfo, type DueTone } from "@/lib/taskMeta";
import type { Task } from "@/types/task";

// The icon and label carry the deadline colour directly, with no badge behind
// them — except once it's overdue: then they're white on a solid red badge.
const DEADLINE_STYLES: Record<DueTone, { color: string; label: string }> = {
  overdue: { color: colors.onAccent, label: "font-grotesk-bold" },
  today: { color: colors.overdue[500], label: "font-grotesk-bold" },
  urgent: { color: colors.amber[500], label: "font-grotesk-semibold" },
  upcoming: { color: colors.success[500], label: "font-grotesk-semibold" },
  muted: { color: colors.ink.creamMuted, label: "font-grotesk-medium" },
};

// The card's surface for each state: a lifted cream card at rest, a flat one
// sunk into the page once it's done. Only an overdue task is tinted red — a
// task due today says so in its deadline alone, so red always means "late".
function cardSurface(tone: DueTone, isCompleted: boolean) {
  if (isCompleted) return { className: "card--cream-muted", fill: undefined };
  if (tone === "overdue") return { className: "card--overdue", fill: gradients.danger };
  return { className: "card--cream-soft", fill: gradients.card };
}

// The title's text-[18px], and where Android draws its line-through on it: centred
// 6/21 em above the baseline, 1/18 em thick. The animated strike is drawn there
// too, so it hands over to the real line-through without a jump.
const TITLE_SIZE = 18;
const STRIKE_CENTER_EM = 6 / 21;
const STRIKE_THICKNESS_EM = 1 / 18;

// A tick, in ms from the tap: the box squashes and springs past full size,
// the ring and sparks burst as it grows, the strike crosses the title — then the
// card holds a beat before the task is completed and the list slides it down.
//
// Everything animated here either starts and ends at the card's normal look
// (the pop, the bump) or is taken away when the tick is over (the burst, the
// strike). What says "done" afterwards — the ticked box, the muted, struck
// title, the sunken card — is drawn from the task itself, never left behind by
// an animation: see Checkbox.
const BURST_DELAY_MS = 80;
const BURST_MS = 560;
const STRIKE_DELAY_MS = 140;
const STRIKE_MS = 320;
const CHECK_HOLD_MS = 720;
const POP_SPRING = { damping: 9, stiffness: 300, mass: 0.6 };

type TitleLine = TextLayoutEvent["nativeEvent"]["lines"][number];

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
  const thickness = Math.max(1, fontSize * STRIKE_THICKNESS_EM);
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

  // In the title's own ink: the two turn muted together once the task is completed.
  return <Animated.View className="absolute bg-ink-cream" style={[{ top, height: thickness }, style]} />;
}

type TaskCardProps = {
  task: Task;
  onPress: () => void;
  onToggle: () => void;
};

export function TaskCard({ task, onPress, onToggle }: TaskCardProps) {
  const t = useTranslation();
  const rtl = useRtlText();
  const { fontScale } = useWindowDimensions();
  const due = getDueInfo(task);
  const isOverdue = due.tone === "overdue";
  const isCompleted = task.status === "completed";
  const deadline = DEADLINE_STYLES[due.tone];
  const reduceMotion = useReducedMotion();

  // Ticked but not yet completed: the card plays its tick first, and only then
  // is the task completed, which is what moves it down the list.
  const [checking, setChecking] = useState(false);
  const celebrating = checking && !isCompleted;
  const [strikeLines, setStrikeLines] = useState<TitleLine[]>([]);
  const titleLines = useRef<TitleLine[]>([]);
  const completeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What the timer sees when it fires — the task may have been completed
  // elsewhere (Task Details, AI) while the tick was playing.
  const latest = useRef({ isCompleted, onToggle });
  useEffect(() => {
    latest.current = { isCompleted, onToggle };
  });

  // Leaving mid-tick still completes the task: the tap was real.
  useEffect(
    () => () => {
      if (!completeTimer.current) return;
      clearTimeout(completeTimer.current);
      if (!latest.current.isCompleted) latest.current.onToggle();
    },
    [],
  );

  const strike = useSharedValue(0);
  const pop = useSharedValue(1);
  const bump = useSharedValue(1);
  const burst = useSharedValue(0);

  // Back to the start once a tick is over — its lines are gone by then — so
  // the next one draws from nothing.
  useEffect(() => {
    if (!celebrating) strike.set(0);
  }, [celebrating, strike]);

  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const bumpStyle = useAnimatedStyle(() => ({ transform: [{ scale: bump.value }] }));

  const finishCheck = () => {
    completeTimer.current = null;
    if (!latest.current.isCompleted) latest.current.onToggle();
    setChecking(false);
  };

  const handleToggle = () => {
    // A second tap during the tick takes it back before it lands.
    if (celebrating) {
      if (completeTimer.current) clearTimeout(completeTimer.current);
      completeTimer.current = null;
      setChecking(false);
      return;
    }
    if (isCompleted) {
      onToggle();
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (reduceMotion) {
      onToggle();
      return;
    }

    setStrikeLines(titleLines.current);
    setChecking(true);
    // .set() rather than `.value =`: the React Compiler lint allows it in a handler.
    pop.set(
      withSequence(
        withTiming(0.78, { duration: 90, easing: MOTION.easing.exit }),
        withTiming(1.22, { duration: 130, easing: MOTION.easing.enter }),
        withSpring(1, POP_SPRING),
      ),
    );
    bump.set(
      withDelay(
        BURST_DELAY_MS,
        withSequence(withTiming(1.018, { duration: 110, easing: MOTION.easing.enter }), withSpring(1, POP_SPRING)),
      ),
    );
    burst.set(
      withSequence(
        withTiming(0, { duration: 0 }),
        withDelay(BURST_DELAY_MS, withTiming(1, { duration: BURST_MS, easing: MOTION.easing.enter })),
      ),
    );
    strike.set(withDelay(STRIKE_DELAY_MS, withTiming(1, { duration: STRIKE_MS, easing: MOTION.easing.enter })));
    completeTimer.current = setTimeout(finishCheck, CHECK_HOLD_MS);
  };

  const surface = cardSurface(due.tone, isCompleted);

  return (
    <Animated.View style={bumpStyle}>
      {/* Rows aligned by baseline: the checkbox's baseline is its bottom edge,
          so the title's first line sits exactly on it at any font size. */}
      <AnimatedPressable
        onPress={onPress}
        scaleTo={0.98}
        style={surface.fill}
        className={`card ${surface.className} flex-row items-baseline gap-3.5 px-[18px] py-[17px]`}
      >
        <AnimatedPressable
          onPress={handleToggle}
          hitSlop={10}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isCompleted || celebrating }}
        >
          {/* Mounted only for the tick — it waits BURST_DELAY_MS to start, so it's in place before it plays. */}
          {celebrating ? <CompletionBurst progress={burst} /> : null}
          <Animated.View style={popStyle}>
            <Checkbox checked={isCompleted || celebrating} tone={isOverdue ? "overdue" : "default"} />
          </Animated.View>
        </AnimatedPressable>

        {/* Title and details share one column, so the details line up under the title. */}
        <View className="flex-1 gap-2.5">
          <View className="flex-row items-baseline gap-2">
            <View className="flex-1">
              <Text
                className={
                  isCompleted
                    ? "font-grotesk-semibold text-[18px] leading-[23px] tracking-tight text-ink-cream-muted line-through"
                    : "font-grotesk-bold text-[18px] leading-[23px] tracking-tight text-ink-cream"
                }
                style={rtl}
                onTextLayout={(event) => {
                  titleLines.current = event.nativeEvent.lines;
                }}
              >
                {task.title}
              </Text>
              {/* Drawn only while the tick plays; once the task is completed the
                  title's own line-through takes over at the same spot. */}
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
            {/* As tall as the checkbox, with the chevron laid over it, so its
                baseline is its bottom edge too and the chevron is level with the
                box. A done task has no mark of its own here: the ticked box says it. */}
            <View className="h-[22px] w-[16px]">
              <View className="absolute inset-0 items-center justify-center">
                <Feather name="chevron-right" size={16} color={colors.ink.creamSubtle} />
              </View>
            </View>
          </View>

          <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1.5">
            {/* Past its deadline — yesterday or last month — a task simply reads
                "Overdue"; how late is left to the screen reader and Task Details. */}
            <MetaPill
              icon={<Feather name="calendar" size={14} color={deadline.color} />}
              label={isOverdue ? t.due.overdue : due.label}
              labelClassName={`${deadline.label} text-[13px]`}
              labelStyle={{ color: deadline.color }}
              className={isOverdue ? "badge--overdue-solid rounded-full px-2.5" : ""}
              accessibilityLabel={due.label}
            />
            <MetaPill
              icon={<GemLogo size={13} />}
              label={String(task.priorityScore)}
              labelClassName="font-grotesk-semibold text-[13px] text-ink-cream-muted"
              accessibilityLabel={t.tasks.score(task.priorityScore)}
            />
            <MetaPill
              icon={<Feather name="clock" size={14} color={colors.ink.creamMuted} />}
              label={formatDuration(task.estimatedMinutes)}
              labelClassName="font-grotesk-medium text-[13px] text-ink-cream-muted"
            />
            {/* The rule in a few words, so a repeating task is recognisable in the list. */}
            {task.recurrence ? (
              <MetaPill
                icon={<Feather name="repeat" size={14} color={colors.orange[500]} />}
                label={describeRule(task.recurrence.rule, t)}
                labelClassName="font-grotesk-medium text-[13px] text-ink-cream-muted"
              />
            ) : null}
          </View>
        </View>
      </AnimatedPressable>
    </Animated.View>
  );
}
