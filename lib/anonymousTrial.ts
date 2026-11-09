// Server-only: imported exclusively by app/api/**/+api.ts route handlers.
//
// The one free AI run a signed-out person gets during onboarding. The three
// routes onboarding uses (inbox, extract-text, next) stay open to signed-out
// callers so a new user can see what the AI does before making an account —
// but only once. After that, keeping their tasks and using the AI again means
// signing in.
//
// The app makes up a random id the first time it runs (lib/aiTrial.ts) and
// sends it as X-Nexdo-Trial on every signed-out request. Supabase counts what
// each id has used (supabase/schema.sql, ai_trials), which holds across server
// instances and restarts, unlike the in-memory limiter in anonymousRateLimit.
// A script can make up as many ids as it likes, so two more ceilings sit
// behind the per-id allowance: new ids per IP per day, and new ids per day in
// total — that last one is the hard cap on what signed-out AI can ever cost.
import { getClientIp } from "@/lib/anonymousRateLimit";
import { serverMisconfigured } from "@/lib/serverAuth";
import { callServerRpc, RpcConfigError } from "@/lib/serverRpc";

export type TrialRoute = "inbox" | "extract-text" | "next";

// What one honest onboarding run needs: a few voice notes for the brain dump,
// one read of it, and the advice on the task it picks — twice, for someone who
// steps back past that screen and forward again.
const TRIAL_ALLOWANCE: Record<TrialRoute, number> = { "extract-text": 3, inbox: 1, next: 2 };

// A household or a classroom shares one IP, so this is a few rather than one.
const NEW_TRIALS_PER_IP_PER_DAY = 5;

// The ceiling on signed-out spending. A normal run costs about a cent; one
// built to be as expensive as the caps allow, about five. 300 a day is
// roughly $3 a day of real use and $15 at the very worst.
const NEW_TRIALS_PER_DAY = 300;

const TRIAL_ID_PATTERN = /^[a-zA-Z0-9-]{16,64}$/;

type ClaimResult = "ok" | "trial_used" | "ip_limit" | "global_limit";

// The IP is only ever stored hashed: it's needed to tell one caller from
// another, not to know who they are.
async function hashIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`nexdo-trial:${ip}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function claim(params: { trialId: string; ipHash: string; route: TrialRoute }): Promise<ClaimResult> {
  return callServerRpc<ClaimResult>("claim_ai_trial_call", {
    p_trial_id: params.trialId,
    p_ip_hash: params.ipHash,
    p_route: params.route,
    p_route_limit: TRIAL_ALLOWANCE[params.route],
    p_ip_daily_limit: NEW_TRIALS_PER_IP_PER_DAY,
    p_global_daily_limit: NEW_TRIALS_PER_DAY,
  });
}

/**
 * Spends one of this signed-out caller's free onboarding calls on `route`.
 * Returns null when the call may go ahead, or the response to send instead.
 * Call it after the body has been validated, so a malformed request never
 * uses anything up.
 */
export async function claimTrialCall(request: Request, route: TrialRoute): Promise<Response | null> {
  const trialId = request.headers.get("x-nexdo-trial")?.trim();
  if (!trialId || !TRIAL_ID_PATTERN.test(trialId)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let result: ClaimResult;
  try {
    result = await claim({ trialId, ipHash: await hashIp(getClientIp(request)), route });
  } catch (error) {
    // Closed rather than open: if the allowance can't be checked, the free
    // run doesn't happen — that is what keeps it from being unlimited.
    if (error instanceof RpcConfigError) {
      console.error("[anonymousTrial] SUPABASE_SECRET_KEY is missing — add it to your .env file");
    } else {
      console.error("[anonymousTrial]", error);
    }
    return serverMisconfigured();
  }

  if (result === "ok") return null;
  if (result === "trial_used") {
    return Response.json({ error: "trial_used" }, { status: 403 });
  }
  return Response.json({ error: "trial_unavailable" }, { status: 429 });
}
