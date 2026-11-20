import { deadlineOnThisPhone, formatDeadline } from "@/lib/deadline";
import { formatTaskLength } from "@/lib/formatDuration";
import type { Translations } from "@/lib/i18n";
import { formatClockTime, type LocalDate } from "@/lib/localDate";
import { recommendTasks } from "@/lib/priority";
import { isRoutine } from "@/lib/recurrence";
import { buildToday } from "@/lib/schedule";
import type { Task } from "@/types/task";

/**
 * What the home screen widget shows (2026-11-19): the task on top of Today,
 * with + and Magic mic beside it — never a ✓, finishing happens in the app.
 * The phone's widget can't run the app's code, so the app works this out
 * and hands it over whenever it changes (hooks/useWidgetSync.ts): the iPhone
 * widget (widgets/NextTaskWidget.tsx) and the Android one
 * (modules/nexdo-widget) both draw from it.
 *
 * Every word is already in the app language. Only the "Today" / "Overdue"
 * part of the label is left to the widget, worked out from `dueKey` when it
 * draws, so it stays right after midnight without the app being opened.
 */
export type WidgetData = {
  signedIn: boolean;
  /** Free: the mic wears a padlock and opens the plans. */
  micLocked: boolean;
  task: WidgetTask | null;
  labels: WidgetLabels;
};

export type WidgetTask = {
  id: string;
  title: string;
  /** "30 mins", "No duration". */
  length: string;
  /** The day it's due on this phone, "YYYY-MM-DD" — none for a task without a deadline. */
  dueKey: string | null;
  /** "Fri, Nov 21" — shown for a task due after today. */
  dueText: string | null;
  /** "7:00 PM" for a deadline with a time. */
  time: string | null;
};

export type WidgetLabels = {
  next: string;
  today: string;
  overdue: string;
  allClear: string;
  allClearBody: string;
  add: string;
  mic: string;
  signIn: string;
};

/**
 * The task the widget shows: Today's top card (routines aside, as on Today),
 * or — with nothing due today — the best of all open tasks, so the widget is
 * never empty while there's something to do.
 */
export function pickWidgetTask(tasks: Task[], now: Date, today: LocalDate): Task | null {
  const cards = tasks.filter((task) => !isRoutine(task));
  const ranked = recommendTasks(cards, { now }).map((entry) => entry.task);
  const todayIds = buildToday(cards, { now, today }).ids;
  return ranked.find((task) => todayIds.has(task.id)) ?? ranked[0] ?? null;
}

export function buildWidgetData({
  tasks,
  signedIn,
  micLocked,
  now,
  today,
  t,
}: {
  tasks: Task[];
  signedIn: boolean;
  micLocked: boolean;
  now: Date;
  today: LocalDate;
  t: Translations;
}): WidgetData {
  const task = signedIn ? pickWidgetTask(tasks, now, today) : null;
  return {
    signedIn,
    micLocked,
    task: task ? widgetTask(task, t) : null,
    labels: {
      next: t.widget.next,
      today: t.widget.today,
      overdue: t.widget.overdue,
      allClear: t.widget.allClear,
      allClearBody: t.widget.allClearBody,
      add: t.widget.add,
      mic: t.widget.mic,
      signIn: t.widget.signIn,
    },
  };
}

function widgetTask(task: Task, t: Translations): WidgetTask {
  const due = task.deadline ? deadlineOnThisPhone(task.deadline) : null;
  return {
    id: task.id,
    title: task.title,
    length: formatTaskLength(task.estimatedMinutes),
    dueKey: due?.date ?? null,
    dueText: due ? formatDeadline({ date: due.date }, t.locale) : null,
    time: due?.time ? formatClockTime(due.time, t.locale) : null,
  };
}

/**
 * The label over the title — "Next · Today · 7:00 PM", "Next · Overdue",
 * "Next · Fri, Nov 21". The Android widget does the same in Kotlin
 * (NexdoWidgetRenderer.kt); the iPhone one inlines it (a widget function
 * can't call out). Here for the tests and as the reference.
 */
export function widgetDueLabel(data: WidgetData, today: LocalDate): { text: string; overdue: boolean } {
  const { task, labels } = data;
  if (!task?.dueKey) return { text: labels.next, overdue: false };
  if (task.dueKey < today) return { text: `${labels.next} · ${labels.overdue}`, overdue: true };
  if (task.dueKey === today) {
    return { text: [labels.next, labels.today, task.time].filter(Boolean).join(" · "), overdue: false };
  }
  return { text: `${labels.next} · ${task.dueText}`, overdue: false };
}
