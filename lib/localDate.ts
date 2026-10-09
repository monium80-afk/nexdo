import type { Weekday } from "@/types/task";

// Calendar days written "YYYY-MM-DD", with no time zone attached — the day a
// person means when they say "October 15". Arithmetic on them goes through
// Date.UTC, never through adding 24 hours to a timestamp, so a daylight-saving
// change can't move anything onto the wrong day. Pure functions only (a type
// import, nothing else), shared by deadlines (lib/deadline.ts) and repeating
// tasks (lib/recurrence.ts).

export type LocalDate = string;

const DAY_MS = 24 * 60 * 60 * 1000;

export function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

/** 1-based month. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function toLocalDateKey(date: Date): LocalDate {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isLocalDateKey(value: unknown): value is LocalDate {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function keyParts(key: LocalDate): { y: number; m: number; d: number } {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d };
}

/** Days since 1970-01-01 for a calendar day — no time zone involved. */
export function dayNumber(key: LocalDate): number {
  const { y, m, d } = keyParts(key);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function fromDayNumber(day: number): LocalDate {
  const date = new Date(day * DAY_MS);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function addDaysToKey(key: LocalDate, days: number): LocalDate {
  return fromDayNumber(dayNumber(key) + days);
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetweenKeys(from: LocalDate, to: LocalDate): number {
  return dayNumber(to) - dayNumber(from);
}

/** Months on the calendar, landing on the last day of a shorter month rather than spilling over. */
export function addMonthsToKey(key: LocalDate, months: number): LocalDate {
  const { y, m, d } = keyParts(key);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${pad(month)}-${pad(Math.min(d, daysInMonth(year, month)))}`;
}

export function weekdayOf(key: LocalDate): Weekday {
  const { y, m, d } = keyParts(key);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() as Weekday;
}

/** Midnight at the start of `key` on this device's clock. */
export function keyToLocalDate(key: LocalDate): Date {
  const { y, m, d } = keyParts(key);
  return new Date(y, m - 1, d);
}
