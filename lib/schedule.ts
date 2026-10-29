import { deadlineOnThisPhone } from "@/lib/deadline";
import { addDaysToKey, daysBetweenKeys, toLocalDateKey, weekdayOf, type LocalDate } from "@/lib/localDate";
import { computeScore, isActionable } from "@/lib/priority";
import { isRoutine } from "@/lib/recurrence";
import type { Task } from "@/types/task";

// The days behind the Schedule screen and the Today page: each task on the
// day it's due. Pure and derived on the spot — never stored — so it follows
// every tick, new task and moved deadline by itself, and costs no AI.
//
// One rule, no planning (the user's call, 2026-10-07):
// - A task is on its deadline's day. On the Schedule one that's late stays on
//   the day it was due, shown there as overdue; the Today page also carries it
//   over until it's done (buildToday, since 2026-10-26).
// - A task without a deadline is on no day: it's in the Tasks tab.
// - A finished task shows, ticked, on the day it was due.
// - A routine (lib/recurrence.ts isRoutine) isn't one of a day's tasks: it's
//   in the day's own routines list, open or done, and adds nothing to the
//   day's work, its count or its dot (the user's call, 2026-10-28). A missed
//   one simply passes, so it's never shown as late.
// There's no amount of work a day is filled up to. That may come back later
// as a feature of its own.

/** A task whose length can't be read counts as about half an hour's work. 0 is "No duration" and stays 0. */
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
  /** The day's routines, open or done: kept apart from its tasks (byRoutineOrder). */
  routines: Task[];
  /** How long the open tasks take, together. */
  plannedMinutes: number;
};

/** Routines in a day's list: those with a time first, in time order, then the rest by title. */
export function byRoutineOrder(a: Task, b: Task): number {
  const aTime = a.deadline?.time;
  const bTime = b.deadline?.time;
  if (!!aTime !== !!bTime) return aTime ? -1 : 1;
  if (aTime && bTime && aTime !== bTime) return aTime < bTime ? -1 : 1;
  return a.title.localeCompare(b.title);
}

export type ScheduleOptions = {
  now: Date;
  /** The first day and the last, both included. */
  from: LocalDate;
  until: LocalDate;
};

function minutesOf(minutes: number): number {
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : UNKNOWN_MINUTES;
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
    routines: [],
    plannedMinutes: 0,
  }));
  const scores = new Map<string, number>();

  for (const task of tasks) {
    if (!task.deadline) continue;
    // By this phone's clock, as the deadline is shown and reminded about —
    // an exact one set in another time zone can land on a different day here.
    const { date, time } = deadlineOnThisPhone(task.deadline);
    const day = days[daysBetweenKeys(from, date)];
    if (!day) continue;
    if (isRoutine(task)) {
      if (task.status === "completed" || task.status === "pending") day.routines.push(task);
      continue;
    }
    if (task.status === "completed") {
      day.done.push(task);
      continue;
    }
    if (!isActionable(task)) continue;
    const minutes = minutesOf(task.estimatedMinutes);
    day.items.push({ task, minutes, time, overdue: isOverdue(task, now) });
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
    day.routines.sort(byRoutineOrder);
  }
  return days;
}

export type TodayList = {
  /** The open tasks on today's list: those due today, and late ones from earlier days. */
  ids: Set<string>;
  /** Which of those are late — due on a day already gone. */
  lateIds: Set<string>;
  /** Finished: the tasks due today (whenever they were done), and late ones finished today. */
  done: number;
};

/**
 * The Today page's list. Unlike the Schedule, where a late task stays on the
 * day it was due, Today carries it over until it's done or moved (the user's
 * call, 2026-10-26 — "a task you missed yesterday never shows again" was the
 * problem). A task without a deadline still isn't on it.
 */
export function buildToday(tasks: Task[], { now, today }: { now: Date; today: LocalDate }): TodayList {
  const list: TodayList = { ids: new Set(), lateIds: new Set(), done: 0 };
  for (const task of tasks) {
    // Routines are listed apart, under the cards (components/TodayRoutines.tsx).
    if (!task.deadline || isRoutine(task)) continue;
    const { date } = deadlineOnThisPhone(task.deadline);
    if (task.status === "completed") {
      const finishedToday = !!task.completedAt && toLocalDateKey(new Date(task.completedAt)) === today;
      if (date === today || (date < today && finishedToday)) list.done += 1;
      continue;
    }
    if (!isActionable(task) || date > today) continue;
    list.ids.add(task.id);
    if (date < today) list.lateIds.add(task.id);
  }
  return list;
}

/** Monday of the week `date` is in — the Schedule's weeks run Monday to Sunday. */
export function weekStart(date: LocalDate): LocalDate {
  return addDaysToKey(date, -((weekdayOf(date) + 6) % 7));
}
