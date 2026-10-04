import {
  addDaysToKey,
  addMonthsToKey,
  isLocalDateKey,
  keyParts,
  pad,
  toLocalDateKey,
  type LocalDate,
} from "@/lib/localDate";
import type { Task, TaskDeadline } from "@/types/task";

// Deadlines. A task's deadline is kept the way the user gave it — a calendar
// day, plus a clock time only when they named one — in `task.deadline`. The
// instant it passes is derived from that into `task.dueDate`, which is what
// sorting, scoring, filters and overdue checks compare against. Every change
// to a deadline goes through withDeadline() so the two can never disagree, and
// anything read from storage or another device goes through
// reconcileDeadline(). Pure (type imports and lib/localDate only), so it runs
// under `npm test` as it is.
//
// - A date-only deadline ("Oct 15") is due by the end of that day on the
//   phone's own clock, wherever the user is: it's a day, not an instant, and
//   never becomes one at midnight UTC.
// - An exact deadline ("Oct 15 at 7 PM") is an instant in the time zone it was
//   given in, so it stays put if the phone later changes zone.

export type DeadlineInput = { date: LocalDate; time?: string };

/** Mirrors TaskChanges.dueShift — a signed amount, not a date. */
export type DateShift = { amount: number; unit: "minutes" | "hours" | "days" | "weeks" | "months" };

const DAY_MS = 24 * 60 * 60 * 1000;
const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

// How far a stored `dueDate` may sit from the one its deadline gives before it
// is taken to have been moved by something that only knew `dueDate` (an older
// app version on another device). It should match to the millisecond: an
// exact deadline is worked out in its own time zone, so every phone gets the
// same instant. Only a date-only deadline's end-of-day is the saving phone's
// own, up to 26 hours from this one's — and an exact one's too when this
// phone can't read the zone it was set in.
const SAME_ZONE_TOLERANCE_MS = 60_000;
const CROSS_ZONE_TOLERANCE_MS = 27 * 60 * 60 * 1000;

export function isClockTime(value: unknown): value is string {
  return typeof value === "string" && CLOCK_PATTERN.test(value);
}

/** This phone's IANA time zone, or undefined where the platform can't say. */
export function deviceTimeZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && zone.length > 0 ? zone : undefined;
  } catch {
    return undefined;
  }
}

function isDeviceZone(timeZone: string | undefined): boolean {
  return !timeZone || timeZone === deviceTimeZone();
}

/** How far `timeZone` is ahead of UTC at the instant `utcMs`, in ms — or null if the zone can't be read. */
function zoneOffsetMs(utcMs: number, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    }).formatToParts(new Date(utcMs));
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const wall = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour") % 24, value("minute"), value("second"));
    if (Number.isNaN(wall)) return null;
    return wall - Math.floor(utcMs / 1000) * 1000;
  } catch {
    return null;
  }
}

/** The instant `time` on `date` happens in `timeZone` (this phone's zone when it's the same or unknown). */
function zonedInstant(date: LocalDate, time: string, timeZone: string | undefined): number {
  const { y, m, d } = keyParts(date);
  const [hour, minute] = time.split(":").map(Number);
  const local = new Date(y, m - 1, d, hour, minute, 0, 0).getTime();
  if (isDeviceZone(timeZone)) return local;
  const wall = Date.UTC(y, m - 1, d, hour, minute);
  const first = zoneOffsetMs(wall, timeZone!);
  if (first === null) return local;
  // The offset at the guessed instant can differ from the one at the wall
  // time itself when a daylight-saving change falls in between.
  const guess = wall - first;
  const second = zoneOffsetMs(guess, timeZone!);
  return second !== null && second !== first ? wall - second : guess;
}

/** The day and clock time an instant falls on in `timeZone` (this phone's zone when it's the same or unknown). */
function wallTime(ms: number, timeZone: string | undefined): { date: LocalDate; time: string } {
  if (!isDeviceZone(timeZone)) {
    const offset = zoneOffsetMs(ms, timeZone!);
    if (offset !== null) {
      const wall = new Date(ms + offset);
      return {
        date: `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}`,
        time: `${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}`,
      };
    }
  }
  const local = new Date(ms);
  return { date: toLocalDateKey(local), time: `${pad(local.getHours())}:${pad(local.getMinutes())}` };
}

/** A checked deadline, or undefined when the input isn't a real calendar day. */
export function makeDeadline(
  input: DeadlineInput | null | undefined,
  timeZone: string | undefined = deviceTimeZone(),
): TaskDeadline | undefined {
  if (!input || !isLocalDateKey(input.date)) return undefined;
  const deadline: TaskDeadline = { date: input.date };
  if (isClockTime(input.time)) deadline.time = input.time;
  if (timeZone) deadline.timeZone = timeZone;
  return deadline;
}

/** The deadline a local Date stands for: its day, and its clock time only when one was really given. */
export function deadlineFromDate(
  date: Date,
  hasTime: boolean,
  timeZone: string | undefined = deviceTimeZone(),
): TaskDeadline | undefined {
  if (Number.isNaN(date.getTime())) return undefined;
  return makeDeadline(
    { date: toLocalDateKey(date), time: hasTime ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : undefined },
    timeZone,
  );
}

/**
 * An exact deadline at an ISO instant — how every deadline was stored before
 * date-only ones existed, so it's also how an older task is read.
 */
export function deadlineFromInstant(iso: string, timeZone: string | undefined = deviceTimeZone()): TaskDeadline | undefined {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return undefined;
  return makeDeadline(wallTime(ms, timeZone), timeZone);
}

/** When the deadline passes: its exact time, or the very end of its day. */
export function deadlineInstant(deadline: TaskDeadline): Date {
  if (deadline.time) return new Date(zonedInstant(deadline.date, deadline.time, deadline.timeZone));
  const { y, m, d } = keyParts(deadline.date);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

/** A local Date on the deadline's day at its time — for pickers and display. Midnight for a date-only deadline. */
export function deadlineToLocalDate(deadline: TaskDeadline): Date {
  if (deadline.time) return new Date(zonedInstant(deadline.date, deadline.time, deadline.timeZone));
  const { y, m, d } = keyParts(deadline.date);
  return new Date(y, m - 1, d);
}

/**
 * "Thu, Oct 15" for a date-only deadline, "Thu, Oct 15, 7:00 PM" for an exact
 * one — never a time nobody gave. `withWeekday: false` drops the weekday.
 */
export function formatDeadline(deadline: TaskDeadline, locale: string, withWeekday = true): string {
  const day = deadlineToLocalDate(deadline);
  const date = day.toLocaleDateString(locale, {
    weekday: withWeekday ? "short" : undefined,
    month: "short",
    day: "numeric",
    year: day.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
  if (!deadline.time) return date;
  return `${date}, ${day.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })}`;
}

/** Sets (or, with undefined, removes) a task's deadline, and the `dueDate` that follows from it. */
export function withDeadline<T extends { deadline?: TaskDeadline; dueDate?: string }>(
  task: T,
  deadline: TaskDeadline | undefined,
): T {
  const next = { ...task };
  if (deadline) {
    next.deadline = deadline;
    next.dueDate = deadlineInstant(deadline).toISOString();
  } else {
    delete next.deadline;
    delete next.dueDate;
  }
  return next;
}

/**
 * A task's deadline — read off `dueDate`, as an exact one, for a task shaped
 * before `deadline` existed (what reconcileDeadline would make of it), so the
 * pure functions work the same on data that hasn't been through it.
 */
export function deadlineOf(task: { deadline?: TaskDeadline; dueDate?: string }): TaskDeadline | undefined {
  if (task.deadline) return task.deadline;
  return task.dueDate ? deadlineFromInstant(task.dueDate) : undefined;
}

export function sameDeadline(a: TaskDeadline | undefined, b: TaskDeadline | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.date === b.date && (a.time ?? "") === (b.time ?? "");
}

export function hasExactTime(task: Pick<Task, "deadline">): boolean {
  return !!task.deadline?.time;
}

/**
 * A new deadline from what the user (or the AI) said. With `keepTimeOfDay`, a
 * day given without a time ("move it to Friday") keeps the time the task was
 * already due at; otherwise a day without a time is a date-only deadline.
 */
export function resolveDeadlineInput(
  current: TaskDeadline | undefined,
  input: DeadlineInput,
  keepTimeOfDay: boolean,
): TaskDeadline | undefined {
  const time = input.time ?? (keepTimeOfDay ? current?.time : undefined);
  return makeDeadline({ date: input.date, time });
}

/**
 * A deadline after a pick on the system date picker, from the one it showed
 * (`current`). `part` is what the picker asked for: "date", "time", or
 * "both" — iOS's one spinner for the two, where a new day arrives with the
 * time it was already showing (a date-only deadline's end of day, or the
 * time it opened at). So there only a time that was actually changed makes
 * the deadline exact; picking just another day keeps a date-only one so.
 */
export function applyPickedDateTime(
  current: Date,
  selected: Date,
  part: "date" | "time" | "both",
  hasTime: boolean,
): { date: Date; hasTime: boolean } {
  const date = new Date(current);
  if (part !== "time") date.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
  const timeChanged = selected.getHours() !== current.getHours() || selected.getMinutes() !== current.getMinutes();
  if (part === "time" || (part === "both" && timeChanged)) {
    date.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    return { date, hasTime: true };
  }
  return { date, hasTime };
}

/**
 * Moves a deadline. Days, weeks and months move the calendar day and keep the
 * time (so 9:00 stays 9:00 across a clock change); minutes and hours move an
 * exact deadline's instant. A date-only deadline has no time to move by a few
 * hours: only whole days count, and a shift of less than one is no change (null).
 */
export function shiftDeadline(deadline: TaskDeadline, shift: DateShift): TaskDeadline | null {
  if (!Number.isFinite(shift.amount) || shift.amount === 0) return null;
  switch (shift.unit) {
    case "days":
      return { ...deadline, date: addDaysToKey(deadline.date, Math.round(shift.amount)) };
    case "weeks":
      return { ...deadline, date: addDaysToKey(deadline.date, Math.round(shift.amount * 7)) };
    case "months":
      return { ...deadline, date: addMonthsToKey(deadline.date, Math.round(shift.amount)) };
    case "minutes":
    case "hours": {
      const ms = shift.amount * (shift.unit === "hours" ? 3_600_000 : 60_000);
      if (!deadline.time) {
        const days = Math.round(ms / DAY_MS);
        return days === 0 ? null : { ...deadline, date: addDaysToKey(deadline.date, days) };
      }
      const moved = wallTime(deadlineInstant(deadline).getTime() + ms, deadline.timeZone);
      return { ...deadline, date: moved.date, time: moved.time };
    }
  }
}

/**
 * A task as read from storage, Supabase or another app version, with its
 * deadline fields brought into line: a valid `deadline` is the source of
 * truth and `dueDate` is re-derived from it. A task with only a `dueDate`
 * (written before date-only deadlines existed, or by a database that doesn't
 * have the deadline columns yet) gets an exact deadline at that instant — the
 * time it has always shown — rather than an invented date-only one.
 */
export function reconcileDeadline<T extends { deadline?: TaskDeadline; dueDate?: string }>(task: T): T {
  const raw = task.deadline as Partial<TaskDeadline> | null | undefined;
  const deadline =
    raw && isLocalDateKey(raw.date)
      ? makeDeadline({ date: raw.date, time: raw.time }, typeof raw.timeZone === "string" && raw.timeZone ? raw.timeZone : undefined)
      : undefined;

  if (!deadline) {
    if (task.dueDate && !Number.isNaN(Date.parse(task.dueDate))) return withDeadline(task, deadlineFromInstant(task.dueDate));
    return withDeadline(task, undefined);
  }
  // A deadline with no instant beside it was removed by something that only
  // knew `dueDate`; one whose instant is far from what the deadline gives was
  // moved by it. Either way that's the newer change.
  if (!task.dueDate) return withDeadline(task, undefined);
  const stored = Date.parse(task.dueDate);
  const sameInstantEverywhere =
    isDeviceZone(deadline.timeZone) || (!!deadline.time && zoneOffsetMs(stored, deadline.timeZone!) !== null);
  const tolerance = sameInstantEverywhere ? SAME_ZONE_TOLERANCE_MS : CROSS_ZONE_TOLERANCE_MS;
  if (!Number.isNaN(stored) && Math.abs(stored - deadlineInstant(deadline).getTime()) > tolerance) {
    return withDeadline(task, deadlineFromInstant(task.dueDate));
  }
  return withDeadline(task, deadline);
}
