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

// The score bands, as the AI is told them (EXECUTION_COACH_INTEGRATION_NOTES
// in data/aiPrompts.ts). Set for the 2026-09-30 formula, where a medium task
// with no deadline sits in the mid-30s.
export function getScoreTier(score: number): ScoreTier {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

export type DueTone = "overdue" | "today" | "urgent" | "upcoming" | "muted";

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
  if (task.status === "archived" || task.status === "skipped") {
    const label = task.status === "archived" ? t.due.archived : t.due.skipped;
    return { label, tone: "muted", pillLabel: label };
  }

  if (!task.dueDate) {
    return { label: t.due.noDeadline, tone: "upcoming", pillLabel: t.due.noDeadline };
  }

  const due = new Date(task.dueDate);
  const dayDiff = Math.round((startOfDay(due).getTime() - startOfDay(now).getTime()) / DAY_MS);
  const time = due.toLocaleTimeString(t.locale, { hour: "numeric", minute: "2-digit" });
  // A date-only deadline ("Oct 15") is shown as its day. Its dueDate is the
  // end of that day, which is when it turns overdue — not a time to show.
  const dateOnly = !!task.deadline && !task.deadline.time;

  if (dayDiff < 0 || (dayDiff === 0 && due.getTime() < now.getTime())) {
    const daysOverdue = Math.abs(dayDiff);
    const label = dayDiff === 0 ? t.due.overdue : t.due.daysOverdue(daysOverdue);
    return {
      label,
      tone: "overdue",
      pillLabel:
        dayDiff === 0
          ? t.due.overdue
          : dateOnly
            ? t.due.dueAgoDay(daysOverdue)
            : t.due.dueAgo(daysOverdue, time),
    };
  }

  if (dayDiff === 0) {
    return { label: t.due.dueToday, tone: "today", pillLabel: dateOnly ? t.due.dueToday : t.due.dueTodayBy(time) };
  }

  if (dayDiff === 1) {
    return { label: t.due.dueTomorrow, tone: "urgent", pillLabel: dateOnly ? t.due.dueTomorrow : t.due.dueTomorrowAt(time) };
  }

  if (dayDiff <= 7) {
    const weekday = due.toLocaleDateString(t.locale, { weekday: "long" });
    return { label: t.due.inDays(dayDiff), tone: "urgent", pillLabel: dateOnly ? t.due.dueOn(weekday) : t.due.dueOnAt(weekday, time) };
  }

  const dateLabel = due.toLocaleDateString(t.locale, { month: "short", day: "numeric" });
  return { label: t.due.inDays(dayDiff), tone: "upcoming", pillLabel: dateOnly ? t.due.dueOn(dateLabel) : t.due.dueOnAt(dateLabel, time) };
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
