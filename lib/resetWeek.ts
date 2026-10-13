import { deadlineOnThisPhone } from "@/lib/deadline";
import { addDaysToKey, toLocalDateKey, type LocalDate } from "@/lib/localDate";
import { computeScore, isActionable } from "@/lib/priority";
import type { Task } from "@/types/task";

// "Reset my week": the open tasks whose deadline day has gone by, and a new
// day for each over the coming week. Late tasks stay on the day they were due
// (lib/schedule.ts) — this is how the user moves them on, all at once, after
// seeing where each would go. Pure and on the phone: no AI, no cost.
//
// Repeating tasks are left out: their days come from their repeat (and its
// "if one is missed" rule), so they aren't moved by hand.

/** How many days, today included, the slipped tasks are spread over. */
export const RESET_DAYS = 7;

/** A task without a readable length counts as about half an hour; "No duration" (0) stays 0. */
const UNKNOWN_MINUTES = 30;

/**
 * How much later in the week a day may be before it stops being worth it to
 * avoid a fuller one. Each day further out costs this many minutes of load, so
 * the most pressing tasks land early unless those days are already full.
 */
const LATER_DAY_COST_MINUTES = 20;

function minutesOf(task: Task): number {
  return Number.isFinite(task.estimatedMinutes) && task.estimatedMinutes >= 0 ? task.estimatedMinutes : UNKNOWN_MINUTES;
}

/** The day a task is due on this phone, if it has a deadline. */
function dueDay(task: Task): LocalDate | undefined {
  return task.deadline ? deadlineOnThisPhone(task.deadline).date : undefined;
}

/** Open, one-off tasks whose deadline day is before today — most worth doing first. */
export function slippedTasks(tasks: Task[], now: Date): Task[] {
  const today = toLocalDateKey(now);
  return tasks
    .filter((task) => {
      if (!isActionable(task) || task.recurrence) return false;
      const day = dueDay(task);
      return day !== undefined && day < today;
    })
    .map((task) => ({ task, score: computeScore(task, { now }) }))
    .sort((a, b) => b.score - a.score || (a.task.id < b.task.id ? -1 : 1))
    .map((entry) => entry.task);
}

/**
 * A new day for each slipped task, over today and the next six days. Each task,
 * most pressing first, goes to the day with the least work already on it —
 * counting what's already due there and what this reset has put there — with
 * later days costing a little more, so urgent ones aren't pushed to the end of
 * the week just because today has something on it.
 */
export function proposeReset(tasks: Task[], now: Date): Map<string, LocalDate> {
  const today = toLocalDateKey(now);
  const days = Array.from({ length: RESET_DAYS }, (_, index) => addDaysToKey(today, index));
  const slipped = slippedTasks(tasks, now);
  const slippedIds = new Set(slipped.map((task) => task.id));

  const load = new Map(days.map((day) => [day, 0]));
  for (const task of tasks) {
    if (!isActionable(task) || slippedIds.has(task.id)) continue;
    const day = dueDay(task);
    if (day !== undefined && load.has(day)) load.set(day, load.get(day)! + minutesOf(task));
  }

  const proposal = new Map<string, LocalDate>();
  for (const task of slipped) {
    let best = days[0];
    let bestCost = Number.POSITIVE_INFINITY;
    days.forEach((day, index) => {
      const cost = load.get(day)! + index * LATER_DAY_COST_MINUTES;
      if (cost < bestCost) {
        best = day;
        bestCost = cost;
      }
    });
    proposal.set(task.id, best);
    load.set(best, load.get(best)! + minutesOf(task));
  }
  return proposal;
}

/**
 * The deadline a slipped task gets on its new day: the same time of day if it
 * had one and that time is still ahead, otherwise the day alone — a time
 * already gone by today would make it late again at once.
 */
export function resetDeadline(task: Task, date: LocalDate, now: Date): { date: LocalDate; time?: string } {
  const time = task.deadline ? deadlineOnThisPhone(task.deadline).time : undefined;
  if (!time) return { date };
  if (date !== toLocalDateKey(now)) return { date, time };
  const [hours, minutes] = time.split(":").map(Number);
  const at = new Date(now);
  at.setHours(hours, minutes, 0, 0);
  return at.getTime() > now.getTime() ? { date, time } : { date };
}
