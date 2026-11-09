// What Nexdo learns from the time spent in focus sessions: how long the
// user's tasks really take next to the length they were given ("your pace"),
// and the numbers on the Insights page. Pure functions over the session log
// (store/useFocusLogStore.ts) and the task list — nothing here leaves the
// phone, and nothing calls the AI.

import { addDaysToKey, toLocalDateKey, type LocalDate } from "@/lib/localDate";
import type { Task } from "@/types/task";

/** One focus session that ran on a timed task, saved when it ended. */
export type FocusEntry = {
  id: string;
  /** The account signed in when it ran (null when none was). Insights only reads the current account's. */
  userId: string | null;
  taskId: string;
  /** ISO 8601. */
  startedAt: string;
  endedAt: string;
  /** Time on the clock, pauses left out, capped (see lib/focusLog.ts). */
  focusedMinutes: number;
  /** The task's length when the session started. */
  estimateMinutes: number;
  /** The task was finished by the time the session ended. */
  completed: boolean;
};

/** A task finished, noted when it was done (lib/focusLog.ts watchCompletions). */
export type CompletionEntry = { taskId: string; userId: string | null; /** ISO 8601. */ at: string };

/** Short tasks and long ones run late by different amounts (long ones usually by more). */
export type PaceBucket = "short" | "long";
export const SHORT_TASK_MAX_MINUTES = 30;

export function paceBucket(minutes: number): PaceBucket {
  return minutes <= SHORT_TASK_MAX_MINUTES ? "short" : "long";
}

/** One finished task: the minutes it was given against the minutes it took. */
export type PaceSample = { estimate: number; actual: number; ratio: number; bucket: PaceBucket };

// A task given 5 minutes and done in 1 (or in 50) says more about the timer
// being left on, or forgotten, than about the user's pace.
const MIN_RATIO = 0.2;
const MAX_RATIO = 5;
const MIN_ESTIMATE = 5;

/**
 * One sample per task finished in a session. A task worked on over several
 * sessions counts their minutes together, against the length it had in the
 * first of them — a task's length shrinks as its steps get done.
 */
export function paceSamples(entries: FocusEntry[]): PaceSample[] {
  const byTask = new Map<string, FocusEntry[]>();
  for (const entry of [...entries].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    const list = byTask.get(entry.taskId);
    if (list) list.push(entry);
    else byTask.set(entry.taskId, [entry]);
  }
  const samples: PaceSample[] = [];
  for (const list of byTask.values()) {
    let actual = 0;
    let estimate: number | undefined;
    for (const entry of list) {
      estimate ??= entry.estimateMinutes;
      actual += entry.focusedMinutes;
      if (!entry.completed) continue;
      const ratio = actual / estimate;
      if (estimate >= MIN_ESTIMATE && ratio >= MIN_RATIO && ratio <= MAX_RATIO) {
        samples.push({ estimate, actual, ratio, bucket: paceBucket(estimate) });
      }
      actual = 0;
      estimate = undefined;
    }
  }
  return samples;
}

/** How many finished tasks it takes before Nexdo says anything about pace. */
export const MIN_PACE_SAMPLES = 5;
/** And before it says anything about short or long tasks on their own. */
const MIN_BUCKET_SAMPLES = 3;

export type PaceFactor = { factor: number; samples: number };
export type Pace = PaceFactor & { short?: PaceFactor; long?: PaceFactor };

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// The median, so one task that ran wildly over doesn't speak for all the rest.
function factorOf(samples: PaceSample[]): number {
  const value = Math.min(3, Math.max(0.5, median(samples.map((sample) => sample.ratio))));
  return Math.round(value * 20) / 20;
}

/** The user's pace, or null until enough tasks have been finished in a session. */
export function computePace(entries: FocusEntry[]): Pace | null {
  const samples = paceSamples(entries);
  if (samples.length < MIN_PACE_SAMPLES) return null;
  const pace: Pace = { factor: factorOf(samples), samples: samples.length };
  for (const bucket of ["short", "long"] as const) {
    const inBucket = samples.filter((sample) => sample.bucket === bucket);
    if (inBucket.length >= MIN_BUCKET_SAMPLES) pace[bucket] = { factor: factorOf(inBucket), samples: inBucket.length };
  }
  return pace;
}

/** Close enough to the length given that there's nothing worth changing. */
export function isOnPace(factor: number): boolean {
  return Math.abs(factor - 1) < 0.15;
}

/** The factor that applies to a task of this length: its own kind's if known, else the overall one. */
export function paceFactorFor(minutes: number, pace: Pace): number {
  return pace[paceBucket(minutes)]?.factor ?? pace.factor;
}

/**
 * A guessed length set to the user's pace, rounded to 5 minutes — unchanged
 * when they're on pace for tasks of that length.
 */
export function adjustToPace(minutes: number, pace: Pace | null): number {
  if (!pace || minutes <= 0) return minutes;
  const factor = paceFactorFor(minutes, pace);
  if (isOnPace(factor)) return minutes;
  return Math.max(5, Math.round((minutes * factor) / 5) * 5);
}

// ---- Insights ----

export type InsightsRange = "week" | "all";

/** One bar of the chart: a day (last 7 days) or a 7-day block (all time). */
export type InsightsBar = { start: LocalDate; end: LocalDate; focusMinutes: number; tasksDone: number };

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

export type Insights = {
  bars: InsightsBar[];
  focusMinutes: number;
  tasksDone: number;
  sessions: number;
  /** Days in a row, up to today, with at least one task done (today not counted against it until it's over). */
  streak: number;
  /** When most of the focused time happened, once there's enough of it to say. */
  bestTime: TimeOfDay | null;
};

/** Weekly bars in the all-time view. */
export const ALL_TIME_WEEKS = 12;

function timeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

/**
 * The day each finished task was done: the completions noted since the log
 * began, plus the finished tasks still on the list that it never saw (done
 * before it existed, or on another phone) — each task counted once a day.
 */
function completionDays(completions: CompletionEntry[], tasks: Task[]): LocalDate[] {
  const seen = new Set<string>();
  const days: LocalDate[] = [];
  const add = (taskId: string, at: string) => {
    const day = toLocalDateKey(new Date(at));
    const key = `${taskId}|${day}`;
    if (seen.has(key)) return;
    seen.add(key);
    days.push(day);
  };
  completions.forEach((entry) => add(entry.taskId, entry.at));
  tasks.forEach((task) => {
    if (task.status === "completed" && task.completedAt) add(task.id, task.completedAt);
  });
  return days;
}

export function buildInsights(
  entries: FocusEntry[],
  completions: CompletionEntry[],
  tasks: Task[],
  range: InsightsRange,
  now: Date = new Date(),
): Insights {
  const today = toLocalDateKey(now);
  const barDays = range === "week" ? 1 : 7;
  const barCount = range === "week" ? 7 : ALL_TIME_WEEKS;
  const bars: InsightsBar[] = Array.from({ length: barCount }, (_, index) => {
    const end = addDaysToKey(today, -(barCount - 1 - index) * barDays);
    return { start: addDaysToKey(end, -(barDays - 1)), end, focusMinutes: 0, tasksDone: 0 };
  });
  const barFor = (day: LocalDate) => bars.find((bar) => bar.start <= day && day <= bar.end);
  const firstDay = bars[0].start;
  // Last 7 days: what's in the bars. All time: everything, even before the chart starts.
  const inRange = (day: LocalDate) => range === "all" || day >= firstDay;

  let focusMinutes = 0;
  let sessions = 0;
  const byTime: Record<TimeOfDay, number> = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  for (const entry of entries) {
    const started = new Date(entry.startedAt);
    const day = toLocalDateKey(started);
    if (!inRange(day) || day > today) continue;
    focusMinutes += entry.focusedMinutes;
    sessions += 1;
    byTime[timeOfDay(started.getHours())] += entry.focusedMinutes;
    const bar = barFor(day);
    if (bar) bar.focusMinutes += entry.focusedMinutes;
  }

  let tasksDone = 0;
  const doneDays = new Set<LocalDate>();
  for (const day of completionDays(completions, tasks)) {
    doneDays.add(day);
    if (!inRange(day) || day > today) continue;
    tasksDone += 1;
    const bar = barFor(day);
    if (bar) bar.tasksDone += 1;
  }

  // Today still has time left: an empty today doesn't break yesterday's run.
  let streak = 0;
  let day = doneDays.has(today) ? today : addDaysToKey(today, -1);
  while (doneDays.has(day)) {
    streak += 1;
    day = addDaysToKey(day, -1);
  }

  const ranked = (Object.entries(byTime) as [TimeOfDay, number][]).sort((a, b) => b[1] - a[1]);
  const bestTime = sessions >= 3 && focusMinutes >= 60 ? ranked[0][0] : null;

  return {
    bars: bars.map((bar) => ({ ...bar, focusMinutes: Math.round(bar.focusMinutes) })),
    focusMinutes: Math.round(focusMinutes),
    tasksDone,
    sessions,
    streak,
    bestTime,
  };
}
