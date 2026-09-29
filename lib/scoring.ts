import { computeScore, recommendTasks, type PriorityInput } from "@/lib/priority";
import type { Task, TaskPriorityLevel } from "@/types/task";

// Maps the Add form's 3-card priority picker to the "importance" input the
// scoring engine actually runs on (Step 2 of the prioritization logic).
export const PRIORITY_LEVEL_IMPORTANCE: Record<TaskPriorityLevel, number> = {
  high: 75,
  medium: 50,
  low: 25,
};

const SKIP_SUPPRESSION_HOURS = 3;

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The stored 0–100 priority score — lib/priority.ts's formula, with no time
 * budget (none is known when a task is saved). Takes a draft as well as a
 * saved task, so a preview (TaskConfirmationCard, onboarding) scores exactly
 * as the saved task will.
 */
export function computePriorityScore(task: PriorityInput & Partial<Pick<Task, "createdAt">>, now: Date = new Date()): number {
  return computeScore(task, { now });
}

// Complexity affects suitability, not priority — a hard task isn't less
// important, just less doable in a random open slot.
export function computeSuitabilityScore(
  task: Pick<Task, "complexity" | "estimatedMinutes" | "skip">,
  now: Date = new Date(),
): number {
  const complexityPenalty = { simple: 0, medium: 15, complex: 30 }[task.complexity];
  const durationAdj =
    task.estimatedMinutes <= 20 ? 10 : task.estimatedMinutes <= 60 ? 0 : task.estimatedMinutes <= 120 ? -10 : -20;

  let suppressionPenalty = 0;
  if (task.skip) {
    const skippedAt = new Date(task.skip.skippedAt).getTime();
    const suppressUntil = new Date(task.skip.suppressUntil).getTime();
    if (now.getTime() < suppressUntil) {
      const remainingRatio = (suppressUntil - now.getTime()) / (suppressUntil - skippedAt);
      suppressionPenalty = 70 * clamp(remainingRatio, 0, 1);
    }
  }

  return Math.round(clamp(100 - complexityPenalty + durationAdj - suppressionPenalty));
}

export function createSkipRecord(reason: string, now: Date = new Date()): Task["skip"] {
  const suppressUntil = new Date(now.getTime() + SKIP_SUPPRESSION_HOURS * 60 * 60 * 1000);
  return { reason, skippedAt: now.toISOString(), suppressUntil: suppressUntil.toISOString() };
}

export function recalcTask(task: Task, now: Date = new Date()): Task {
  return {
    ...task,
    priorityScore: computePriorityScore(task, now),
    suitabilityScore: computeSuitabilityScore(task, now),
  };
}

/**
 * Open tasks in the order to do them — the same recommendation the Next page
 * shows (lib/priority.ts recommendTasks), with fresh scores on each task.
 */
export function rankTasksForNext(tasks: Task[], now: Date = new Date(), availableMinutes?: number): Task[] {
  return recommendTasks(tasks, { now, availableMinutes }).map(({ task }) => recalcTask(task, now));
}
