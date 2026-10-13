import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { BottomSheet } from "@/components/BottomSheet";
import { PrimaryButton } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { useRtlText } from "@/hooks/useRtlText";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import type { Translations } from "@/lib/i18n";
import { addDaysToKey, keyToLocalDate, toLocalDateKey, type LocalDate } from "@/lib/localDate";
import { proposeReset, RESET_DAYS, resetDeadline, slippedTasks } from "@/lib/resetWeek";
import { getDueInfo } from "@/lib/taskMeta";
import { useTaskStore } from "@/store/useTaskStore";
import { withUndo } from "@/store/useUndoStore";
import type { Task } from "@/types/task";

/** What happens to one slipped task: a new day, no deadline at all, or it's already done. */
type Choice = { kind: "day"; date: LocalDate } | { kind: "none" } | { kind: "done" };

function dayLabel(date: LocalDate, today: LocalDate, t: Translations): string {
  if (date === today) return t.taskDetail.today;
  if (date === addDaysToKey(today, 1)) return t.taskDetail.tomorrow;
  return keyToLocalDate(date).toLocaleDateString(t.locale, { weekday: "short", day: "numeric" });
}

function choiceLabel(choice: Choice, today: LocalDate, t: Translations): string {
  if (choice.kind === "done") return t.resetWeek.done;
  if (choice.kind === "none") return t.resetWeek.noDate;
  return dayLabel(choice.date, today, t);
}

function sameChoice(a: Choice, b: Choice): boolean {
  return a.kind === b.kind && (a.kind !== "day" || (b.kind === "day" && a.date === b.date));
}

/** The plan as the sheet opens: every slipped task on the day Nexdo suggests. */
function initialPlan(): { tasks: Task[]; choices: Record<string, Choice>; today: LocalDate } {
  const now = new Date();
  const all = useTaskStore.getState().tasks;
  const proposal = proposeReset(all, now);
  const tasks = slippedTasks(all, now);
  return {
    tasks,
    today: toLocalDateKey(now),
    choices: Object.fromEntries(tasks.map((task) => [task.id, { kind: "day", date: proposal.get(task.id)! } as Choice])),
  };
}

/**
 * "Reset my week" (lib/resetWeek.ts): every task whose day has gone by, each
 * with the day Nexdo suggests over the coming week. Tap a task to pick another
 * day, take its deadline off, or mark it done. Nothing changes until "Reset my
 * week" — and that can be undone.
 */
export function ResetWeekSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const colors = useColors();
  const t = useTranslation();
  const rtl = useRtlText();
  const updateTask = useTaskStore((state) => state.updateTask);
  const completeTask = useTaskStore((state) => state.completeTask);

  const [plan, setPlan] = useState(initialPlan);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Each opening starts from the list as it is now (the pattern AccountSheet uses).
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setPlan(initialPlan());
      setExpandedId(null);
    }
  }

  const { tasks, choices, today } = plan;
  const days = Array.from({ length: RESET_DAYS }, (_, index) => addDaysToKey(today, index));

  const choose = (taskId: string, choice: Choice) => {
    setPlan((current) => ({ ...current, choices: { ...current.choices, [taskId]: choice } }));
    setExpandedId(null);
  };

  const handleConfirm = () => {
    const now = new Date();
    withUndo(t.undoToast.reset(tasks.length), () => {
      for (const task of tasks) {
        const choice = choices[task.id];
        if (!choice) continue;
        if (choice.kind === "done") completeTask(task.id);
        else if (choice.kind === "none") updateTask(task.id, { deadline: null });
        else updateTask(task.id, { deadline: resetDeadline(task, choice.date, now) });
      }
    });
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t.resetWeek.title} closeLabel={t.common.close}>
      <Text className="text-body text-ink-cream-muted" style={rtl}>
        {t.resetWeek.intro}
      </Text>

      <ScrollView
        style={{ flexGrow: 0, flexShrink: 1, marginTop: 12 }}
        contentContainerStyle={{ gap: 8 }}
        showsVerticalScrollIndicator={false}
      >
        {tasks.map((task) => {
          const choice = choices[task.id];
          const expanded = expandedId === task.id;
          return (
            <View key={task.id} className="card card--cream-soft gap-3 px-4 py-3">
              <AnimatedPressable
                onPress={() => setExpandedId(expanded ? null : task.id)}
                scaleTo={0.99}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                accessibilityLabel={`${task.title}, ${choice ? choiceLabel(choice, today, t) : ""}`}
                className="flex-row items-center gap-3"
              >
                <View className="flex-1 gap-0.5">
                  <Text numberOfLines={2} className="font-grotesk-semibold text-base text-ink-cream" style={rtl}>
                    {task.title}
                  </Text>
                  <Text className="font-grotesk-medium text-[13px] text-overdue-500" style={rtl}>
                    {getDueInfo(task).label}
                  </Text>
                </View>
                {choice ? (
                  <View className="flex-row items-center gap-1 rounded-full border border-orange-500 bg-orange-100 py-1 pl-3 pr-2">
                    <Text className="font-grotesk-bold text-sm text-orange-600">{choiceLabel(choice, today, t)}</Text>
                    <Feather name={expanded ? "chevron-up" : "chevron-down"} size={14} color={colors.orange[600]} />
                  </View>
                ) : null}
              </AnimatedPressable>

              {expanded ? (
                <View className="flex-row flex-wrap gap-2">
                  {days.map((date) => {
                    const option: Choice = { kind: "day", date };
                    return (
                      <Chip
                        key={date}
                        label={dayLabel(date, today, t)}
                        selected={!!choice && sameChoice(choice, option)}
                        accessibilityRole="radio"
                        onPress={() => choose(task.id, option)}
                      />
                    );
                  })}
                  <Chip
                    label={t.resetWeek.noDate}
                    selected={choice?.kind === "none"}
                    accessibilityRole="radio"
                    onPress={() => choose(task.id, { kind: "none" })}
                  />
                  <Chip
                    label={t.resetWeek.done}
                    selected={choice?.kind === "done"}
                    accessibilityRole="radio"
                    icon={(color) => <Feather name="check" size={14} color={color} />}
                    onPress={() => choose(task.id, { kind: "done" })}
                  />
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      <PrimaryButton
        icon="refresh-cw"
        size="lg"
        label={t.resetWeek.confirm}
        onPress={handleConfirm}
        disabled={tasks.length === 0}
        className="mt-4"
      />
    </BottomSheet>
  );
}
