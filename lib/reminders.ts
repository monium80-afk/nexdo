import { deadlineInstant } from "@/lib/deadline";
import type { Translations } from "@/lib/i18n";
import { addDaysToKey, isLocalDateKey, keyParts, toLocalDateKey } from "@/lib/localDate";
import { recommendTasks } from "@/lib/priority";
import type { Task } from "@/types/task";

// The reminder engine's policy: which notifications the phone should have
// scheduled right now, worked out from the task list and the user's
// preferences alone. Pure (no Expo, no store), so it's tested on its own
// (tests/reminders.test.ts). lib/notifications.ts makes the phone match the
// plan — it never decides a time itself — and every path that changes a task
// (the Add form, Task Details, the AI, live voice, a repeating task's next
// occurrence, completing, deleting, archiving) reaches it the same way: the
// task list changes, and the list is planned again.
//
// Policy:
// - No deadline: no task reminder (the optional daily planning note is the
//   only thing that ever mentions it).
// - Date-only deadline: one reminder on the day, at the reminder time (9:00
//   by default). The deadline has no time, so none is invented for it.
//   With the morning nudge on, it's counted in that day's nudge instead.
// - Morning nudge (optional): once a day at its own time, "Start with: X"
//   and how many more are due that day.
// - Exact deadline: one reminder, at the deadline itself or as long before it
//   as the user picked in Settings (5/15/30 min, 1 h, 1 day).
//   It used to be the 9:00 one, so a task due at 18:00 added after 9:00 got
//   no reminder at all — what made reminders look broken on the phone.
// - High priority, if the user wants it: one more the day before.
// - "Overdue alerts": one alert as an exact deadline passes, in place of the
//   reminder at the deadline (both at once would be one too many). Never for
//   a date-only one — that would be a midnight notification.
// - Only future times are scheduled: a reminder whose time has passed is
//   dropped, not sent late, so opening the app never sets off a burst.
// - Completed, skipped and archived tasks, and tasks with reminders muted,
//   get none — so completing, deleting or archiving cancels them.
// - The ids are derived from the task and the kind of reminder, so planning
//   twice gives the same ids, and the reconciler can tell what's already
//   scheduled from what has to change.

export type ReminderPreferences = {
  /** Reminders on the day a task is due (and before exact deadlines). */
  deadlineReminders: boolean;
  /** "HH:MM" — when the on-the-day reminder arrives. */
  dayReminderTime: string;
  /**
   * How long before a deadline with a time to remind, in minutes: empty (or
   * 0) = at the deadline itself. One choice; only the first is used (older
   * versions allowed several).
   */
  beforeOffsets: number[];
  /** An extra reminder the day before, for high-priority tasks. */
  importantDayBefore: boolean;
  /** An alert as an exact deadline passes. */
  overdueAlerts: boolean;
  /** A daily planning note, separate from any deadline. */
  dailyPlanning: boolean;
  /** "HH:MM" — when the daily planning note arrives. */
  dailyPlanningTime: string;
};

export const DEFAULT_REMINDER_PREFERENCES: ReminderPreferences = {
  deadlineReminders: true,
  dayReminderTime: "09:00",
  beforeOffsets: [],
  importantDayBefore: false,
  overdueAlerts: false,
  dailyPlanning: false,
  dailyPlanningTime: "09:00",
};

/** The choices Settings offers for tasks with a time, in minutes before (0 = at the start). */
export const REMINDER_LEAD_OPTIONS = [0, 5, 15, 30, 60, 1440] as const;

/** How long before a timed deadline the reminder goes off, in minutes (0 = at the start). */
export function reminderLead(prefs: Pick<ReminderPreferences, "beforeOffsets">): number {
  return prefs.beforeOffsets.find((value) => Number.isFinite(value) && value > 0) ?? 0;
}

export type ReminderKind = "due-day" | "before" | "day-before" | "overdue" | "daily";

/** The Android channel each kind is filed under (see lib/notifications.ts). */
export type ReminderChannel = "reminders" | "overdue" | "planning";

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
    /** Changes whenever anything shown or timed changes: what the reconciler compares. */
    signature: string;
  };
};

/** Every id this app schedules starts with one of these — the reconciler leaves anything else alone. */
export const NOTIFICATION_ID_PREFIX = "nexdo-";
/** The prefix of the overdue alerts scheduled before this engine existed, cleared out on the first run. */
export const LEGACY_NOTIFICATION_ID_PREFIX = "overdue-";

/**
 * iOS keeps at most 64 pending notifications per app and silently drops the
 * rest, so the soonest ones win; later ones are scheduled on a later run
 * (every launch, return to the app and task change runs one).
 */
export const MAX_SCHEDULED = 60;
const DAILY_PLANNING_DAYS = 7;
/** Nothing is scheduled closer than this to now — it would arrive as the app opens. */
const MIN_LEAD_MS = 30_000;
/** Two reminders for one task closer together than this are one too many. */
const MIN_GAP_MS = 5 * 60_000;
/** The importance "High priority" maps to, and anything above it. */
const HIGH_IMPORTANCE = 63;

const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** The instant `time` ("HH:MM") happens on `date`, on this phone's clock. */
export function atLocalTime(date: string, time: string): number {
  const match = CLOCK_PATTERN.exec(time) ?? CLOCK_PATTERN.exec(DEFAULT_REMINDER_PREFERENCES.dayReminderTime)!;
  const { y, m, d } = keyParts(date);
  return new Date(y, m - 1, d, Number(match[1]), Number(match[2]), 0, 0).getTime();
}

function formatTime(ms: number, t: Translations): string {
  return new Date(ms).toLocaleTimeString(t.locale, { hour: "numeric", minute: "2-digit" });
}

function deadlineKey(task: Task): string | undefined {
  return task.deadline ? `${task.deadline.date}|${task.deadline.time ?? ""}` : undefined;
}

function wantsReminders(task: Task): boolean {
  return task.status === "pending" && !!task.deadline && !task.reminders?.muted;
}

type Candidate = { kind: ReminderKind; fireAt: number; suffix?: string; title: string; body: string };

/** The reminders one task should have, before the global cap. */
export function planTaskReminders(task: Task, prefs: ReminderPreferences, now: Date, t: Translations): PlannedNotification[] {
  if (!wantsReminders(task) || !isLocalDateKey(task.deadline!.date)) return [];
  const deadline = task.deadline!;
  const dueAt = deadlineInstant(deadline).getTime();
  const copy = t.notifications;
  const dueTime = deadline.time ? formatTime(dueAt, t) : undefined;
  const candidates: Candidate[] = [];

  if (prefs.deadlineReminders) {
    // On the day: at the reminder time when the deadline has no time. With a
    // time: ONE reminder, as early as Settings say (2026-11-09: one choice,
    // "at the start" or so long before) — at the start unless the overdue
    // alert already goes off then.
    const lead = reminderLead(prefs);
    if (!deadline.time) {
      // With the morning nudge on, a date-only task is counted in that
      // morning's nudge instead ("+ 2 more due today") — two morning
      // notifications would be one too many (2026-11-12).
      if (!prefs.dailyPlanning) {
        candidates.push({
          kind: "due-day",
          fireAt: atLocalTime(deadline.date, prefs.dayReminderTime),
          title: copy.dueTodayTitle(task.title),
          body: copy.dueTodayBody,
        });
      }
    } else if (lead > 0) {
      candidates.push({
        kind: "before",
        fireAt: dueAt - lead * 60_000,
        suffix: String(lead),
        title: task.title,
        body: copy.dueInBody(copy.offsetLabel(lead), dueTime!),
      });
    } else if (!prefs.overdueAlerts) {
      candidates.push({ kind: "due-day", fireAt: dueAt, title: copy.dueNowTitle(task.title), body: copy.dueNowBody(dueTime!) });
    }
    if (prefs.importantDayBefore && task.importance >= HIGH_IMPORTANCE) {
      candidates.push({
        kind: "day-before",
        fireAt: atLocalTime(addDaysToKey(deadline.date, -1), prefs.dayReminderTime),
        title: copy.dueTomorrowTitle(task.title),
        body: dueTime ? copy.dueTomorrowAtBody(dueTime) : copy.dueTomorrowBody,
      });
    }
  }
  if (prefs.overdueAlerts && deadline.time) {
    candidates.push({ kind: "overdue", fireAt: dueAt, title: copy.overdueTitle(task.title), body: copy.overdueBody });
  }

  const planned: PlannedNotification[] = [];
  for (const candidate of candidates
    .filter((entry) => entry.fireAt > now.getTime() + MIN_LEAD_MS && entry.fireAt <= dueAt)
    .sort((a, b) => a.fireAt - b.fireAt)) {
    // The overdue alert always stands; reminders crowding each other don't.
    const crowded = planned.some((entry) => Math.abs(entry.fireAt - candidate.fireAt) < MIN_GAP_MS);
    if (crowded && candidate.kind !== "overdue") continue;
    const id = `${NOTIFICATION_ID_PREFIX}${candidate.kind}-${task.id}${candidate.suffix ? `-${candidate.suffix}` : ""}`;
    planned.push({
      id,
      kind: candidate.kind,
      channel: candidate.kind === "overdue" ? "overdue" : "reminders",
      taskId: task.id,
      fireAt: candidate.fireAt,
      title: candidate.title,
      body: candidate.body,
      completable: true,
      data: {
        url: `/task/${task.id}`,
        taskId: task.id,
        kind: candidate.kind,
        deadline: deadlineKey(task),
        signature: `${candidate.fireAt}|${candidate.title}|${candidate.body}`,
      },
    });
  }
  return planned;
}

/**
 * The morning nudge for the coming week: the task Nexdo would start with as
 * the title, and how many others are due that day. No open tasks, no note —
 * Nexdo doesn't nudge about nothing. Planned again on every task change and
 * app launch, so the task it names stays current.
 */
function planDailyNotes(tasks: Task[], prefs: ReminderPreferences, now: Date, t: Translations): PlannedNotification[] {
  if (!prefs.dailyPlanning) return [];
  const open = tasks.filter((task) => task.status === "pending");
  if (open.length === 0) return [];
  const today = toLocalDateKey(now);
  const notes: PlannedNotification[] = [];
  for (let offset = 0; offset < DAILY_PLANNING_DAYS; offset += 1) {
    const date = addDaysToKey(today, offset);
    const fireAt = atLocalTime(date, prefs.dailyPlanningTime);
    if (fireAt <= now.getTime() + MIN_LEAD_MS) continue;
    const top = recommendTasks(open, { now: new Date(fireAt) })[0]?.task;
    if (!top) continue;
    // The others due that day — the date-only ones get no ping of their own while the nudge is on.
    const moreDue = open.filter((task) => task.id !== top.id && task.deadline?.date === date).length;
    const title = t.notifications.dailyTitle(top.title);
    const body = moreDue > 0 ? t.notifications.dailyDueBody(moreDue) : t.notifications.dailyOpenBody;
    notes.push({
      id: `${NOTIFICATION_ID_PREFIX}daily-${date}`,
      kind: "daily",
      channel: "planning",
      fireAt,
      title,
      body,
      completable: false,
      data: { url: "/", kind: "daily", signature: `${fireAt}|${title}|${body}` },
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
  const all = [...tasks.flatMap((task) => planTaskReminders(task, prefs, now, t)), ...planDailyNotes(tasks, prefs, now, t)];
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

/** When the task's next reminder is, for Task Details to show — or null when it has none coming. */
export function nextReminderFor(task: Task, prefs: ReminderPreferences, now: Date, t: Translations): number | null {
  const first = planTaskReminders(task, prefs, now, t).find((entry) => entry.kind !== "overdue");
  if (first) return first.fireAt;
  // A date-only task is in that morning's nudge instead of a ping of its own.
  if (prefs.dailyPlanning && wantsReminders(task) && !task.deadline!.time && isLocalDateKey(task.deadline!.date)) {
    const nudgeAt = atLocalTime(task.deadline!.date, prefs.dailyPlanningTime);
    if (nudgeAt > now.getTime() + MIN_LEAD_MS) return nudgeAt;
  }
  return null;
}
