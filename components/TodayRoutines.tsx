import * as Haptics from "expo-haptics";
import { useMemo } from "react";
import { Text, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { Checkbox } from "@/components/Checkbox";
import { gradients } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import { deadlineInstant, deadlineOnThisPhone } from "@/lib/deadline";
import type { LocalDate } from "@/lib/localDate";
import { isRoutine } from "@/lib/recurrence";
import { byRoutineOrder } from "@/lib/schedule";
import { playSound } from "@/lib/sounds";
import { useTaskStore } from "@/store/useTaskStore";
import type { Task } from "@/types/task";

/**
 * Today's routines (lib/recurrence.ts isRoutine) — open or done today — those
 * with a time first, in time order, then the rest by title.
 */
export function routinesFor(tasks: Task[], today: LocalDate): Task[] {
  return tasks
    .filter((task) => {
      if (!isRoutine(task) || !task.deadline) return false;
      if (task.status !== "pending" && task.status !== "completed") return false;
      return deadlineOnThisPhone(task.deadline).date === today;
    })
    .sort(byRoutineOrder);
}

/**
 * A day's routines: under the cards on Today, under the day's tasks on the
 * Schedule (the user's call, 2026-10-28). Habits kept up, not tasks to decide
 * between — so they're never one of the cards, never in the progress bar or
 * a day's work, and one tap ticks one off (another takes it back). A routine
 * missed simply passes at the end of its day. Tapping its name opens it,
 * like any task. `inset`: the Today page's side margin (the Schedule has its own).
 */
export function TodayRoutines({
  routines,
  onOpen,
  inset = true,
}: {
  routines: Task[];
  onOpen: (taskId: string) => void;
  inset?: boolean;
}) {
  const t = useTranslation();
  const rtl = useRtlText();
  const toggleTaskStatus = useTaskStore((state) => state.toggleTaskStatus);
  const done = useMemo(() => routines.filter((task) => task.status === "completed").length, [routines]);

  if (routines.length === 0) return null;

  const handleToggle = (task: Task) => {
    if (task.status === "pending") {
      Haptics.selectionAsync().catch(() => {});
      playSound("step");
    }
    toggleTaskStatus(task.id);
  };

  return (
    <View className={inset ? "gap-2.5 px-4" : "gap-2.5"}>
      <View className="flex-row items-center justify-between px-2">
        <Text className="eyebrow text-ink-cream-muted">{t.next.routinesTitle}</Text>
        <Text className="font-grotesk-semibold text-[13px] text-ink-cream-muted">{t.next.doneOfTotal(done, routines.length)}</Text>
      </View>
      <View className="card card--cream-soft px-1.5 py-1.5" style={gradients.card}>
        {routines.map((task, index) => {
          const checked = task.status === "completed";
          const time = task.deadline?.time
            ? deadlineInstant(task.deadline).toLocaleTimeString(t.locale, { hour: "numeric", minute: "2-digit" })
            : null;
          return (
            <View key={task.id} className={`flex-row items-center ${index > 0 ? "border-t border-cream-200" : ""}`}>
              {/* The box and the row around it: a big target for the tick. */}
              <AnimatedPressable
                onPress={() => handleToggle(task)}
                scaleTo={0.94}
                hitSlop={4}
                accessibilityRole="checkbox"
                accessibilityLabel={task.title}
                accessibilityState={{ checked }}
                className="min-h-[48px] justify-center px-2.5"
              >
                <Checkbox checked={checked} />
              </AnimatedPressable>
              <AnimatedPressable
                onPress={() => onOpen(task.id)}
                scaleTo={0.99}
                accessibilityRole="button"
                className="min-h-[48px] flex-1 flex-row items-center gap-3 pr-3"
              >
                <Text
                  numberOfLines={2}
                  style={rtl}
                  className={
                    checked
                      ? "flex-1 font-grotesk-medium text-[15px] text-ink-cream-muted line-through"
                      : "flex-1 font-grotesk-semibold text-[15px] text-ink-cream"
                  }
                >
                  {task.title}
                </Text>
                {time ? <Text className="font-grotesk-medium text-[13px] text-ink-cream-muted">{time}</Text> : null}
              </AnimatedPressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}
