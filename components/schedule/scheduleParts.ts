import { formatTime } from "@/components/addSheet/sheetFormat";
import { deadlineOnThisPhone } from "@/lib/deadline";
import type { Translations } from "@/lib/i18n";
import { isRoutine } from "@/lib/recurrence";
import { byRoutineOrder, type DayPlan } from "@/lib/schedule";
import type { Task } from "@/types/task";
import { shadow, SOFT_SHADOW } from "@/constants/shadow";

// What the Schedule's three views (Week, Month, Year) share: the colours and
// the way a day's tasks are listed. Sizes come from the user's screenshots of
// the design (2026-11-08), measured at 390 points wide.

/** Android adds room above and below text for accents; without it, text sits where the design puts it. */
export const TIGHT_TEXT = { includeFontPadding: false } as const;

/** The soft shadow under the light cards. */
export const CARD_SHADOW = SOFT_SHADOW;
/** The deeper one under a dark card (this month, in the year). */
export const DARK_CARD_SHADOW = shadow("0 10px 24px rgba(34, 28, 23, 0.25)", 8);

/** A thin rule between two rows of a day's list. */
export const ROW_RULE = "#EADFD1";

/** One line of a day's list: a task or a routine, open or done. */
export type DayEntry = {
  task: Task;
  /** "HH:MM", when the deadline has a time. */
  time?: string;
  minutes: number;
  overdue: boolean;
  done: boolean;
  /** A repeat's coming occurrence: shown lighter, not a real task yet (lib/schedule.ts planAhead). */
  planned: boolean;
};

/** A deadline's time by this phone's clock, as lib/schedule.ts places it on a day. */
function timeOf(task: Task): string | undefined {
  return task.deadline ? deadlineOnThisPhone(task.deadline).time : undefined;
}

/**
 * A day's tasks (open ones first, as lib/schedule.ts orders them, then the
 * coming repeating tasks, then the finished) and its routines (real and
 * coming together, in time order).
 */
export function dayEntries(plan: DayPlan | undefined): { tasks: DayEntry[]; routines: DayEntry[] } {
  if (!plan) return { tasks: [], routines: [] };
  const plannedEntry = (task: Task): DayEntry => ({ task, time: timeOf(task), minutes: task.estimatedMinutes, overdue: false, done: false, planned: true });
  const tasks: DayEntry[] = [
    ...plan.items.map((item) => ({ task: item.task, time: item.time, minutes: item.minutes, overdue: item.overdue, done: false, planned: false })),
    ...plan.planned.filter((task) => !isRoutine(task)).map(plannedEntry),
    ...plan.done.map((task) => ({ task, time: timeOf(task), minutes: task.estimatedMinutes, overdue: false, done: true, planned: false })),
  ];
  const routines: DayEntry[] = [
    ...plan.routines.map((task) => ({
      task,
      time: timeOf(task),
      minutes: task.estimatedMinutes,
      overdue: false,
      done: task.status === "completed",
      planned: false,
    })),
    ...plan.planned.filter(isRoutine).map(plannedEntry),
  ].sort((a, b) => byRoutineOrder(a.task, b.task));
  return { tasks, routines };
}

/**
 * How many tasks a day has: open, done, and repeating tasks coming on it
 * (the user's call, 2026-11-14: a task repeating every day colours every
 * day). Routines never count, real or coming.
 */
export function taskCount(plan: DayPlan | undefined): number {
  if (!plan) return 0;
  return plan.items.length + plan.done.length + plan.planned.filter((task) => !isRoutine(task)).length;
}

/** "10:00 AM" in the time column, or "ALL DAY" for a task due on the day at no set time. */
export function timeLabel(entry: DayEntry, t: Translations): string {
  // Some phones put a narrow no-break space before "AM"; Space Mono has no such character.
  if (entry.time) return formatTime(entry.time, t.locale).replace(/[  ]/g, " ");
  return t.schedule.anytimeSlot.toLocaleUpperCase(t.locale);
}

/** The first letter in capitals: some languages write month names in lower case ("novembre"). */
export function capitalize(text: string, locale: string): string {
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}
