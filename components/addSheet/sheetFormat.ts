// How the Add task sheet writes dates, times and lengths. Plain functions of a
// locale, so the preview card and the Details lines say things the same way.

import type { Translations } from "@/lib/i18n";
import { addDaysToKey, keyToLocalDate, toLocalDateKey, type LocalDate } from "@/lib/localDate";

function clockDate(time: string): Date {
  const [hour, minute] = time.split(":").map(Number);
  return new Date(2020, 0, 1, hour, minute);
}

/** "3:00 PM" / "15:00". */
export function formatTime(time: string, locale: string): string {
  return clockDate(time).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}

/** "3 PM" on the hour, "3:30 PM" otherwise — the Details line's short form. */
export function formatShortTime(time: string, locale: string): string {
  const date = clockDate(time);
  return date.getMinutes() === 0
    ? date.toLocaleTimeString(locale, { hour: "numeric" })
    : date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}

/** Whether this locale writes times on a 24-hour clock ("15:00" rather than "3 PM"). */
export function uses24HourClock(locale: string): boolean {
  return new Date(2020, 0, 1, 13, 0).toLocaleTimeString(locale, { hour: "numeric" }).includes("13");
}

/** The locale's own words for morning and afternoon ("AM", "PM"). */
export function dayPeriods(locale: string): [string, string] {
  const period = (hour: number) =>
    new Date(2020, 0, 1, hour, 0).toLocaleTimeString(locale, { hour: "numeric" }).replace(/[\d\s‎‏ ]/g, "") ||
    (hour < 12 ? "AM" : "PM");
  return [period(9), period(15)];
}

/** "Today", "Tomorrow", or "Fri 6" — the Details line. */
export function shortDay(date: LocalDate, now: Date, t: Translations): string {
  const today = toLocalDateKey(now);
  if (date === today) return t.taskDetail.today;
  if (date === addDaysToKey(today, 1)) return t.taskDetail.tomorrow;
  return keyToLocalDate(date).toLocaleDateString(t.locale, { weekday: "short", day: "numeric" });
}

/** "Today", "Tomorrow", or "Fri, Nov 6" — the preview card. */
export function longDay(date: LocalDate, now: Date, t: Translations): string {
  const today = toLocalDateKey(now);
  if (date === today) return t.taskDetail.today;
  if (date === addDaysToKey(today, 1)) return t.taskDetail.tomorrow;
  return keyToLocalDate(date).toLocaleDateString(t.locale, { weekday: "short", month: "short", day: "numeric" });
}
