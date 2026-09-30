import type { Task } from "@/types/task";

// The priority engine: a task's score, and which task to do next. Entirely
// the app's own arithmetic — the AI can say how important or how long a task
// is, but never what its score is — and pure, so it's tested on its own
// (tests/priority.test.ts).
//
//   score = 0.45 × Urgency + 0.35 × Importance + 0.20 × Effort      (0–100)
//
// Urgency is how close the deadline is once the task's own length is taken
// off it; Importance is the level the user picked or said; Effort grows with
// the task's length — a 1-hour task matters more than a 2-minute one.
//
// Two multipliers then hold a task back for now without changing what it's
// worth: Readiness (a snooze still running, a repeating task's occurrence
// whose day hasn't come) and, on the Next page only, Time fit ("I have 20
// minutes"), which never reaches the stored score.
//
// The weights and curves are the formula the user chose on 2026-09-30, a
// starting point rather than a measured optimum; they live here so they can
// be tuned in one place.

export const PRIORITY_WEIGHTS = {
  urgency: 0.45,
  importance: 0.35,
  effort: 0.2,
} as const;

/** How much better another task has to score before it replaces the one on top of the Next page. */
export const RECOMMENDATION_STABILITY_MARGIN = 5;

const DAY_MS = 24 * 60 * 60 * 1000;
const NO_DEADLINE_URGENCY = 15;
/** A task with no length yet counts as about half an hour's work. */
const UNKNOWN_EFFORT = 50;

// [days of slack, urgency]: time left before the deadline minus the time the
// task needs. A long task becomes urgent sooner than a short one due at the
// same moment. Between two points the score follows the line joining them,
// so it rises smoothly instead of jumping at midnight. Past 30 days a
// deadline still counts for a little more than none at all.
const URGENCY_CURVE: [number, number][] = [
  [0, 100],
  [0.5, 92],
  [1, 85],
  [2, 72],
  [3, 62],
  [5, 45],
  [7, 35],
  [14, 22],
  [30, 18],
];

// [minutes, effort]: steep at first, then levelling off — 2 minutes against
// an hour is a big difference, 4 hours against 6 a small one.
const EFFORT_CURVE: [number, number][] = [
  [0, 0],
  [2, 4],
  [5, 10],
  [15, 30],
  [30, 50],
  [60, 70],
  [120, 85],
  [240, 100],
];

// Readiness multipliers: a snoozed task starts at this and climbs back to ×1
// as its snooze runs out; an occurrence whose day hasn't come stays at the other.
const SNOOZED_FACTOR = 0.3;
const NOT_YET_DUE_OCCURRENCE_FACTOR = 0.6;

// Time fit multipliers, for "I have N minutes": the whole task fits, only its
// next step does, or neither. Strong enough that what fits comes first even
// though a longer task is otherwise worth more (Effort).
const TIME_FIT_FACTORS = { fits: 1, stepFits: 0.7, tooLong: 0.4 } as const;

/** The value at `x` on a curve of [x, y] points, straight between them and flat past either end. */
function onCurve(curve: [number, number][], x: number): number {
  if (x <= curve[0][0]) return curve[0][1];
  for (let index = 1; index < curve.length; index += 1) {
    const [x1, y1] = curve[index];
    if (x <= x1) {
      const [x0, y0] = curve[index - 1];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return curve[curve.length - 1][1];
}

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
  effort: number;
  /** ×0.3–×1: held back while snoozed or not yet due. */
  readiness: number;
  /** ×0.5–×1 for the time the user said they have; null when they haven't said. */
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
 * From the deadline and the time the task needs: its slack, read off
 * URGENCY_CURVE. Overdue, or more work left than time left, is the top of the
 * scale, not beyond it — a task a month late isn't made ever more urgent. No
 * deadline keeps a modest baseline, so those tasks still get recommended.
 */
export function urgencyScore(task: PriorityInput, now: Date): number {
  if (!task.dueDate || Number.isNaN(Date.parse(task.dueDate))) return NO_DEADLINE_URGENCY;
  const msLeft = Date.parse(task.dueDate) - now.getTime();
  const msNeeded = Math.max(0, task.estimatedMinutes || 0) * 60_000;
  const slackDays = (msLeft - msNeeded) / DAY_MS;
  if (msLeft <= 0 || slackDays <= 0) return 100;
  return Math.round(onCurve(URGENCY_CURVE, slackDays));
}

/**
 * What the user (or the AI, from their words) set: 20 / 50 / 80 for the three
 * levels, 100 when they stressed it (lib/scoring.ts). Never read off the
 * deadline or the length — those are the other two signals.
 */
export function importanceScore(task: PriorityInput): number {
  return clamp(Number.isFinite(task.importance) ? task.importance : 50);
}

/** The task's length, read off EFFORT_CURVE: the longer it takes, the more it counts. */
export function effortScore(task: PriorityInput): number {
  if (!Number.isFinite(task.estimatedMinutes) || task.estimatedMinutes <= 0) return UNKNOWN_EFFORT;
  return Math.round(onCurve(EFFORT_CURVE, task.estimatedMinutes));
}

/**
 * Whether the task can be worked on right now, as a multiplier. A task the
 * user snoozed ("not now") comes back gradually as its snooze runs out; a
 * repeating task's occurrence whose day hasn't come yet can be done early,
 * but isn't what today is for. Nexdo doesn't track dependencies between
 * tasks yet, so no task is scored as blocked by another.
 */
export function readinessFactor(task: PriorityInput, now: Date): number {
  let factor = 1;
  if (task.skip) {
    const skippedAt = Date.parse(task.skip.skippedAt);
    const until = Date.parse(task.skip.suppressUntil);
    if (now.getTime() < until && until > skippedAt) {
      const elapsed = clamp((now.getTime() - skippedAt) / (until - skippedAt), 0, 1);
      factor = SNOOZED_FACTOR + (1 - SNOOZED_FACTOR) * elapsed;
    }
  }
  if (task.recurrence && task.dueDate && daysUntil(task.dueDate, now) > 0) {
    factor = Math.min(factor, NOT_YET_DUE_OCCURRENCE_FACTOR);
  }
  return factor;
}

/**
 * How well the task suits the time the user said they have, as a multiplier:
 * all of it fits, its next step fits (real progress, if not the whole
 * thing), or neither. Null without a stated budget — Nexdo never assumes the
 * user's calendar.
 */
export function timeFitFactor(task: PriorityInput, availableMinutes: number | undefined): number | null {
  if (availableMinutes === undefined || !Number.isFinite(availableMinutes) || availableMinutes <= 0) return null;
  if (task.estimatedMinutes > 0 && task.estimatedMinutes <= availableMinutes) return TIME_FIT_FACTORS.fits;
  const step = task.subtasks?.find((subtask) => subtask.id === task.currentStepId && subtask.status !== "completed");
  if (step && step.estimatedMinutes <= availableMinutes) return TIME_FIT_FACTORS.stepFits;
  return TIME_FIT_FACTORS.tooLong;
}

export function priorityBreakdown(task: PriorityInput, context: PriorityContext): PriorityBreakdown {
  const urgency = urgencyScore(task, context.now);
  const importance = importanceScore(task);
  const effort = effortScore(task);
  const readiness = readinessFactor(task, context.now);
  const timeFit = timeFitFactor(task, context.availableMinutes);

  const worth =
    PRIORITY_WEIGHTS.urgency * urgency + PRIORITY_WEIGHTS.importance * importance + PRIORITY_WEIGHTS.effort * effort;
  const score = Math.round(clamp(worth * readiness * (timeFit ?? 1)));
  return { urgency, importance, effort, readiness, timeFit, score };
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
