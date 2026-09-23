import { translate, type Translations } from "@/lib/i18n";
import type { Task } from "@/types/task";

export type ScoreTier = "high" | "medium" | "low";

// Which tasks a bulk action ("remove all my completed tasks") applies to.
export type TaskScope = "all" | "completed" | "pending";

export function tasksInScope(tasks: Task[], scope: TaskScope): Task[] {
  return scope === "all" ? tasks : tasks.filter((task) => task.status === scope);
}

/** "12 tasks", "1 completed task", "3 pending tasks" — in the app language. */
export function describeTaskCount(count: number, scope: TaskScope): string {
  return translate().format.scopedTaskCount(count, scope);
}

// Thresholds mirror prompt_material/01-design-system.txt's urgency scale.
export function getScoreTier(score: number): ScoreTier {
  if (score >= 75) return "high";
  if (score >= 45) return "medium";
  return "low";
}

export type DueTone = "overdue" | "urgent" | "upcoming" | "muted";

export type DueInfo = {
  label: string;
  tone: DueTone;
  pillLabel: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function getDueInfo(task: Task, now: Date = new Date()): DueInfo {
  const t = translate();

  if (task.status === "completed") {
    return { label: t.due.completed, tone: "muted", pillLabel: t.due.completed };
  }

  if (!task.dueDate) {
    return { label: t.due.noDeadline, tone: "muted", pillLabel: t.due.noDeadline };
  }

  const due = new Date(task.dueDate);
  const dayDiff = Math.round((startOfDay(due).getTime() - startOfDay(now).getTime()) / DAY_MS);
  const time = due.toLocaleTimeString(t.locale, { hour: "numeric", minute: "2-digit" });

  if (dayDiff < 0) {
    const daysOverdue = Math.abs(dayDiff);
    return { label: t.due.daysOverdue(daysOverdue), tone: "overdue", pillLabel: t.due.dueAgo(daysOverdue, time) };
  }

  if (dayDiff === 0) {
    return { label: t.due.dueToday, tone: "urgent", pillLabel: t.due.dueTodayBy(time) };
  }

  if (dayDiff === 1) {
    return { label: t.due.dueTomorrow, tone: "urgent", pillLabel: t.due.dueTomorrowAt(time) };
  }

  if (dayDiff <= 6) {
    const weekday = due.toLocaleDateString(t.locale, { weekday: "long" });
    return { label: t.due.inDays(dayDiff), tone: "upcoming", pillLabel: t.due.dueOnAt(weekday, time) };
  }

  const dateLabel = due.toLocaleDateString(t.locale, { month: "short", day: "numeric" });
  return { label: t.due.inDays(dayDiff), tone: "upcoming", pillLabel: t.due.dueOnAt(dateLabel, time) };
}

// A lighter-weight cousin of getDueInfo above — that one takes a full Task,
// but a draft the AI has just extracted hasn't been created yet and only has a
// dueDate to go on (no status/id/etc. to fabricate just to satisfy the type).
// No urgency tint: a draft is a preview, so the caller picks the colour.
// The time is only shown when the user actually said one — otherwise the hour
// on dueDate is just a default and would read as a time they never gave.
export function previewDueLabel(
  dueDate: string | undefined,
  hasTime: boolean | undefined,
  now: Date,
  t: Translations,
): string {
  if (!dueDate) return t.due.noDeadline;
  const due = new Date(dueDate);
  const dayDiff = Math.round((startOfDay(due).getTime() - startOfDay(now).getTime()) / DAY_MS);
  const time = hasTime ? `, ${due.toLocaleTimeString(t.locale, { hour: "numeric", minute: "2-digit" })}` : "";
  if (dayDiff < 0) return `${t.due.overdue}${time}`;
  if (dayDiff === 0) return `${t.due.dueToday}${time}`;
  if (dayDiff === 1) return `${t.due.dueTomorrow}${time}`;
  // Weekday plus date — a bare "Tuesday" read as the wrong day for "in six days".
  if (dayDiff <= 6) return `${due.toLocaleDateString(t.locale, { weekday: "short", month: "short", day: "numeric" })}${time}`;
  return `${due.toLocaleDateString(t.locale, { month: "short", day: "numeric" })}${time}`;
}

// Colors the task list's deadline tag: red / yellow / green.
export type DeadlineUrgency = "close" | "normal" | "far";

/** 2 days or less (overdue included) is close, 3-7 days is normal, anything later — or no deadline — is far. */
export function getDeadlineUrgency(task: Task, now: Date = new Date()): DeadlineUrgency {
  if (!task.dueDate) return "far";
  const dayDiff = Math.round((startOfDay(new Date(task.dueDate)).getTime() - startOfDay(now).getTime()) / DAY_MS);
  if (dayDiff <= 2) return "close";
  if (dayDiff <= 7) return "normal";
  return "far";
}
