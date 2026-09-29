import type { Task } from "@/types/task";

// The priority engine: a task's score, and which task to do next. Entirely
// the app's own arithmetic — the AI can say how important or how long a task
// is, but never what its score is — and pure, so it's tested on its own
// (tests/priority.test.ts).
//
//   score = 0.40 × Urgency + 0.30 × Importance + 0.15 × Readiness + 0.15 × Time fit
//
// Each signal is 0–100. A signal the app has no information for is left out
// and the rest are re-weighted to still add up to 100 — so without a stated
// time budget, "time fit" plays no part rather than being guessed. These
// weights are a starting point, not a measured optimum; they live in one
// place so they can be tuned.

export const PRIORITY_WEIGHTS = {
  urgency: 0.4,
  importance: 0.3,
  readiness: 0.15,
  timeFit: 0.15,
} as const;

/** How much better another task has to score before it replaces the one on top of the Next page. */
export const RECOMMENDATION_STABILITY_MARGIN = 5;

const DAY_MS = 24 * 60 * 60 * 1000;
const NO_DEADLINE_URGENCY = 15;

export type PriorityInput = Pick<Task, "dueDate" | "estimatedMinutes" | "importance"> &
  Partial<Pick<Task, "status" | "skip" | "recurrence" | "subtasks" | "currentStepId">>;

export type PriorityContext = {
  now: Date;
  /** Minutes the user has said they have right now. Unknown unless they said. */
  availableMinutes?: number;
};

export type PriorityBreakdown = {
  urgency: number;
  importance: number;
  readiness: number;
  /** Null when the user hasn't said how much time they have. */
  timeFit: number | null;
  score: number;
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Calendar days until the deadline — the same day math as the due labels (lib/taskMeta.ts), so they agree. */
function daysUntil(dueDate: string, now: Date): number {
  return Math.round((startOfDay(new Date(dueDate)) - startOfDay(now)) / DAY_MS);
}

/**
 * From the deadline alone, in whole days so the score doesn't drift minute
 * by minute. Overdue is the top of the scale, not beyond it: a task a month
 * late isn't made ever more urgent. A task that can no longer fit before its
 * deadline (more work left than time left) counts as due now. No deadline
 * keeps a modest baseline, so those tasks still get recommended.
 */
export function urgencyScore(task: PriorityInput, now: Date): number {
  if (!task.dueDate || Number.isNaN(Date.parse(task.dueDate))) return NO_DEADLINE_URGENCY;
  const minutesLeft = (Date.parse(task.dueDate) - now.getTime()) / 60_000;
  if (minutesLeft < 0) return 100;
  if (task.estimatedMinutes > 0 && task.estimatedMinutes > minutesLeft) return 100;
  const days = daysUntil(task.dueDate, now);
  if (days <= 0) return 95;
  if (days === 1) return 85;
  if (days <= 3) return 65;
  if (days <= 7) return 40;
  if (days <= 14) return 25;
  return 20;
}

/** Only what the user (or the AI, from their words) set — duration never lowers it. */
export function importanceScore(task: PriorityInput): number {
  return clamp(Number.isFinite(task.importance) ? task.importance : 50);
}

/**
 * Whether the task can be worked on right now. A task the user snoozed ("not
 * now") comes back gradually as its snooze runs out; a repeating task's
 * occurrence whose day hasn't come yet can be done early, but isn't what
 * today is for. Nexdo doesn't track dependencies between tasks yet, so no
 * task is scored as blocked by another.
 */
export function readinessScore(task: PriorityInput, now: Date): number {
  let score = 100;
  if (task.skip) {
    const skippedAt = Date.parse(task.skip.skippedAt);
    const until = Date.parse(task.skip.suppressUntil);
    if (now.getTime() < until && until > skippedAt) {
      score = Math.round(100 * clamp((now.getTime() - skippedAt) / (until - skippedAt), 0, 1));
    }
  }
  if (task.recurrence && task.dueDate && daysUntil(task.dueDate, now) > 0) score = Math.min(score, 40);
  return score;
}

/**
 * How well the task suits the time the user said they have: all of it fits,
 * its next step fits (real progress, if not the whole thing), or neither.
 * Null without a stated budget — Nexdo never assumes the user's calendar.
 */
export function timeFitScore(task: PriorityInput, availableMinutes: number | undefined): number | null {
  if (availableMinutes === undefined || !Number.isFinite(availableMinutes) || availableMinutes <= 0) return null;
  if (task.estimatedMinutes > 0 && task.estimatedMinutes <= availableMinutes) return 100;
  const step = task.subtasks?.find((subtask) => subtask.id === task.currentStepId && subtask.status !== "completed");
  if (step && step.estimatedMinutes <= availableMinutes) return 60;
  return 10;
}

export function priorityBreakdown(task: PriorityInput, context: PriorityContext): PriorityBreakdown {
  const urgency = urgencyScore(task, context.now);
  const importance = importanceScore(task);
  const readiness = readinessScore(task, context.now);
  const timeFit = timeFitScore(task, context.availableMinutes);

  let weighted = PRIORITY_WEIGHTS.urgency * urgency + PRIORITY_WEIGHTS.importance * importance + PRIORITY_WEIGHTS.readiness * readiness;
  let weights = PRIORITY_WEIGHTS.urgency + PRIORITY_WEIGHTS.importance + PRIORITY_WEIGHTS.readiness;
  if (timeFit !== null) {
    weighted += PRIORITY_WEIGHTS.timeFit * timeFit;
    weights += PRIORITY_WEIGHTS.timeFit;
  }
  return { urgency, importance, readiness, timeFit, score: Math.round(clamp(weighted / weights)) };
}

export function computeScore(task: PriorityInput, context: PriorityContext): number {
  return priorityBreakdown(task, context).score;
}

/** Open and not put away — the only tasks that can be recommended. */
export function isActionable(task: Pick<Task, "status">): boolean {
  return task.status === "pending";
}

export type Recommendation = { task: Task; score: number; pinned: boolean };

/**
 * Open tasks in the order to do them. Pinned tasks come first (the user's
 * own ordering always wins), newest pin first; then by score; ties go to the
 * earlier deadline, then the older task, then the id — so the order never
 * depends on the order tasks happen to be stored in.
 *
 * `previousTopId` keeps the task that was on top there unless another beats
 * it by more than RECOMMENDATION_STABILITY_MARGIN — a score that moves by a
 * point as the day turns shouldn't swap the card the user is looking at.
 */
export function recommendTasks(
  tasks: Task[],
  context: PriorityContext,
  previousTopId?: string,
): Recommendation[] {
  const ranked = tasks
    .filter(isActionable)
    .map((task) => ({ task, score: computeScore(task, context), pinned: !!task.pinnedAt }))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.pinned && b.pinned) return Date.parse(b.task.pinnedAt!) - Date.parse(a.task.pinnedAt!);
      if (b.score !== a.score) return b.score - a.score;
      const aDue = a.task.dueDate ? Date.parse(a.task.dueDate) : Number.POSITIVE_INFINITY;
      const bDue = b.task.dueDate ? Date.parse(b.task.dueDate) : Number.POSITIVE_INFINITY;
      if (aDue !== bDue) return aDue - bDue;
      const created = Date.parse(a.task.createdAt) - Date.parse(b.task.createdAt);
      if (created !== 0 && !Number.isNaN(created)) return created;
      return a.task.id < b.task.id ? -1 : a.task.id > b.task.id ? 1 : 0;
    });

  if (!previousTopId || ranked.length < 2 || ranked[0].task.id === previousTopId) return ranked;
  const previousIndex = ranked.findIndex((entry) => entry.task.id === previousTopId);
  if (previousIndex < 0) return ranked;
  const previous = ranked[previousIndex];
  const top = ranked[0];
  // A pin, or a clear lead, is a real reason to change the card on top.
  if (top.pinned || top.score - previous.score > RECOMMENDATION_STABILITY_MARGIN) return ranked;
  return [previous, ...ranked.slice(0, previousIndex), ...ranked.slice(previousIndex + 1)];
}
