import { addDaysToKey, daysBetweenKeys, toLocalDateKey, type LocalDate } from "@/lib/localDate";
import type { Subtask, Task } from "@/types/task";

// The planning engine: how far along a task's plan is, and how its remaining
// steps could be spread over the days left before the deadline. Pure and
// derived on the spot from the task as it is — never stored — so it follows
// every change by itself: a step ticked off, a deadline moved, a plan
// regenerated (completed steps are always kept, see replaceRemainingSteps and
// lib/reassessment.ts).
//
// What it suggests is only that: a day to aim for, on the calendar. It never
// picks a time, and never claims a time is free — Nexdo doesn't know the
// user's calendar or working hours.

export type StepSuggestion = { stepId: string; date: LocalDate };

export type PlanSummary = {
  totalSteps: number;
  doneSteps: number;
  openSteps: number;
  remainingMinutes: number;
  /** The first step still to do. */
  currentStep?: Subtask;
  /**
   * "none": no deadline to plan towards. "overdue": the deadline has passed —
   * everything left is due now. "scheduled": spread over the days left.
   */
  pace: "none" | "overdue" | "scheduled";
  /** Days to work in, today and the deadline's day included. */
  daysLeft?: number;
  /** Work per day if it's spread evenly over those days. */
  minutesPerDay?: number;
  /** A suggested day for each open step, in plan order. Empty unless the pace is "scheduled". */
  suggestions: StepSuggestion[];
};

function ordered(subtasks: Subtask[]): Subtask[] {
  return subtasks.slice().sort((a, b) => a.order - b.order);
}

/**
 * Where a task with a plan stands. Null for a task without steps — a plan is
 * optional, and a simple task stays simple.
 */
export function summarizePlan(task: Task, now: Date): PlanSummary | null {
  const steps = ordered(task.subtasks ?? []);
  if (steps.length === 0) return null;
  const open = steps.filter((step) => step.status !== "completed");
  const remainingMinutes = open.reduce((sum, step) => sum + Math.max(0, step.estimatedMinutes), 0);
  const summary: PlanSummary = {
    totalSteps: steps.length,
    doneSteps: steps.length - open.length,
    openSteps: open.length,
    remainingMinutes,
    currentStep: open.find((step) => step.id === task.currentStepId) ?? open[0],
    pace: "none",
    suggestions: [],
  };
  if (open.length === 0 || task.status !== "pending" || !task.deadline || !task.dueDate) return summary;

  if (Date.parse(task.dueDate) < now.getTime()) return { ...summary, pace: "overdue" };

  const today = toLocalDateKey(now);
  const daysLeft = Math.max(1, daysBetweenKeys(today, task.deadline.date) + 1);
  return {
    ...summary,
    pace: "scheduled",
    daysLeft,
    minutesPerDay: Math.ceil(remainingMinutes / daysLeft),
    suggestions: spreadSteps(open, today, daysLeft),
  };
}

/**
 * Open steps laid out over `days` days from `from`, in order, so each day
 * gets about the same amount of work: a step goes on the day its share of the
 * total starts in. More steps than days doubles some up; fewer spaces them
 * out, the last one never after the deadline's day.
 */
export function spreadSteps(open: Subtask[], from: LocalDate, days: number): StepSuggestion[] {
  if (open.length === 0 || days <= 0) return [];
  const total = open.reduce((sum, step) => sum + Math.max(1, step.estimatedMinutes), 0);
  const perDay = total / days;
  let elapsed = 0;
  return open.map((step) => {
    const dayIndex = Math.min(days - 1, Math.floor(elapsed / perDay + 1e-9));
    elapsed += Math.max(1, step.estimatedMinutes);
    return { stepId: step.id, date: addDaysToKey(from, dayIndex) };
  });
}
