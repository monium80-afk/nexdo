// Server-only: imported exclusively by app/api/**/+api.ts route handlers.
//
// A daily ceiling on each signed-in account's AI calls. Signing in skips the
// signed-out limits (lib/anonymousRateLimit.ts, lib/anonymousTrial.ts), and an
// account costs nothing to make — without this, one account, or a script
// holding its session token, could call the AI routes as often as it liked,
// every call billed to the project's Gemini key. Supabase keeps the count
// (supabase/schema.sql, ai_usage), so it holds across server instances.
//
// An abuse ceiling, not a plan: every call is something a person tapped or
// said, so these sit far above a busy day. Monthly credits per plan are a
// separate decision, still open.
import { callServerRpc, RpcConfigError } from "@/lib/serverRpc";

export type AiRoute = "inbox" | "extract-text" | "next" | "breakdown" | "reassess" | "live-session";

// Calls per account per UTC day. The inbox (several Gemini calls per request)
// and live voice (up to 6 minutes of audio per session) cost the most per call.
const DAILY_LIMITS: Record<AiRoute, number> = {
  inbox: 200,
  "extract-text": 100,
  next: 200,
  breakdown: 200,
  reassess: 200,
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
