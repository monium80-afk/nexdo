// Server-only: imported exclusively by app/api/**/+api.ts route handlers.
//
// A daily ceiling on how many Live voice sessions an account may open.
// Supabase keeps the count (supabase/schema.sql, ai_usage), so it holds
// across server instances.
//
// Every AI route is bounded by the account's plan — a monthly count the
// server keeps itself (lib/serverPlan.ts). Live voice's minutes are the one
// thing the server can't measure: the audio goes from the phone straight to
// Google, so a session's time is taken when it opens and the app reports how
// much of it was really used (app/api/live-usage+api.ts), which gives the
// rest back. This ceiling is the stop behind that report: however little a
// tampered app admits to, it can only open so many sessions a day, each no
// longer than its token allows.
import { callServerRpc, RpcConfigError } from "@/lib/serverRpc";

export type AiRoute = "live-session";

// Calls per account per UTC day — far above a busy day of real use.
const DAILY_LIMITS: Record<AiRoute, number> = {
  "live-session": 30,
};

/**
 * Spends one of this account's calls on `route` for today. Returns null when
 * the call may go ahead, or the response to send instead. Call it after the
 * body has been validated, so a malformed request never uses anything up.
 */
export async function claimUserCall(userId: string, route: AiRoute): Promise<Response | null> {
  let allowed: boolean;
  try {
    allowed = await callServerRpc<boolean>("claim_ai_user_call", {
      p_user_id: userId,
      p_route: route,
      p_daily_limit: DAILY_LIMITS[route],
    });
  } catch (error) {
    // Open rather than closed: this only guards against an account being
    // abused, and the session's monthly allowance, checked right after it
    // (lib/serverPlan.ts), is closed when Supabase can't be reached. Loud, so
    // a missing setup isn't missed.
    if (error instanceof RpcConfigError) {
      console.error("[aiUsageLimit] SUPABASE_SECRET_KEY is missing — add it to your .env file");
    } else {
      console.error("[aiUsageLimit] couldn't check the daily limit (is the ai_usage SQL in supabase/schema.sql run?)", error);
    }
    return null;
  }

  if (allowed) return null;
  return Response.json({ error: "daily_limit" }, { status: 429 });
}
