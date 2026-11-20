import type { PurchasesEntitlementInfo } from "react-native-purchases";


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
