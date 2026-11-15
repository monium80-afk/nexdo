// Free vs Pro: what each plan includes in a calendar month. Shared by the
// server, which enforces it (lib/serverPlan.ts), and the paywall, which shows
// it (components/paywall/) — one table, so the two can never disagree.
//
// Adding, editing and sorting tasks by hand, the Next page and reminders are
// not here: they never touch the AI, so they are unlimited on both plans.

import { FOCUS_SOUND_CHOICES } from "@/types/settings";

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

const MINUTE = 60;

/**
 * Free has no AI at all since 2026-10-26 (the user's call): every AI feature
 * is part of Pro, and Free is Nexdo by hand — tasks, Today, the Schedule,
 * sessions, reminders. The app shows those features locked up front
 * (hooks/useAiLocked.ts) rather than letting a request be refused. Magic mic
 * went from 50 to 90 minutes a month on Pro the same day.
 */
export const PLAN_LIMITS: Record<Plan, Record<Meter, number>> = {
  free: { chat: 0, media: 0, voice: 0, live: 0, assist: 0 },
  pro: { chat: 100, media: 50, voice: 50 * MINUTE, live: 90 * MINUTE, assist: 100 },
};

/** What the paywall can be opened from: a monthly allowance, or one of the Pro extras. */
export type ProFeatureId = Meter | "sounds" | "insights";

/**
 * The paywall's 7 cards (components/paywall/), in their order: each one's
 * number and unit. The allowances are read straight from PLAN_LIMITS above —
 * the numbers the server enforces — and the sound count from the app's list
 * of focus sounds, so the paywall can't promise more than the app gives.
 * Each card's name and line are copy (t.paywall.features).
 *
 * `amount: null` is a card without a count ("All time").
 */
export type ProFeatureUnit = "seconds" | "times" | "uploads" | "notes" | "sounds" | "history";
export type ProFeature = { id: ProFeatureId; amount: number | null; unit: ProFeatureUnit };

export const PRO_FEATURES: readonly ProFeature[] = [
  { id: "live", amount: PLAN_LIMITS.pro.live, unit: "seconds" },
  { id: "assist", amount: PLAN_LIMITS.pro.assist, unit: "times" },
  { id: "media", amount: PLAN_LIMITS.pro.media, unit: "uploads" },
  { id: "voice", amount: PLAN_LIMITS.pro.voice, unit: "seconds" },
  { id: "chat", amount: PLAN_LIMITS.pro.chat, unit: "notes" },
  // Every focus sound but "off".
  { id: "sounds", amount: FOCUS_SOUND_CHOICES.length - 1, unit: "sounds" },
  { id: "insights", amount: null, unit: "history" },
];

/** Whether a plan includes a meter at all (Free includes none of them). */
export function planIncludes(plan: Plan, meter: Meter): boolean {
  return PLAN_LIMITS[plan][meter] > 0;
}

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
