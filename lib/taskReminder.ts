import type { TaskReminderSettings } from "@/types/task";

// One task's reminder choice (2026-11-18): how it reminds (a notification, an
// alarm, or not at all) and, for a task with a time, how long before. Kept
// apart from the Settings switches on purpose: turning Notifications (or one
// of its parts) off in Settings only stops what the phone schedules — every
// task keeps its own choice, and it all comes back when the switch is on
// again. Nothing is ever reset by a Settings switch.

export type ReminderMode = "notify" | "alarm" | "off";

/** The "how long before" stops offered in Settings and on a task, in minutes (0 = at the start). */
export const REMINDER_LEAD_OPTIONS = [0, 5, 15, 30, 60, 1440] as const;

/** The longest lead accepted (a week) — anything said to Magic mic is held to it. */
export const MAX_REMINDER_LEAD = 7 * 1440;

export function reminderModeOf(settings: TaskReminderSettings | undefined): ReminderMode {
  if (settings?.muted) return "off";
  return settings?.alarm ? "alarm" : "notify";
}

/** A lead as stored: a whole number of minutes within limits, or undefined. */
function cleanLead(lead: unknown): number | undefined {
  if (typeof lead !== "number" || !Number.isFinite(lead)) return undefined;
  return Math.max(0, Math.min(MAX_REMINDER_LEAD, Math.round(lead)));
}

/**
 * The canonical stored shape: undefined for the default (a notification at
 * the Settings lead), never an empty object. Off keeps nothing else — turning
 * it back on starts from the default again.
 */
export function normalizeReminder(raw: unknown): TaskReminderSettings | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  if (value.muted === true) return { muted: true };
  const lead = cleanLead(value.lead);
  const result: TaskReminderSettings = {};
  if (value.alarm === true) result.alarm = true;
  if (lead !== undefined) result.lead = lead;
  return Object.keys(result).length > 0 ? result : undefined;
}

export function sameReminder(a: TaskReminderSettings | undefined, b: TaskReminderSettings | undefined): boolean {
  const left = normalizeReminder(a);
  const right = normalizeReminder(b);
  return left?.muted === right?.muted && left?.alarm === right?.alarm && left?.lead === right?.lead;
}

/**
 * A change to a task's reminder: a new mode, and/or a new lead (null = back
 * to the Settings default). What isn't named stays as it was.
 */
export type ReminderChange = { mode?: ReminderMode; lead?: number | null };

export function applyReminderChange(current: TaskReminderSettings | undefined, change: ReminderChange): TaskReminderSettings | undefined {
  const mode = change.mode ?? reminderModeOf(current);
  if (mode === "off") return { muted: true };
  const lead = change.lead === null ? undefined : change.lead !== undefined ? cleanLead(change.lead) : current?.muted ? undefined : current?.lead;
  return normalizeReminder({ alarm: mode === "alarm", lead });
}

/** The lead a task actually uses: its own, or the default from Settings. */
export function effectiveLead(settings: TaskReminderSettings | undefined, defaultLead: number): number {
  return cleanLead(settings?.lead) ?? defaultLead;
}
