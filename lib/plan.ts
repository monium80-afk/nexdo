// Free vs Pro: what each plan includes in a calendar month. Shared by the
// server, which enforces it (lib/serverPlan.ts), and the paywall, which shows
// it (app/paywall.tsx) — one table, so the two can never disagree.
//
// Adding, editing and sorting tasks by hand, the Next page and reminders are
// not here: they never touch the AI, so they are unlimited on both plans.

export type Plan = "free" | "pro";

/** The RevenueCat entitlement both subscriptions (monthly, yearly) unlock. */
export const PRO_ENTITLEMENT = "nexdo_pro";

/**
 * Sent with every AI request by an app whose RevenueCat SDK says the account
 * is Pro. Only a hint: the server checks it with RevenueCat before believing
 * it, and never asks RevenueCat about an account that doesn't claim Pro.
 */
export const PLAN_HEADER = "X-Nexdo-Plan";

/**
 * What a plan counts:
 * - chat: notes under "Add context for AI" (it also counted AI chat messages,
 *   until the AI chat was removed on 2026-10-08 — hence the name)
 * - media: photos and documents read — given as context for a task, which
 *   then also counts as one note
 * - voice: voice notes transcribed, in seconds
 * - live: Live voice ("Magic mic") listening time, in seconds
 * - assist: task breakdowns and advice, together
 */
export type Meter = "chat" | "media" | "voice" | "live" | "assist";

export const METERS: readonly Meter[] = ["chat", "media", "voice", "live", "assist"];

/**
 * The allowances the app shows (paywall, onboarding plans, Settings), in that
 * order. Photos and documents came back on 2026-10-08 as context for a task
 * (Task Details, a focus session). Voice notes were only ever sent from the
 * AI chat, so with it gone they aren't offered — the server still counts
 * them, should a request for them ever arrive.
 */
export const SHOWN_METERS: readonly Meter[] = ["live", "assist", "chat", "media"];

const MINUTE = 60;

export const PLAN_LIMITS: Record<Plan, Record<Meter, number>> = {
  free: { chat: 20, media: 3, voice: 3 * MINUTE, live: 0, assist: 5 },
  pro: { chat: 400, media: 50, voice: 50 * MINUTE, live: 50 * MINUTE, assist: 100 },
};

/** Meters counted in seconds and shown in minutes; the rest are plain counts. */
export function isTimeMeter(meter: Meter): boolean {
  return meter === "voice" || meter === "live";
}

/** A limit as a person reads it: 20 messages, or 3 (minutes) for a 180-second limit. */
export function displayLimit(plan: Plan, meter: Meter): number {
  const limit = PLAN_LIMITS[plan][meter];
  return isTimeMeter(meter) ? Math.round(limit / MINUTE) : limit;
}

/** The length a store states a free trial in ("3 days", "1 week"). */
export type TrialUnit = "day" | "week" | "month" | "year";

/** The body of the 429 an AI route answers once a month's allowance is used up. */
export type PlanLimitBody = { error: "plan_limit"; meter: Meter; plan: Plan };

/**
 * Thrown by apiPost (lib/api.ts) for that 429. Not an outage: callers skip
 * their "AI unreachable" fallbacks and say what ran out instead
 * (lib/planLimit.ts).
 */
export class PlanLimitError extends Error {
  readonly meter: Meter;
  readonly plan: Plan;

  constructor(meter: Meter, plan: Plan) {
    super(`plan limit reached: ${meter} (${plan})`);
    this.name = "PlanLimitError";
    this.meter = meter;
    this.plan = plan;
  }
}

export function isPlanLimitBody(value: unknown): value is PlanLimitBody {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return (
    body.error === "plan_limit" &&
    METERS.includes(body.meter as Meter) &&
    (body.plan === "free" || body.plan === "pro")
  );
}
