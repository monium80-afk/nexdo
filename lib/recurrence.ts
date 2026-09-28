import type { Translations } from "@/lib/i18n";
import type {
  RecurrenceFrequency,
  RecurrenceRule,
  SeriesTemplate,
  Subtask,
  Task,
  TaskRecurrence,
  Weekday,
} from "@/types/task";

// Repeating tasks. Pure functions only (type imports above, nothing else), so
// the date math can be tested on its own — see tests/recurrence.test.ts.
//
// Every date here is a local calendar day written "YYYY-MM-DD". Day arithmetic
// is done on those keys through Date.UTC, never by adding 24 hours to a
// timestamp, so a daylight-saving change can't shift an occurrence onto the
// wrong day. The time of day lives on the rule (hour/minute, local wall-clock
// time) and is applied last, with the local Date constructor: a task due at
// 9:00 stays due at 9:00 on both sides of a clock change.
//
// A series is only ever one open occurrence at a time. Completing (or skipping)
// it creates the next one; missed days are not back-filled, so a daily task
// that's been left for a week is one overdue task, not seven.

export type LocalDate = string;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_INTERVAL = 365;
const WEEKDAY_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

/** Default time for a repeating task created without one — the same 18:00 the rest of the app uses. */
export const DEFAULT_RECURRENCE_HOUR = 18;

export type RecurrenceScope = "this" | "future" | "series";

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

export function toLocalDateKey(date: Date): LocalDate {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isLocalDateKey(value: unknown): value is LocalDate {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

function parts(key: LocalDate): { y: number; m: number; d: number } {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d };
}

/** Days since 1970-01-01 for a calendar day — no time zone involved. */
function dayNumber(key: LocalDate): number {
  const { y, m, d } = parts(key);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function fromDayNumber(day: number): LocalDate {
  const date = new Date(day * DAY_MS);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function addDaysToKey(key: LocalDate, days: number): LocalDate {
  return fromDayNumber(dayNumber(key) + days);
}

/** 1-based month. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function weekdayOf(key: LocalDate): Weekday {
  const { y, m, d } = parts(key);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() as Weekday;
}

/** Weeks run Monday to Sunday, as they do in most of the app's languages. */
function mondayOf(key: LocalDate): number {
  return dayNumber(key) - ((weekdayOf(key) + 6) % 7);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

const FREQUENCIES: RecurrenceFrequency[] = ["daily", "weekly", "monthly", "yearly"];

/**
 * A rule safe to store and compute with, or null if it can't be one (no valid
 * frequency or anchor). Everything else is clamped or defaulted rather than
 * rejected — it can arrive from the AI, an older app version or another device.
 */
export function normalizeRule(raw: Partial<RecurrenceRule> | null | undefined): RecurrenceRule | null {
  if (!raw || !FREQUENCIES.includes(raw.frequency as RecurrenceFrequency)) return null;
  if (!isLocalDateKey(raw.anchorDate)) return null;
  const frequency = raw.frequency as RecurrenceFrequency;
  const rule: RecurrenceRule = {
    frequency,
    interval: clampInt(raw.interval, 1, MAX_INTERVAL, 1),
    anchorDate: raw.anchorDate,
    hour: clampInt(raw.hour, 0, 23, DEFAULT_RECURRENCE_HOUR),
    minute: clampInt(raw.minute, 0, 59, 0),
  };
  if (frequency === "weekly") {
    const days = Array.isArray(raw.weekdays)
      ? [...new Set(raw.weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
      : [];
    rule.weekdays = (days.length > 0 ? days : [weekdayOf(raw.anchorDate)]).sort(
      (a, b) => WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b),
    ) as Weekday[];
  }
  if (frequency === "monthly") {
    rule.monthDay = clampInt(raw.monthDay, 1, 31, parts(raw.anchorDate).d);
  }
  if (isLocalDateKey(raw.endDate)) rule.endDate = raw.endDate;
  return rule;
}

/** Whether the rule has an occurrence on this day (ignoring the end date). */
function matchesPattern(rule: RecurrenceRule, key: LocalDate): boolean {
  if (key < rule.anchorDate) return false;
  const { y, m, d } = parts(key);
  const anchor = parts(rule.anchorDate);
  switch (rule.frequency) {
    case "daily":
      return (dayNumber(key) - dayNumber(rule.anchorDate)) % rule.interval === 0;
    case "weekly": {
      const weekdays = rule.weekdays?.length ? rule.weekdays : [weekdayOf(rule.anchorDate)];
      if (!weekdays.includes(weekdayOf(key))) return false;
      const weeks = Math.round((mondayOf(key) - mondayOf(rule.anchorDate)) / 7);
      return weeks % rule.interval === 0;
    }
    case "monthly": {
      const months = (y - anchor.y) * 12 + (m - anchor.m);
      if (months % rule.interval !== 0) return false;
      return d === Math.min(rule.monthDay ?? anchor.d, daysInMonth(y, m));
    }
    case "yearly": {
      if ((y - anchor.y) % rule.interval !== 0 || m !== anchor.m) return false;
      // February 29th falls on the 28th in other years.
      return d === Math.min(anchor.d, daysInMonth(y, m));
    }
  }
}

export function occursOn(rule: RecurrenceRule, key: LocalDate): boolean {
  if (rule.endDate && key > rule.endDate) return false;
  return matchesPattern(rule, key);
}

/**
 * The first occurrence strictly after `after` and not before `notBefore`, or
 * null once the series has ended. Candidates are generated per unit (day, month
 * or year) rather than tested day by day, so a long interval stays cheap.
 */
export function nextSlot(rule: RecurrenceRule, after: LocalDate, notBefore?: LocalDate): LocalDate | null {
  let start = addDaysToKey(after, 1);
  if (notBefore && notBefore > start) start = notBefore;
  if (rule.anchorDate > start) start = rule.anchorDate;

  let found: LocalDate | null = null;
  switch (rule.frequency) {
    case "daily": {
      const offset = dayNumber(start) - dayNumber(rule.anchorDate);
      const steps = Math.ceil(offset / rule.interval);
      found = fromDayNumber(dayNumber(rule.anchorDate) + steps * rule.interval);
      break;
    }
    case "weekly": {
      // Two full cycles always contain the next match.
      for (let i = 0; i < 14 * rule.interval + 7 && !found; i += 1) {
        const candidate = addDaysToKey(start, i);
        if (matchesPattern(rule, candidate)) found = candidate;
      }
      break;
    }
    case "monthly":
    case "yearly": {
      const anchor = parts(rule.anchorDate);
      const from = parts(start);
      const stepMonths = rule.frequency === "monthly" ? rule.interval : rule.interval * 12;
      const elapsed = (from.y - anchor.y) * 12 + (from.m - anchor.m);
      let k = Math.max(0, Math.floor(elapsed / stepMonths));
      for (let guard = 0; guard < 4 && !found; guard += 1, k += 1) {
        const monthIndex = anchor.m - 1 + k * stepMonths;
        const y = anchor.y + Math.floor(monthIndex / 12);
        const m = (monthIndex % 12) + 1;
        const wantedDay = rule.frequency === "monthly" ? (rule.monthDay ?? anchor.d) : anchor.d;
        const candidate = `${y}-${pad(m)}-${pad(Math.min(wantedDay, daysInMonth(y, m)))}`;
        if (candidate >= start) found = candidate;
      }
      break;
    }
  }
  if (!found || (rule.endDate && found > rule.endDate)) return null;
  return found;
}

export function firstSlotOnOrAfter(rule: RecurrenceRule, from: LocalDate): LocalDate | null {
  return nextSlot(rule, addDaysToKey(from, -1));
}

/** The instant an occurrence on `key` is due, at the rule's local time. */
export function slotDueDate(rule: Pick<RecurrenceRule, "hour" | "minute">, key: LocalDate): string {
  const { y, m, d } = parts(key);
  return new Date(y, m - 1, d, rule.hour, rule.minute, 0, 0).toISOString();
}

export function occurrenceIdFor(seriesId: string, key: LocalDate): string {
  return `${seriesId}@${key}`;
}

export function createSeriesId(): string {
  return `series-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Moves the rule's anchor onto its first real occurrence on or after `from`,
 * so "every 2 weeks on Monday" set up on a Wednesday starts next Monday rather
 * than in twelve days.
 */
export function anchorRuleOnOrAfter(rule: RecurrenceRule, from: LocalDate): RecurrenceRule | null {
  const probe = { ...rule, interval: 1, anchorDate: from, endDate: undefined };
  // Monthly/yearly read their day from the anchor, so keep the one asked for.
  if (rule.frequency === "monthly") probe.monthDay = rule.monthDay ?? parts(rule.anchorDate).d;
  const first =
    rule.frequency === "yearly"
      ? firstYearlySlot(rule, from)
      : firstSlotOnOrAfter(normalizeRule(probe) ?? probe, from);
  if (!first || (rule.endDate && first > rule.endDate)) return null;
  return { ...rule, anchorDate: first };
}

function firstYearlySlot(rule: RecurrenceRule, from: LocalDate): LocalDate {
  const anchor = parts(rule.anchorDate);
  const start = parts(from);
  for (let y = start.y; ; y += 1) {
    const candidate = `${y}-${pad(anchor.m)}-${pad(Math.min(anchor.d, daysInMonth(y, anchor.m)))}`;
    if (candidate >= from) return candidate;
  }
}

export type RuleInput = {
  frequency: RecurrenceFrequency;
  interval?: number;
  weekdays?: Weekday[];
  monthDay?: number;
  endDate?: string;
};

/**
 * A rule for a task due at `dueDate` (or, with none, today at 18:00 — or the
 * end of today once 18:00 has passed, like the Add form's "Today"). It takes
 * that time of day, and is anchored on its first occurrence on or after the
 * due day — never on a day already gone, and never on an occurrence whose time
 * has already passed ("every day at 9" set up at 15:00 starts tomorrow).
 */
export function buildRule(input: RuleInput, dueDate: string | undefined, now: Date): RecurrenceRule | null {
  const due = dueDate ? new Date(dueDate) : undefined;
  const base = due && !Number.isNaN(due.getTime()) ? due : defaultDue(now);
  const draft = normalizeRule({
    frequency: input.frequency,
    interval: input.interval,
    weekdays: input.weekdays,
    monthDay: input.monthDay,
    endDate: input.endDate,
    anchorDate: toLocalDateKey(base),
    hour: base.getHours(),
    minute: base.getMinutes(),
  });
  if (!draft) return null;
  const today = toLocalDateKey(now);
  let rule = anchorRuleOnOrAfter(draft, draft.anchorDate > today ? draft.anchorDate : today);
  if (rule && Date.parse(slotDueDate(rule, rule.anchorDate)) < now.getTime()) {
    rule = anchorRuleOnOrAfter(rule, addDaysToKey(rule.anchorDate, 1));
  }
  return rule;
}

function defaultDue(now: Date): Date {
  const date = new Date(now);
  date.setHours(DEFAULT_RECURRENCE_HOUR, 0, 0, 0);
  if (date.getTime() <= now.getTime()) date.setHours(23, 59, 0, 0);
  return date;
}

/** Everything a new occurrence copies. The duration is the full job, not what was left of it. */
export function templateFromTask(task: Task): SeriesTemplate {
  const steps = task.subtasks?.length
    ? task.subtasks
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((subtask) => ({ label: subtask.label, estimatedMinutes: subtask.estimatedMinutes }))
    : undefined;
  const fullMinutes = steps ? steps.reduce((sum, step) => sum + step.estimatedMinutes, 0) : task.estimatedMinutes;
  return {
    title: task.title,
    estimatedMinutes: Math.max(1, fullMinutes || task.estimatedMinutes || 30),
    importance: task.importance,
    notes: task.notes,
    steps,
  };
}

/**
 * Makes `task` the first occurrence of a new series (or re-times an existing
 * one when `seriesId` is passed): its due date moves onto the rule's first
 * occurrence, and the rest of it becomes the template.
 */
export function startSeries(task: Task, rule: RecurrenceRule, seriesId: string = createSeriesId()): Task {
  return {
    ...task,
    dueDate: slotDueDate(rule, rule.anchorDate),
    recurrence: {
      seriesId,
      occurrenceDate: rule.anchorDate,
      rule,
      template: templateFromTask(task),
    },
  };
}

/** The slot the occurrence after this one falls on, given the day it's being closed. */
export function nextOccurrenceDate(recurrence: TaskRecurrence, now: Date): LocalDate | null {
  return nextSlot(recurrence.rule, recurrence.occurrenceDate, toLocalDateKey(now));
}

/**
 * The occurrence that follows `task` — built fresh from the series template —
 * or null when the series has run out. Scores are left at 0 for the store's
 * recalculation step to fill in.
 */
export function buildNextOccurrence(task: Task, now: Date): Task | null {
  const recurrence = task.recurrence;
  if (!recurrence) return null;
  const date = nextOccurrenceDate(recurrence, now);
  if (!date) return null;

  const id = occurrenceIdFor(recurrence.seriesId, date);
  const { template, rule } = recurrence;
  const subtasks: Subtask[] | undefined = template.steps?.length
    ? template.steps.map((step, index) => ({
        id: `${id}-step-${index}`,
        label: step.label,
        estimatedMinutes: step.estimatedMinutes,
        order: index,
        status: index === 0 ? "current" : "pending",
      }))
    : undefined;
  const nowIso = now.toISOString();

  return {
    id,
    title: template.title,
    status: "pending",
    dueDate: slotDueDate(rule, date),
    estimatedMinutes: template.estimatedMinutes,
    createdAt: nowIso,
    updatedAt: nowIso,
    notes: template.notes,
    subtasks,
    currentStepId: subtasks?.[0]?.id,
    priorityScore: 0,
    suitabilityScore: 0,
    importance: template.importance,
    complexity: task.complexity,
    aiContext: { notes: [] },
    recurrence: { seriesId: recurrence.seriesId, occurrenceDate: date, rule, template },
  };
}

/**
 * Re-times the series around a moved occurrence ("from now on it's on
 * Tuesdays at 7"): the new day and time become the rule's, and a weekly rule
 * swaps the old weekday for the new one.
 */
export function retimeRule(rule: RecurrenceRule, fromKey: LocalDate, newDue: Date): RecurrenceRule {
  const newKey = toLocalDateKey(newDue);
  const next: RecurrenceRule = { ...rule, anchorDate: newKey, hour: newDue.getHours(), minute: newDue.getMinutes() };
  if (rule.frequency === "weekly") {
    const oldDay = weekdayOf(fromKey);
    const days = (rule.weekdays ?? [oldDay]).filter((day) => day !== oldDay);
    next.weekdays = [...new Set([...days, weekdayOf(newKey)])];
  }
  if (rule.frequency === "monthly") next.monthDay = parts(newKey).d;
  if (next.endDate && next.endDate < newKey) next.endDate = undefined;
  return normalizeRule(next) ?? rule;
}

/**
 * A recurrence read back from storage or another device, checked field by
 * field — or undefined if it isn't one this version can keep repeating.
 */
export function normalizeRecurrence(raw: unknown): TaskRecurrence | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Partial<TaskRecurrence>;
  const rule = normalizeRule(value.rule);
  const template = value.template;
  if (!rule || typeof value.seriesId !== "string" || !isLocalDateKey(value.occurrenceDate)) return undefined;
  if (!template || typeof template.title !== "string" || typeof template.estimatedMinutes !== "number") return undefined;
  return {
    seriesId: value.seriesId,
    occurrenceDate: value.occurrenceDate,
    rule,
    template: {
      title: template.title,
      estimatedMinutes: template.estimatedMinutes,
      importance: typeof template.importance === "number" ? template.importance : 50,
      notes: typeof template.notes === "string" ? template.notes : undefined,
      steps: Array.isArray(template.steps)
        ? template.steps.filter(
            (step): step is { label: string; estimatedMinutes: number } =>
              !!step && typeof step.label === "string" && typeof step.estimatedMinutes === "number",
          )
        : undefined,
    },
    nextOccurrenceId: typeof value.nextOccurrenceId === "string" ? value.nextOccurrenceId : undefined,
  };
}

/** The series' open occurrence, if there is one. */
export function openOccurrence(tasks: Task[], seriesId: string): Task | undefined {
  return tasks.find((task) => task.recurrence?.seriesId === seriesId && task.status === "pending");
}

export function seriesOccurrences(tasks: Task[], seriesId: string): Task[] {
  return tasks.filter((task) => task.recurrence?.seriesId === seriesId);
}

// ---------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------

const REFERENCE_SUNDAY = new Date(2024, 0, 7); // any Sunday; only its weekday matters

export function weekdayName(day: Weekday, locale: string, style: "narrow" | "short" | "long" = "short"): string {
  const date = new Date(REFERENCE_SUNDAY);
  date.setDate(date.getDate() + day);
  return date.toLocaleDateString(locale, { weekday: style });
}

function keyToDate(key: LocalDate): Date {
  const { y, m, d } = parts(key);
  return new Date(y, m - 1, d);
}

/** "Every Monday", "Every 2 weeks on Mon, Thu", "Monthly on day 15", "Every day until Dec 31" — in the app language. */
export function describeRule(rule: RecurrenceRule, t: Translations): string {
  const r = t.recurrence;
  let label: string;
  switch (rule.frequency) {
    case "daily":
      label = r.everyDays(rule.interval);
      break;
    case "weekly": {
      const days = (rule.weekdays ?? [weekdayOf(rule.anchorDate)]).map((day) => weekdayName(day, t.locale));
      label = r.everyWeeks(rule.interval, days.join(", "));
      break;
    }
    case "monthly":
      label = r.everyMonths(rule.interval, rule.monthDay ?? parts(rule.anchorDate).d);
      break;
    case "yearly":
      label = r.everyYears(
        rule.interval,
        keyToDate(rule.anchorDate).toLocaleDateString(t.locale, { month: "short", day: "numeric" }),
      );
      break;
  }
  return rule.endDate
    ? r.until(label, keyToDate(rule.endDate).toLocaleDateString(t.locale, { month: "short", day: "numeric", year: "numeric" }))
    : label;
}

const ENGLISH_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A fixed English description for the AI prompt, whatever the app language. */
export function describeRuleForAi(rule: RecurrenceRule): string {
  const every = (unit: string) => (rule.interval === 1 ? `every ${unit}` : `every ${rule.interval} ${unit}s`);
  const time = `${pad(rule.hour)}:${pad(rule.minute)}`;
  let label: string;
  switch (rule.frequency) {
    case "daily":
      label = every("day");
      break;
    case "weekly":
      label = `${every("week")} on ${(rule.weekdays ?? []).map((day) => ENGLISH_WEEKDAYS[day]).join(", ")}`;
      break;
    case "monthly":
      label = `${every("month")} on day ${rule.monthDay ?? parts(rule.anchorDate).d}`;
      break;
    case "yearly":
      label = `${every("year")} on ${rule.anchorDate.slice(5)}`;
      break;
  }
  return `${label} at ${time}${rule.endDate ? `, until ${rule.endDate}` : ""}`;
}
