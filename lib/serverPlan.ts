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

/**
 * The plan a request is counted on. `unverified`: the app claimed Pro but
 * RevenueCat couldn't be reached to confirm it, so the claim gets Free's
 * allowance — never more than RevenueCat would back — and once that is used
 * up, "try again later" (usageUnavailable) rather than the paywall: it may
 * well be a paying customer, shut out by someone else's outage.
 */
type PlanCheck = { plan: Plan; unverified?: true };

async function checkPlan(request: Request, userId: string): Promise<PlanCheck> {
  if (request.headers.get(PLAN_HEADER) !== "pro") return { plan: "free" };

  const known = remembered.get(userId);
  if (known && known.until > Date.now()) return { plan: known.pro ? "pro" : "free" };

  const key = revenueCatKey();
  if (!key) {
    // Loud: with no key, every subscriber is treated as Free.
    console.error("[serverPlan] no RevenueCat key on the server — add EXPO_PUBLIC_REVENUECAT_* to its environment");
    return { plan: "free" };
  }

  try {
    const pro = await fetchIsPro(userId, key);
    remember(userId, pro);
    return { plan: pro ? "pro" : "free" };
  } catch (error) {
    if (error instanceof RevenueCatRefusedError) {
      console.error("[serverPlan] RevenueCat refused the plan check — is the key right?", error.message);
      return { plan: "free" };
    }
    // Not remembered, so the next request asks again.
    console.warn("[serverPlan] couldn't reach RevenueCat, counting the Pro claim as Free for now", error);
    return { plan: "free", unverified: true };
  }
}

/** The plan this request's account is counted on. An account that doesn't claim Pro is Free without asking anyone. */
export async function resolvePlan(request: Request, userId: string): Promise<Plan> {
  return (await checkPlan(request, userId)).plan;
}

function planLimitResponse(meter: Meter, plan: Plan): Response {
  return Response.json({ error: "plan_limit", meter, plan } satisfies PlanLimitBody, { status: 429 });
}

/**
 * What's allowed can't be worked out right now: the counts can't be read, or
 * a Pro claim can't be checked. The app treats it like any other AI outage.
 */
function usageUnavailable(): Response {
  return Response.json({ error: "usage_unavailable" }, { status: 503 });
}

/** The answer for a request its plan doesn't cover — see PlanCheck for an unverified one. */
function refusal(meter: Meter, check: PlanCheck): Response {
  return check.unverified ? usageUnavailable() : planLimitResponse(meter, check.plan);
}

function logUsageError(error: unknown) {
  if (error instanceof RpcConfigError) {
    console.error("[serverPlan] SUPABASE_SECRET_KEY is missing — add it to your .env file");
  } else {
    console.error("[serverPlan] couldn't count plan usage (is the plan usage SQL in supabase/schema.sql run?)", error);
  }
}

/**
 * The month's total after spending, -1 when the amount doesn't fit in what
 * is left of the limit, or null when the count couldn't be read. Loud, so a
 * missing setup isn't missed.
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
    logUsageError(error);
    return null;
  }
}

/**
 * Spends `amount` of this account's monthly `meter` — one message, one file,
 * a voice note's seconds. Returns null when the request may go ahead, or the
 * response to send instead. Call it after the body has been validated, so a
 * malformed request never uses anything up.
 *
 * Closed when the count can't be read, like the signed-out trial: these
 * allowances are what keeps each account's AI cost bounded, and an
 * allowance that switches itself off whenever Supabase is unreachable or
 * misconfigured bounds nothing, exactly when nobody is watching.
 */
export async function claimPlanUsage(request: Request, userId: string, meter: Meter, amount = 1): Promise<Response | null> {
  const check = await checkPlan(request, userId);
  const limit = PLAN_LIMITS[check.plan][meter];
  // Not part of the plan at all (Live voice on Free): nothing to count.
  if (limit <= 0) return refusal(meter, check);

  const used = await spend(userId, meter, amount, limit);
  if (used === null) return usageUnavailable();
  return used === -1 ? refusal(meter, check) : null;
}

/**
 * Whether this account has anything left of `meter` this month, without
 * spending any of it — for a request that has to do work before it knows its
 * amount (a voice note's measured length). Null when it may go on to
 * claimPlanUsage, which still has the final say; otherwise the response to
 * send instead, so a request sure to be refused costs nothing first.
 */
export async function checkPlanAllowance(request: Request, userId: string, meter: Meter): Promise<Response | null> {
  const check = await checkPlan(request, userId);
  const limit = PLAN_LIMITS[check.plan][meter];
  if (limit <= 0) return refusal(meter, check);

  const used = await readPlanUsage(userId);
  if (used === null) return usageUnavailable();
  return used[meter] >= limit ? refusal(meter, check) : null;
}

/**
 * Opens a Live voice session, paid for up front: up to `maxSeconds` of the
 * month's Live voice time — what's left, if that is less — is taken now, and
 * settleLiveSession gives back whatever the app then reports it didn't use.
 * The audio goes from the phone straight to Google, so this server never
 * hears how long a session ran; paying first means one the app never reports
 * on (closed in a hurry, a lost connection, a tampered app) counts in full
 * rather than not at all. Either the session, or the response to send instead.
 */
export async function startLiveSession(
  request: Request,
  userId: string,
  maxSeconds: number,
): Promise<{ sessionId: string; seconds: number } | { refused: Response }> {
  const check = await checkPlan(request, userId);
  const limit = PLAN_LIMITS[check.plan].live;
  if (limit <= 0) return { refused: refusal("live", check) };

  let started: { id: string; seconds: number } | null;
  try {
    started = await callServerRpc<{ id: string; seconds: number } | null>("start_ai_live_session", {
      p_user_id: userId,
      p_seconds: Math.round(maxSeconds),
      p_limit: limit,
    });
  } catch (error) {
    logUsageError(error);
    return { refused: usageUnavailable() };
  }
  if (!started) return { refused: refusal("live", check) };
  return { sessionId: started.id, seconds: started.seconds };
}

/**
 * Closes a session startLiveSession opened, with how long the app says it
 * listened: the rest of what was taken goes back to the month it came from.
 * Once per session — a repeated report changes nothing.
 */
export async function settleLiveSession(userId: string, sessionId: string, seconds: number): Promise<void> {
  try {
    await callServerRpc<number>("settle_ai_live_session", {
      p_user_id: userId,
      p_session_id: sessionId,
      p_seconds: Math.max(0, Math.round(seconds)),
    });
  } catch (error) {
    // The session stays counted in full.
    console.error("[serverPlan] couldn't settle a Live voice session", error);
  }
}

/** The UTC calendar month a time falls in ("2026-10-01"), as ai_plan_usage counts them. */
function usageMonth(at: Date): string {
  return `${at.toISOString().slice(0, 7)}-01`;
}

/**
 * What this account has used of each meter so far this month (UTC, like the
 * counting itself) — for the usage view in Settings. A meter with no row yet
 * is 0. Null when the counts can't be read.
 */
export async function readPlanUsage(userId: string): Promise<Record<Meter, number> | null> {
  try {
    const rows = await selectServerRows<{ meter: string; used: number }>("ai_plan_usage", "meter,used", {
      user_id: `eq.${userId}`,
      month: `eq.${usageMonth(new Date())}`,
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

/**
 * Gives back what claimPlanUsage spent at `claimedAt`, when the AI then
 * failed to answer — an outage shouldn't cost someone one of their five
 * breakdowns. Not across the start of a month: the claim's month is over and
 * its allowance can't be used any more, while the new month's count — the
 * only one a refund now reaches — never had it taken.
 */
export async function refundPlanUsage(userId: string, meter: Meter, claimedAt: Date, amount = 1): Promise<void> {
  if (usageMonth(claimedAt) !== usageMonth(new Date())) return;
  await spend(userId, meter, -Math.abs(amount), null);
}
