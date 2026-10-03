// Server-only: imported exclusively by app/api/**/+api.ts route handlers.
//
// A daily ceiling on how many Live voice sessions an account may open.
// Supabase keeps the count (supabase/schema.sql, ai_usage), so it holds
// across server instances.
//
// Every other AI route is bounded by the account's plan instead — a monthly
// count the server keeps itself (lib/serverPlan.ts). Live voice's minutes are
// the one thing the server can't measure: the audio goes from the phone
// straight to Google, so the app reports how long it listened
// (app/api/live-usage+api.ts). This ceiling is the stop behind that report:
// however little a tampered app admits to, it can only open so many sessions
// of up to 6 minutes a day.
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
    // Open rather than closed, unlike the signed-out trial: this guards
    // against an account being abused, and a Supabase hiccup shouldn't switch
    // the AI off for everyone signed in. Loud, so a missing setup isn't missed.
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
