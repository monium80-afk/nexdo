import { addDaysToKey, daysBetweenKeys, weekdayOf, type LocalDate } from "@/lib/localDate";
import { computeScore, isActionable } from "@/lib/priority";
import type { Task } from "@/types/task";

// The days behind the Schedule screen and the Today page: each task on the
// day it's due. Pure and derived on the spot — never stored — so it follows
// every tick, new task and moved deadline by itself, and costs no AI.
//
// One rule, no planning (the user's call, 2026-10-07):
// - A task is on its deadline's day. One that's late stays on the day it was
//   due, shown there as overdue — it isn't carried over to today.
// - A task without a deadline is on no day: it's in the Tasks tab.
// - A finished task shows, ticked, on the day it was due.
// There's no amount of work a day is filled up to. That may come back later
// as a feature of its own.

/** A task with no length yet counts as about half an hour's work. */
const UNKNOWN_MINUTES = 30;

export type ScheduleItem = {
  task: Task;
  minutes: number;
  /** The user's own time ("HH:MM"), for a deadline that has one. */
  time?: string;
  /** Its deadline has already passed. */
  overdue: boolean;
};

export type DayPlan = {
  date: LocalDate;
  /** The open tasks due on the day: late ones first, then those with a time, by time, then the most worth doing. */
  items: ScheduleItem[];
  /** The finished tasks that were due on the day, in the order they were done. */
  done: Task[];
  /** How long the open tasks take, together. */
  plannedMinutes: number;
};

export type ScheduleOptions = {
  now: Date;
  /** The first day and the last, both included. */
  from: LocalDate;
  until: LocalDate;
};

function minutesOf(minutes: number): number {
  return Number.isFinite(minutes) && minutes > 0 ? minutes : UNKNOWN_MINUTES;
}

function isOverdue(task: Task, now: Date): boolean {
  return !!task.dueDate && Date.parse(task.dueDate) < now.getTime();
}

function completedAt(task: Task): number {
  const at = task.completedAt ? Date.parse(task.completedAt) : Number.NaN;
  return Number.isFinite(at) ? at : 0;
}

/** Each day from `from` through `until`, with the tasks due on it. */
export function buildSchedule(tasks: Task[], { now, from, until }: ScheduleOptions): DayPlan[] {
  const days: DayPlan[] = Array.from({ length: Math.max(0, daysBetweenKeys(from, until) + 1) }, (_, index) => ({
    date: addDaysToKey(from, index),
    items: [],
    done: [],
    plannedMinutes: 0,
  }));
  const scores = new Map<string, number>();

  for (const task of tasks) {
    const date = task.deadline?.date;
    if (!date) continue;
    const day = days[daysBetweenKeys(from, date)];
    if (!day) continue;
    if (task.status === "completed") {
      day.done.push(task);
      continue;
    }
    if (!isActionable(task)) continue;
    const minutes = minutesOf(task.estimatedMinutes);
    day.items.push({ task, minutes, time: task.deadline?.time, overdue: isOverdue(task, now) });
    day.plannedMinutes += minutes;
    scores.set(task.id, computeScore(task, { now }));
  }

  for (const day of days) {
    day.items.sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      if (!!a.time !== !!b.time) return a.time ? -1 : 1;
      if (a.time && b.time && a.time !== b.time) return a.time < b.time ? -1 : 1;
      const score = (scores.get(b.task.id) ?? 0) - (scores.get(a.task.id) ?? 0);
      if (score !== 0) return score;
      return a.task.id < b.task.id ? -1 : a.task.id > b.task.id ? 1 : 0;
    });
    day.done.sort((a, b) => completedAt(a) - completedAt(b));
  }
  return days;
}

/** Monday of the week `date` is in — the Schedule's weeks run Monday to Sunday. */
export function weekStart(date: LocalDate): LocalDate {
  return addDaysToKey(date, -((weekdayOf(date) + 6) % 7));
}
