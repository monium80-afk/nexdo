import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { AppIcon } from "@/components/icons/AppIcons";
import { gradients } from "@/constants/theme";
import { useTranslation } from "@/hooks/useTranslation";
import { deadlineInstant } from "@/lib/deadline";
import { playSound } from "@/lib/sounds";
import { useTaskStore } from "@/store/useTaskStore";
import type { Task } from "@/types/task";

// The day timeline's geometry, back to Final-Today.html's own (the user's
// screenshot, 2026-11-04): each routine a column 84 wide, 86 apart, its
// 30-point circle on a 4-point line. The Anytime row uses the same columns.
const ITEM_W = 84;
const STEP = 86;
const CIRCLE = 30;
const LINE_TOP = (CIRCLE - 4) / 2;
const PING_MS = 1600;
const DONE_SHADOW = { boxShadow: "0 4px 10px rgba(242, 106, 46, 0.35)" };
// The soft peach halo round the routine to do now.
const CURRENT_HALO = { boxShadow: "0 0 0 4px rgba(242, 106, 46, 0.18)" };

function minutesOfDay(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

/** The clock, a minute at a time, so the line keeps up with the day. */
function useNowMinutes() {
  const [now, setNow] = useState(() => minutesOfDay(new Date()));
  useEffect(() => {
    const timer = setInterval(() => setNow(minutesOfDay(new Date())), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** The ring that pulses out of the current routine's circle (rtPing). */
function Ping({ animate }: { animate: boolean }) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  useEffect(() => {
    if (!animate || reduceMotion) {
      progress.set(0);
      return;
    }
    progress.set(withRepeat(withTiming(1, { duration: PING_MS, easing: Easing.out(Easing.ease) }), -1));
    return () => cancelAnimation(progress);
  }, [animate, progress, reduceMotion]);
  const style = useAnimatedStyle(() => ({
    opacity: reduceMotion || !animate ? 0 : 0.7 * (1 - progress.value),
    transform: [{ scale: 1 + 0.7 * progress.value }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      className="absolute -left-[3px] -top-[3px] h-[30px] w-[30px] rounded-full border-[3px] border-accent"
      style={style}
    />
  );
}

/**
 * Today's routines, as in the 2026-11 redesign: those with a time on a day
 * timeline — in time order, the line filled up to now, the one to do now
 * pulsing — and those without on an "Anytime" row. Habits kept up, not tasks
 * to decide between: never one of the cards, never in the gem's progress.
 * A tap ticks one off (another takes it back); a long press opens it.
 */
export function RoutineTimeline({
  routines,
  onOpen,
  onAdd,
  animate = true,
}: {
  routines: Task[];
  onOpen: (taskId: string) => void;
  /** With no routines today, the section stays and offers to add one. */
  onAdd: () => void;
  /** Off while the page isn't on screen: the pulse stops. */
  animate?: boolean;
}) {
  const t = useTranslation();
  const toggleTaskStatus = useTaskStore((state) => state.toggleTaskStatus);
  const now = useNowMinutes();

  const timed = useMemo(() => routines.filter((task) => task.deadline?.time), [routines]);
  const anytime = useMemo(() => routines.filter((task) => !task.deadline?.time), [routines]);
  const done = routines.filter((task) => task.status === "completed").length;
  const times = useMemo(
    () => timed.map((task) => (task.deadline ? minutesOfDay(deadlineInstant(task.deadline)) : 0)),
    [timed],
  );

  // No routine today: the section is still there (the user's call,
  // 2026-11-03), with a way to start one — "Read every day at 9pm".
  if (routines.length === 0) {
    return (
      <View className="gap-[9px] px-[20px]">
        <Text className="font-grotesk-bold text-[17px] tracking-[-0.34px] text-ink">{t.next.routinesHeading}</Text>
        <View className="flex-row items-center gap-[10px] rounded-[18px] border-[1.5px] border-line bg-paper-card py-[10px] pl-[14px] pr-[10px]">
          <Text className="flex-1 font-grotesk-medium text-[12.5px] leading-[17px] text-ink-muted">{t.next.noRoutinesToday}</Text>
          <AnimatedPressable
            onPress={onAdd}
            scaleTo={0.95}
            accessibilityRole="button"
            className="h-[32px] flex-row items-center gap-[5px] rounded-full bg-ink px-[12px]"
          >
            <AppIcon name="plus" size={14} strokeWidth={2.4} color="#FFFFFF" />
            <Text className="font-grotesk-semibold text-[12.5px] text-white">{t.next.addRoutine}</Text>
          </AnimatedPressable>
        </View>
      </View>
    );
  }

  // The one to do now: the earliest still open whose time has come — or,
  // with none of those, the next one coming up.
  const firstDue = timed.findIndex((task, index) => task.status === "pending" && times[index] <= now);
  const current = firstDue >= 0 ? firstDue : timed.findIndex((task) => task.status === "pending");

  // How far along the line now is: between two routines' circles in
  // proportion to the clock, at the first before the day's first routine,
  // at the last after the last.
  let fill = 0;
  for (let index = 0; index < times.length - 1; index += 1) {
    if (now <= times[index]) break;
    const span = Math.max(1, times[index + 1] - times[index]);
    fill = index * STEP + Math.min(1, (now - times[index]) / span) * STEP;
  }

  const handleToggle = (task: Task) => {
    if (task.status === "pending") {
      Haptics.selectionAsync().catch(() => {});
      playSound("step");
    }
    toggleTaskStatus(task.id);
  };

  // 24-hour, no AM/PM, no leading zero — "6:30", "13:30", "00:15" (the user's call, 2026-11-03).
  const timeLabel = (task: Task) => {
    if (!task.deadline) return "";
    const at = deadlineInstant(task.deadline);
    const hour = at.getHours();
    return `${hour === 0 ? "00" : hour}:${String(at.getMinutes()).padStart(2, "0")}`;
  };

  const [before, count, after] = t.next.routinesToday(done, routines.length);
  const lineWidth = (timed.length - 1) * STEP;

  // One routine's circle: ticked (orange, a check), the one to do now (an
  // orange ring in a soft halo, pulsing), or still to come (a plain ring).
  const circle = (checked: boolean, isCurrent: boolean) =>
    checked ? (
      <View className="items-center justify-center rounded-full bg-accent" style={[{ width: CIRCLE, height: CIRCLE }, DONE_SHADOW]}>
        <AppIcon name="check" size={15} strokeWidth={3.2} color="#FFFFFF" />
      </View>
    ) : isCurrent ? (
      <View className="rounded-full border-[3px] border-accent bg-paper-card" style={[{ width: CIRCLE, height: CIRCLE }, CURRENT_HALO]}>
        <Ping animate={animate} />
      </View>
    ) : (
      <View className="rounded-full border-[2.5px] border-ring bg-paper-card" style={{ width: CIRCLE, height: CIRCLE }} />
    );

  // A routine's name under its circle: struck through and grey once done.
  const name = (task: Task, checked: boolean) => (
    <Text
      numberOfLines={2}
      className={`text-center font-grotesk-semibold text-[13px] leading-[16px] ${checked ? "text-paper-faint line-through" : "text-ink"}`}
    >
      {task.title}
    </Text>
  );

  return (
    <View className="gap-[14px]">
      <View className="flex-row items-baseline justify-between px-[20px]">
        <Text className="font-grotesk-bold text-[20px] tracking-[-0.4px] text-ink">{t.next.routinesHeading}</Text>
        <Text className="font-grotesk-regular text-[13px] text-ink-muted">
          {before}
          <Text className="font-grotesk-bold text-ink">{count}</Text>
          {after}
        </Text>
      </View>

      {timed.length > 0 ? (
        <View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 6 }}>
            <View style={{ width: timed.length * STEP }}>
              {timed.length > 1 ? (
                <>
                  <View
                    className="absolute h-[4px] rounded-[2px] bg-line-soft"
                    style={{ left: 1 + ITEM_W / 2, top: LINE_TOP, width: lineWidth }}
                  />
                  {fill > 0 ? (
                    <View
                      className="absolute h-[4px] rounded-[2px]"
                      style={[{ left: 1 + ITEM_W / 2, top: LINE_TOP, width: Math.min(fill, lineWidth) }, gradients.routineLine]}
                    />
                  ) : null}
                </>
              ) : null}
              <View className="flex-row gap-[2px] pl-px">
                {timed.map((task, index) => {
                  const checked = task.status === "completed";
                  const isCurrent = index === current;
                  const time = timeLabel(task);
                  return (
                    <AnimatedPressable
                      key={task.id}
                      onPress={() => handleToggle(task)}
                      onLongPress={() => onOpen(task.id)}
                      scaleTo={0.94}
                      accessibilityRole="checkbox"
                      accessibilityLabel={`${task.title}, ${time}`}
                      accessibilityState={{ checked }}
                      accessibilityActions={[{ name: "open", label: t.next.details }]}
                      onAccessibilityAction={() => onOpen(task.id)}
                      className="items-center"
                      style={{ width: ITEM_W }}
                    >
                      {circle(checked, isCurrent)}
                      <View className="mt-[9px] items-center gap-[5px]">
                        {name(task, checked)}
                        <Text className={`font-mono-bold text-[11px] ${isCurrent ? "text-accent-ink" : "text-ink-muted"}`}>{time}</Text>
                      </View>
                    </AnimatedPressable>
                  );
                })}
              </View>
            </View>
          </ScrollView>
          {/* The line runs off the right edge into the page (the mockup's mask). */}
          <View pointerEvents="none" className="absolute bottom-0 right-0 top-0 w-[15%]" style={gradients.paperFadeRight} />
        </View>
      ) : null}

      {anytime.length > 0 ? (
        <View className="mt-[6px] gap-[12px]">
          <Text className="px-[26px] font-mono-bold text-[11px] uppercase tracking-[1.65px] text-ink-muted">{t.next.anytime}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20 }}>
            <View className="flex-row gap-[2px] pl-px">
              {anytime.map((task) => {
                const checked = task.status === "completed";
                return (
                  <AnimatedPressable
                    key={task.id}
                    onPress={() => handleToggle(task)}
                    onLongPress={() => onOpen(task.id)}
                    scaleTo={0.94}
                    accessibilityRole="checkbox"
                    accessibilityLabel={task.title}
                    accessibilityState={{ checked }}
                    accessibilityActions={[{ name: "open", label: t.next.details }]}
                    onAccessibilityAction={() => onOpen(task.id)}
                    className="items-center"
                    style={{ width: ITEM_W }}
                  >
                    {circle(checked, false)}
                    <View className="mt-[9px] items-center">{name(task, checked)}</View>
                  </AnimatedPressable>
                );
              })}
            </View>
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}
