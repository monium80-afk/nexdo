import { deadlineInstant } from "@/lib/deadline";
import type { Translations } from "@/lib/i18n";
import { addDaysToKey, isLocalDateKey, keyParts, toLocalDateKey } from "@/lib/localDate";
import { recommendTasks } from "@/lib/priority";
import { isRoutine, occursOn, slotDeadline } from "@/lib/recurrence";
import { effectiveLead, reminderModeOf } from "@/lib/taskReminder";
import type { Task, TaskDeadline } from "@/types/task";

// The reminder engine's policy: which notifications the phone should have
// scheduled right now, worked out from the task list and the user's
// preferences alone. Pure (no Expo, no store), so it's tested on its own
// (tests/reminders.test.ts). lib/notifications.ts makes the phone match the
// plan — it never decides a time itself — and every path that changes a task
// (the Add form, the edit card, Magic mic, a repeating task's next
// occurrence, completing, deleting, archiving) reaches it the same way: the
// task list changes, and the list is planned again.
//
// Policy (reworked 2026-11-18, the user's notification redesign):
// - One main switch (Settings → Notifications). Off: nothing at all is
//   scheduled — but every task keeps its own reminder choice, so turning it
//   back on brings everything back as it was. The three parts below work the
//   same way.
// - Tasks WITHOUT a time never get a notification of their own: five of them
//   on one day were five pings at 9:00. They're listed in ONE morning summary
//   instead ("5 things today: start with Pay rent"), with that day's routines.
// - Tasks WITH a time get their own reminder, "Tasks with a time" switch on:
//   at the start or so long before — the task's own lead, else the default
//   from Settings. As a notification, or an alarm (Pro) when the task asks for
//   one. A task set to "Off" gets nothing, and is left out of the summary.
// - Reminders that fall on the same minute become one notification
//   ("3 tasks at 2:00 PM"). Alarms always ring on their own.
// - A repeating task or routine with a time also gets the reminders of its
//   next days (a week ahead), so a daily alarm rings even if Nexdo isn't
//   opened in between. Not for a repeating task that waits for a missed one
//   ("keep"): its next occurrence doesn't come until the missed one is done.
// - "Overdue alert": once, when a timed task should have been finished
//   (its start plus its length, or 15 minutes after a start without one).
// - Only future times are scheduled: a reminder whose time has passed is
//   dropped, not sent late, so opening the app never sets off a burst.
// - The ids are derived from the task and the kind, so planning twice gives
//   the same ids, and the reconciler can tell what's already scheduled from
//   what has to change.

export type ReminderPreferences = {
  /** The main switch: nothing is scheduled while it's off. */
  enabled: boolean;
  /** One notification each morning: the day's tasks and routines. */
  morningSummary: boolean;
  /** "HH:MM" — when the morning summary arrives. */
  morningSummaryTime: string;
  /** Tasks with a time get a reminder of their own. */
  timedReminders: boolean;
  /** How long before a timed task, in minutes (0 = at the start), for tasks without their own. */
  defaultLead: number;
  /** An alert when a timed task should have been finished. */
  overdueAlerts: boolean;
  /** Alarms are Pro: without it, a task set to "Alarm" gets a plain notification (its choice is kept). */
  alarmsAllowed: boolean;
};

export const DEFAULT_REMINDER_PREFERENCES: ReminderPreferences = {
  enabled: true,
  morningSummary: true,
  morningSummaryTime: "08:00",
  timedReminders: true,
  defaultLead: 0,
  overdueAlerts: false,
  alarmsAllowed: true,
};

export type ReminderKind = "reminder" | "alarm" | "late" | "summary" | "group";

/** The Android channel each kind is filed under (see lib/notifications.ts). */
export type ReminderChannel = "reminders" | "alarms" | "overdue" | "planning";

export type PlannedNotification = {
  /** Stable: the same task and kind always give the same id. */
  id: string;
  kind: ReminderKind;
  channel: ReminderChannel;
  taskId?: string;
  fireAt: number;
  title: string;
  body: string;
  /** Whether the notification offers "Mark as done". */
  completable: boolean;
  data: {
    url: string;
    taskId?: string;
    kind: ReminderKind;
    /** The deadline this was planned for — a tap on an older one is checked against the task as it is now. */
    deadline?: string;
    /** The task's own name — what a group lists, and the alarm screen shows. */
    taskTitle?: string;
    /** Alarms: when the task starts, in ms (the alarm screen's "in 15 min"). */
    startsAt?: number;
    /** Changes whenever anything shown or timed changes: what the reconciler compares. */
    signature: string;
  };
};

/** Every id this app schedules starts with one of these — the reconciler leaves anything else alone. */
export const NOTIFICATION_ID_PREFIX = "nexdo-";
/** The prefix of the overdue alerts scheduled before this engine existed, cleared out on the first run. */
export const LEGACY_NOTIFICATION_ID_PREFIX = "overdue-";

export function shouldDismissPresentedNotification(
  identifier: string,
  taskId: unknown,
  openTaskIds: Set<string>,
  clearAll = false,
): boolean {
  const isOwned =
    identifier.startsWith(NOTIFICATION_ID_PREFIX) || identifier.startsWith(LEGACY_NOTIFICATION_ID_PREFIX);
  if (!isOwned) return false;
  return clearAll || identifier.startsWith(LEGACY_NOTIFICATION_ID_PREFIX) || (typeof taskId === "string" && !openTaskIds.has(taskId));
}

/**
 * iOS keeps at most 64 pending notifications per app and silently drops the
 * rest, so the soonest ones win; later ones are scheduled on a later run
 * (every launch, return to the app and task change runs one).
 */
export const MAX_SCHEDULED = 60;
/** How many days of morning summaries, and of a repeating task's reminders, are scheduled ahead. */
const DAYS_AHEAD = 7;
/** Nothing is scheduled closer than this to now — it would arrive as the app opens. */
const MIN_LEAD_MS = 30_000;
/** The overdue alert for a timed task with no length: this long after its start. */
const LATE_WITHOUT_LENGTH_MS = 15 * 60_000;
/** How many names a summary or a group spells out before "+ N". */
const NAMES_SHOWN = 3;

const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** The instant `time` ("HH:MM") happens on `date`, on this phone's clock. */
export function atLocalTime(date: string, time: string): number {
  const match = CLOCK_PATTERN.exec(time) ?? CLOCK_PATTERN.exec(DEFAULT_REMINDER_PREFERENCES.morningSummaryTime)!;
  const { y, m, d } = keyParts(date);
  return new Date(y, m - 1, d, Number(match[1]), Number(match[2]), 0, 0).getTime();
}

function formatTime(ms: number, t: Translations): string {
  return new Date(ms).toLocaleTimeString(t.locale, { hour: "numeric", minute: "2-digit" });
}

function deadlineKey(deadline: TaskDeadline | undefined): string | undefined {
  return deadline ? `${deadline.date}|${deadline.time ?? ""}` : undefined;
}

/** Open, dated, and not set to "Off". */
function wantsReminders(task: Task): boolean {
  return task.status === "pending" && !!task.deadline && isLocalDateKey(task.deadline.date) && reminderModeOf(task.reminders) !== "off";
}

/**
 * What a task's list card shows next to its name (2026-11-18): a bell for a
 * notification of its own, an alarm clock for an alarm, nothing otherwise —
 * including a task without a time, which is only in the morning summary.
 */
export function reminderBadge(task: Task, prefs: ReminderPreferences): "notify" | "alarm" | null {
  if (!prefs.enabled || !prefs.timedReminders || !wantsReminders(task) || !task.deadline?.time) return null;
  return reminderModeOf(task.reminders) === "alarm" && prefs.alarmsAllowed ? "alarm" : "notify";
}

/** Whether a repeating task's later days get their reminders ahead of time (see the policy above). */
function projectsAhead(task: Task): boolean {
  const recurrence = task.recurrence;
  if (!recurrence || recurrence.rule.allDay) return false;
  return isRoutine(task) || recurrence.rule.missed === "skip";
}

type Occurrence = { deadline: TaskDeadline; date: string; projected: boolean };

/** The task's own deadline, then — for a repeating task with a time — its next days within the week. */
function occurrencesOf(task: Task, now: Date): Occurrence[] {
  const deadline = task.deadline!;
  const list: Occurrence[] = [{ deadline, date: deadline.date, projected: false }];
  if (!projectsAhead(task)) return list;
  const rule = task.recurrence!.rule;
  const from = deadline.date > task.recurrence!.occurrenceDate ? deadline.date : task.recurrence!.occurrenceDate;
  const last = addDaysToKey(toLocalDateKey(now), DAYS_AHEAD);
  for (let date = addDaysToKey(from, 1); date <= last; date = addDaysToKey(date, 1)) {
    if (occursOn(rule, date)) list.push({ deadline: slotDeadline(rule, date), date, projected: true });
  }
  return list;
}

/** "Dentist in 15 minutes", "Dentist starts now", "Dentist tomorrow". */
function reminderTitle(title: string, lead: number, t: Translations): string {
  const copy = t.notifications;
  if (lead === 0) return copy.startsNowTitle(title);
  if (lead === 1440) return copy.startsTomorrowTitle(title);
  return copy.startsInTitle(title, copy.offsetLabel(lead));
}

/** The reminders (and overdue alert) one task should have, before grouping and the global cap. */
export function planTaskReminders(task: Task, prefs: ReminderPreferences, now: Date, t: Translations): PlannedNotification[] {
  if (!prefs.enabled || !wantsReminders(task) || !task.deadline!.time) return [];
  const copy = t.notifications;
  const alarm = reminderModeOf(task.reminders) === "alarm" && prefs.alarmsAllowed;
  const lead = effectiveLead(task.reminders, prefs.defaultLead);
  const length = task.estimatedMinutes > 0 ? t.format.duration(Math.floor(task.estimatedMinutes / 60), task.estimatedMinutes % 60) : undefined;
  const planned: PlannedNotification[] = [];

  for (const occurrence of occurrencesOf(task, now)) {
    const dueAt = deadlineInstant(occurrence.deadline).getTime();
    // A day ahead of a repeating task isn't a task yet: it opens the list,
    // and offers no "Mark as done".
    const ref = occurrence.projected ? `${task.recurrence!.seriesId}-${occurrence.date}` : task.id;
    const url = occurrence.projected ? "/(tabs)/tasks" : `/task/${task.id}`;
    const taskId = occurrence.projected ? undefined : task.id;
    const add = (kind: ReminderKind, channel: ReminderChannel, fireAt: number, title: string, body: string) => {
      if (fireAt <= now.getTime() + MIN_LEAD_MS) return;
      const extra = kind === "alarm" ? { taskTitle: task.title, startsAt: dueAt } : { taskTitle: task.title };
      planned.push({
        id: `${NOTIFICATION_ID_PREFIX}${kind}-${ref}`,
        kind,
        channel,
        taskId,
        fireAt,
        title,
        body,
        completable: !occurrence.projected,
        data: {
          url,
          taskId,
          kind,
          deadline: occurrence.projected ? undefined : deadlineKey(task.deadline),
          ...extra,
          signature: `${kind}|${fireAt}|${title}|${body}`,
        },
      });
    };

    if (prefs.timedReminders) {
      const time = formatTime(dueAt, t);
      add(
        alarm ? "alarm" : "reminder",
        alarm ? "alarms" : "reminders",
        dueAt - lead * 60_000,
        reminderTitle(task.title, lead, t),
        length ? copy.startsAtWithLength(time, length) : copy.startsAt(time),
      );
    }
    if (prefs.overdueAlerts && !occurrence.projected) {
      const lateAt = dueAt + (task.estimatedMinutes > 0 ? task.estimatedMinutes * 60_000 : LATE_WITHOUT_LENGTH_MS);
      add("late", "overdue", lateAt, copy.lateTitle(task.title), copy.lateBody(formatTime(task.estimatedMinutes > 0 ? lateAt : dueAt, t)));
    }
  }
  return planned;
}

/** "Call mom, Buy groceries" and how many more weren't named. */
function someNames(titles: string[]): { names: string; more: number } {
  return { names: titles.slice(0, NAMES_SHOWN).join(", "), more: Math.max(0, titles.length - NAMES_SHOWN) };
}

/**
 * Plain reminders landing on the same minute become one: "3 tasks at 2:00 PM"
 * with their names. Alarms and overdue alerts always stay on their own.
 */
function groupSameMinute(entries: PlannedNotification[], t: Translations): PlannedNotification[] {
  const byMinute = new Map<number, PlannedNotification[]>();
  const rest: PlannedNotification[] = [];
  for (const entry of entries) {
    if (entry.kind !== "reminder") {
      rest.push(entry);
      continue;
    }
    const minute = Math.floor(entry.fireAt / 60_000);
    byMinute.set(minute, [...(byMinute.get(minute) ?? []), entry]);
  }
  for (const [minute, group] of byMinute) {
    if (group.length === 1) {
      rest.push(group[0]);
      continue;
    }
    const fireAt = Math.min(...group.map((entry) => entry.fireAt));
    // The tasks' own names, not "Dentist starts now" three times over.
    const names = group.map((entry) => entry.data.taskTitle ?? entry.title);
    const { names: shown, more } = someNames(names);
    const title = t.notifications.groupTitle(group.length, formatTime(fireAt, t));
    const body = more > 0 ? `${shown} +${more}` : shown;
    rest.push({
      id: `${NOTIFICATION_ID_PREFIX}group-${minute}`,
      kind: "group",
      channel: "reminders",
      fireAt,
      title,
      body,
      completable: false,
      data: { url: "/(tabs)/tasks", kind: "group", signature: `group|${fireAt}|${title}|${body}` },
    });
  }
  return rest;
}

/**
 * The morning summary for the coming week: that day's tasks (and any still
 * open from before), the one to start with first, and its routines — one
 * notification instead of one per task. A day with nothing on it gets none:
 * Nexdo doesn't nudge about nothing. Planned again on every task change and
 * app launch, so what it names stays current.
 */
function planMorningSummaries(tasks: Task[], prefs: ReminderPreferences, now: Date, t: Translations): PlannedNotification[] {
  if (!prefs.enabled || !prefs.morningSummary) return [];
  const open = tasks.filter(wantsReminders);
  if (open.length === 0) return [];
  const routines = open.filter((task) => isRoutine(task));
  const others = open.filter((task) => !isRoutine(task));
  const today = toLocalDateKey(now);
  const copy = t.notifications;
  const notes: PlannedNotification[] = [];

  for (let offset = 0; offset < DAYS_AHEAD; offset += 1) {
    const date = addDaysToKey(today, offset);
    const fireAt = atLocalTime(date, prefs.morningSummaryTime);
    if (fireAt <= now.getTime() + MIN_LEAD_MS) continue;
    const dayTasks = others.filter((task) => task.deadline!.date <= date);
    // A routine is on that day when its open occurrence is, or its rule
    // brings it back that day.
    const dayRoutines = routines.filter(
      (task) => task.deadline!.date === date || (task.deadline!.date < date && occursOn(task.recurrence!.rule, date)),
    );
    if (dayTasks.length === 0 && dayRoutines.length === 0) continue;

    const ranked = recommendTasks(dayTasks, { now: new Date(fireAt) }).map((entry) => entry.task);
    const order = ranked.length === dayTasks.length ? ranked : dayTasks;
    const routineNames = someNames(dayRoutines.map((task) => task.title));
    const routineLine = dayRoutines.length > 0 ? copy.summaryRoutines(routineNames.more > 0 ? `${routineNames.names} +${routineNames.more}` : routineNames.names) : "";

    let title: string;
    let body: string;
    if (order.length === 0) {
      title = copy.summaryRoutinesTitle(dayRoutines.length);
      body = routineLine;
    } else {
      title = copy.summaryTitle(order.length, order[0].title);
      const then = someNames(order.slice(1).map((task) => task.title));
      const thenLine = order.length > 1 ? copy.summaryThen(then.names, then.more) : "";
      body = [thenLine, routineLine].filter(Boolean).join(" ") || copy.dailyOpenBody;
    }
    notes.push({
      id: `${NOTIFICATION_ID_PREFIX}summary-${date}`,
      kind: "summary",
      channel: "planning",
      fireAt,
      title,
      body,
      completable: false,
      data: { url: "/", kind: "summary", signature: `summary|${fireAt}|${title}|${body}` },
    });
  }
  return notes;
}

/** Everything the phone should have scheduled, soonest first, within the platform's limit. */
export function planNotifications(
  tasks: Task[],
  prefs: ReminderPreferences,
  now: Date,
  t: Translations,
  max: number = MAX_SCHEDULED,
): PlannedNotification[] {
  if (!prefs.enabled) return [];
  const taskReminders = groupSameMinute(tasks.flatMap((task) => planTaskReminders(task, prefs, now, t)), t);
  const all = [...taskReminders, ...planMorningSummaries(tasks, prefs, now, t)];
  return all.sort((a, b) => a.fireAt - b.fireAt || (a.id < b.id ? -1 : 1)).slice(0, max);
}

export type ScheduledNotification = { id: string; signature?: string };

/**
 * What to change so the phone holds exactly `desired`: cancel what's ours
 * and no longer wanted (or wanted differently), schedule what's missing or
 * changed, and leave everything already right alone.
 */
export function diffNotifications(
  desired: PlannedNotification[],
  scheduled: ScheduledNotification[],
): { cancel: string[]; schedule: PlannedNotification[] } {
  const ours = scheduled.filter(
    (entry) => entry.id.startsWith(NOTIFICATION_ID_PREFIX) || entry.id.startsWith(LEGACY_NOTIFICATION_ID_PREFIX),
  );
  const current = new Map(ours.map((entry) => [entry.id, entry.signature]));
  const wanted = new Map(desired.map((entry) => [entry.id, entry]));
  const cancel = ours
    .filter((entry) => {
      const want = wanted.get(entry.id);
      return !want || want.data.signature !== entry.signature;
    })
    .map((entry) => entry.id);
  const schedule = desired.filter((entry) => current.get(entry.id) !== entry.data.signature);
  return { cancel, schedule };
}

/**
 * When the task will next be mentioned, for the edit card and Task Details
 * to show — its own reminder, or for a task without a time the morning
 * summary of its day — or null when nothing is coming.
 */
export function nextReminderFor(task: Task, prefs: ReminderPreferences, now: Date, t: Translations): number | null {
  const own = planTaskReminders(task, prefs, now, t).find((entry) => entry.kind !== "late" && entry.taskId === task.id);
  if (own) return own.fireAt;
  if (prefs.enabled && prefs.morningSummary && wantsReminders(task) && !task.deadline!.time) {
    const summaryAt = atLocalTime(task.deadline!.date, prefs.morningSummaryTime);
    if (summaryAt > now.getTime() + MIN_LEAD_MS) return summaryAt;
  }
  return null;
}
