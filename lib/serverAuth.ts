// Server-only: imported exclusively by app/api/**/+api.ts route handlers,
// which run on the Expo server runtime, not in the app bundle — this is what
// keeps CLERK_SECRET_KEY (no EXPO_PUBLIC_ prefix) out of the client, the same
// way lib/ai/gemini.ts keeps GEMINI_API_KEY out of it.
//
// Why the AI routes need this at all: every one of them spends the project's
// Gemini quota, and an unauthenticated route is an open LLM proxy that anyone
// who reads the URL out of the app bundle can bill to us. Clerk's session JWT
// is already on the device (the app sends the same token to Supabase), so the
// routes verify that instead of inventing a second credential.
import { verifyToken } from "@clerk/backend";

// How far this server's clock may be from Clerk's when checking a token's
// times. Clerk's default is 5 s — right for a hosted server, whose clock is
// kept exact. In development the routes run on the developer's own PC, and
// that clock drifts: 15–16 s slow on 2026-09-29/30, so every fresh token
// looked "not yet valid" and every signed-in AI route (Live voice, the
// Assistant) answered 401. A minute covers ordinary drift without loosening
// production at all.
const CLOCK_SKEW_MS = process.env.NODE_ENV === "production" ? undefined : 60_000;

/**
 * The server is missing a key it needs. Deliberately its own type: a missing
 * CLERK_SECRET_KEY must never be answered with `null` (that would silently
 * downgrade every signed-in caller to anonymous and turn a misconfiguration
 * into an auth hole), but it must not look like an AI failure either — the
 * client's fallbacks treat any 5xx as "the model is unreachable", so a missing
 * key used to surface as the app quietly running on its offline heuristics.
 */
export class ServerConfigError extends Error {}

/** A 503 the client can tell apart from a model outage, with nothing leaked about which key. */
export function serverMisconfigured(): Response {
  return Response.json({ error: "Server not configured" }, { status: 503 });
}

/**
 * The Clerk user id behind this request, or null if it isn't signed in.
 * Never throws on a bad token — an attacker shouldn't be able to tell a
 * malformed token apart from an expired one. Throws ServerConfigError, and
 * only that, when the server itself can't verify anything.
 */
export async function getUserId(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;

  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    // Loud, because the failure is otherwise invisible: signed-out onboarding
    // keeps working (no token, so this line is never reached) while every
    // signed-in AI call falls back to its offline heuristic.
    console.error("[serverAuth] CLERK_SECRET_KEY is missing — add it to your .env file");
    throw new ServerConfigError("CLERK_SECRET_KEY is not set");
  }

  try {
    // Verifies the signature, expiry and issuer against the Clerk instance
    // the secret key belongs to — so a token minted by some other Clerk app
    // is rejected too, not just an unsigned one.
    const payload = await verifyToken(token, { secretKey, clockSkewInMs: CLOCK_SKEW_MS });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/** The single 401 shape every route returns, so none of them leak *why* it failed. */
export function unauthorized(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * What every route calls instead of getUserId() directly: same answer, with
 * the server-misconfigured case already turned into a response rather than
 * left to escape the handler as an opaque 500.
 *
 *     const auth = await authenticate(request);
 *     if ("failed" in auth) return auth.failed;
 *     if (!auth.userId) return unauthorized();
 */
export async function authenticate(request: Request): Promise<{ userId: string | null } | { failed: Response }> {
  try {
    return { userId: await getUserId(request) };
  } catch (error) {
    if (error instanceof ServerConfigError) return { failed: serverMisconfigured() };
    throw error;
  }
}
