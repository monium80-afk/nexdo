import type { PurchasesEntitlementInfo } from "react-native-purchases";

import type { FreeTrial } from "@/lib/freeTrial";

// The heads-up onboarding's trial timeline promises: a notification this many
// days before a free trial turns into a paid plan.

export const TRIAL_REMINDER_LEAD_DAYS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Nothing is scheduled closer than this to now — it would arrive as the app opens. */
const MIN_LEAD_MS = 60_000;

/**
 * When to remind about the free trial running out, or null when there's
 * nothing to remind about: no trial, a trial already cancelled (nothing will
 * be charged), or a reminder time that has already passed.
 */
export function trialReminderTime(
  pro: Pick<PurchasesEntitlementInfo, "periodType" | "willRenew" | "expirationDate"> | null,
  now: number,
): number | null {
  if (!pro || pro.periodType.toUpperCase() !== "TRIAL" || !pro.willRenew || !pro.expirationDate) return null;
  const endsAt = Date.parse(pro.expirationDate);
  if (Number.isNaN(endsAt)) return null;
  const fireAt = endsAt - TRIAL_REMINDER_LEAD_DAYS * DAY_MS;
  return fireAt > now + MIN_LEAD_MS ? fireAt : null;
}

/** How many days a free trial runs from `start` — the day it ends on the onboarding timeline. */
export function trialLengthInDays(trial: FreeTrial, start: Date): number {
  if (trial.unit === "day") return trial.count;
  if (trial.unit === "week") return trial.count * 7;
  const end = new Date(start);
  if (trial.unit === "month") end.setMonth(end.getMonth() + trial.count);
  else end.setFullYear(end.getFullYear() + trial.count);
  return Math.round((end.getTime() - start.getTime()) / DAY_MS);
}

/**
 * The day of the trial the reminder arrives on, counting today as day 0 — or
 * null when the trial is too short to remind before it ends.
 */
export function trialReminderDay(trialDays: number): number | null {
  const day = trialDays - TRIAL_REMINDER_LEAD_DAYS;
  return day >= 1 ? day : null;
}
