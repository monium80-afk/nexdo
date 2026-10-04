// Server-only: imported exclusively by app/api/**/+api.ts route handlers.
//
// The Free and Pro monthly allowances (lib/plan.ts), enforced. Two questions
// per AI request: which plan is this account on, and has it anything left of
// what the request would use?
//
// The plan comes from RevenueCat, not from the app: the app only says "I'm
// Pro" (PLAN_HEADER) and RevenueCat's own record of the account decides. The
// usage is counted in Supabase (supabase/schema.sql, ai_plan_usage), so it
// holds across server instances and devices.
import { METERS, PLAN_HEADER, PLAN_LIMITS, PRO_ENTITLEMENT, type Meter, type Plan, type PlanLimitBody } from "@/lib/plan";
import { callServerRpc, RpcConfigError, selectServerRows } from "@/lib/serverRpc";

// RevenueCat answers "what does this customer own?" to the same public SDK
// keys the app ships with — it is the request the SDK itself makes — so no
// secret key is needed. Customers belong to the project, not to one store, so
// any of the project's keys gives the same answer.
function revenueCatKey(): string | undefined {
  return (
    process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY ||
    process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ||
    process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY ||
    undefined
  );
}

const REVENUECAT_TIMEOUT_MS = 5_000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Whether RevenueCat's answer for a customer (GET /v1/subscribers/{id}) shows
 * the Pro entitlement as active. The answer lists lapsed entitlements too, so
 * the end date is what counts — read against RevenueCat's own clock, which the
 * answer carries, rather than this server's. Exported for tests.
 */
export function hasActiveEntitlement(payload: unknown, entitlement: string = PRO_ENTITLEMENT): boolean {
  const body = asRecord(payload);
  const entitlements = asRecord(asRecord(body.subscriber).entitlements);
  if (!(entitlement in entitlements)) return false;
  const entry = asRecord(entitlements[entitlement]);

  // No end date: a lifetime grant.
  if (entry.expires_date === null) return true;

  const now = typeof body.request_date_ms === "number" ? body.request_date_ms : Date.now();
  // The store is still retrying a failed renewal: Pro stays on meanwhile.
  return [entry.expires_date, entry.grace_period_expires_date].some(
    (date) => typeof date === "string" && Date.parse(date) > now,
  );
}

/** RevenueCat turned the request away (a wrong key, a bad id) — retrying won't help. */
class RevenueCatRefusedError extends Error {}

async function fetchIsPro(userId: string, key: string): Promise<boolean> {
  const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(REVENUECAT_TIMEOUT_MS),
  });
  if (response.status >= 400 && response.status < 500) {
    throw new RevenueCatRefusedError(`RevenueCat answered ${response.status}`);
  }
  if (!response.ok) throw new Error(`RevenueCat answered ${response.status}`);
  return hasActiveEntitlement(await response.json());
}

// Answers are remembered per server instance. Pro for a few minutes — a
// lapsed subscription keeps its allowance that much longer, in exchange for
// not asking RevenueCat on every message. "Not Pro" only briefly: someone
// who has just subscribed shouldn't have to wait to be believed.
const PRO_TTL_MS = 5 * 60_000;
const NOT_PRO_TTL_MS = 30_000;
const MAX_REMEMBERED = 1_000;
const remembered = new Map<string, { pro: boolean; until: number }>();

function remember(userId: string, pro: boolean) {
  // A Map iterates in insertion order, so the first key is the oldest.
  if (remembered.size >= MAX_REMEMBERED) remembered.delete(remembered.keys().next().value!);
  remembered.set(userId, { pro, until: Date.now() + (pro ? PRO_TTL_MS : NOT_PRO_TTL_MS) });
}

/** The plan this request's account is on. An account that doesn't claim Pro is Free without asking anyone. */
export async function resolvePlan(request: Request, userId: string): Promise<Plan> {
  if (request.headers.get(PLAN_HEADER) !== "pro") return "free";

  const known = remembered.get(userId);
  if (known && known.until > Date.now()) return known.pro ? "pro" : "free";

  const key = revenueCatKey();
  if (!key) {
    // Loud: with no key, every subscriber is treated as Free.
    console.error("[serverPlan] no RevenueCat key on the server — add EXPO_PUBLIC_REVENUECAT_* to its environment");
    return "free";
  }

  try {
    const pro = await fetchIsPro(userId, key);
    remember(userId, pro);
    return pro ? "pro" : "free";
  } catch (error) {
    if (error instanceof RevenueCatRefusedError) {
      console.error("[serverPlan] RevenueCat refused the plan check — is the key right?", error.message);
      return "free";
    }
    // RevenueCat is unreachable. Taking the app's word for it this once is
    // the lesser harm: the alternative is a paying customer shut out of what
    // they paid for by someone else's outage. Not remembered, so the next
    // request asks again.
    console.warn("[serverPlan] couldn't reach RevenueCat, taking the app's word", error);
    return "pro";
  }
}

function planLimitResponse(meter: Meter, plan: Plan): Response {
  return Response.json({ error: "plan_limit", meter, plan } satisfies PlanLimitBody, { status: 429 });
}

/**
 * The month's total after spending, -1 when the limit was already reached,
 * or null when the count couldn't be read. Null lets the request through —
 * open rather than closed, like lib/aiUsageLimit.ts: a Supabase hiccup
 * shouldn't switch the AI off for everyone. Loud, so a missing setup isn't
 * missed.
 */
async function spend(userId: string, meter: Meter, amount: number, limit: number | null): Promise<number | null> {
  try {
    return await callServerRpc<number>("claim_ai_plan_usage", {
      p_user_id: userId,
      p_meter: meter,
      p_amount: Math.round(amount),
      p_limit: limit,
    });
  } catch (error) {
    if (error instanceof RpcConfigError) {
      console.error("[serverPlan] SUPABASE_SECRET_KEY is missing — add it to your .env file");
    } else {
      console.error("[serverPlan] couldn't count plan usage (is the ai_plan_usage SQL in supabase/schema.sql run?)", error);
    }
    return null;
  }
}

/**
 * Spends `amount` of this account's monthly `meter` — one message, one file,
 * a voice note's seconds. Returns null when the request may go ahead, or the
 * response to send instead. Call it after the body has been validated, so a
 * malformed request never uses anything up.
 */
export async function claimPlanUsage(request: Request, userId: string, meter: Meter, amount = 1): Promise<Response | null> {
  const plan = await resolvePlan(request, userId);
  const limit = PLAN_LIMITS[plan][meter];
  // Not part of the plan at all (Live voice on Free): nothing to count.
  if (limit <= 0) return planLimitResponse(meter, plan);

  const used = await spend(userId, meter, amount, limit);
  return used === -1 ? planLimitResponse(meter, plan) : null;
}

/**
 * How much of `meter` this account has left this month, without spending
 * any — Live voice asks before a session and reports what it used after
 * (recordPlanUsage). Either what's left, or the response to send instead.
 */
export async function remainingPlanUsage(
  request: Request,
  userId: string,
  meter: Meter,
): Promise<{ remaining: number } | { refused: Response }> {
  const plan = await resolvePlan(request, userId);
  const limit = PLAN_LIMITS[plan][meter];
  if (limit <= 0) return { refused: planLimitResponse(meter, plan) };

  const used = await spend(userId, meter, 0, limit);
  if (used === -1) return { refused: planLimitResponse(meter, plan) };
  return { remaining: used === null ? limit : Math.max(1, limit - used) };
}

/**
 * What this account has used of each meter so far this month (UTC, like the
 * counting itself) — for the usage view in Settings. A meter with no row yet
 * is 0. Null when the counts can't be read.
 */
export async function readPlanUsage(userId: string): Promise<Record<Meter, number> | null> {
  const month = `${new Date().toISOString().slice(0, 7)}-01`;
  try {
    const rows = await selectServerRows<{ meter: string; used: number }>("ai_plan_usage", "meter,used", {
      user_id: `eq.${userId}`,
      month: `eq.${month}`,
    });
    const used = Object.fromEntries(METERS.map((meter) => [meter, 0])) as Record<Meter, number>;
    for (const row of rows) {
      if (METERS.includes(row.meter as Meter) && Number.isFinite(row.used)) used[row.meter as Meter] = row.used;
    }
    return used;
  } catch (error) {
    console.error("[serverPlan] couldn't read plan usage", error);
    return null;
  }
}

/** Adds to the month's count with no limit check: the use has already happened. */
export async function recordPlanUsage(userId: string, meter: Meter, amount: number): Promise<void> {
  await spend(userId, meter, Math.max(0, amount), null);
}

/**
 * Gives back what claimPlanUsage spent, when the AI then failed to answer —
 * an outage shouldn't cost someone one of their five breakdowns.
 */
export async function refundPlanUsage(userId: string, meter: Meter, amount = 1): Promise<void> {
  await spend(userId, meter, -Math.abs(amount), null);
}
