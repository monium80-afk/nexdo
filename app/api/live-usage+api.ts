import { MAX_LIVE_SECONDS } from "@/lib/liveVoice";
import { authenticate, unauthorized } from "@/lib/serverAuth";
import { recordPlanUsage } from "@/lib/serverPlan";
import { asObject, badRequest, BadRequestError, clampNumber, readJsonBody } from "@/lib/serverRequest";

// Live voice's minutes, counted. A session's audio goes from the phone
// straight to Google, so this server never hears how long it ran — the app
// says so here once it stops listening (lib/liveVoice.ts), and that is added
// to the account's month (lib/serverPlan.ts).
//
// The number is the app's word. What a tampered app could gain by lying is
// bounded from the other side: app/api/live-session+api.ts only hands out so
// many sessions a day, each at most a few minutes long.

export type LiveUsageRequestBody = {
  /** How long the session listened. */
  seconds: number;
};

const MAX_BODY_BYTES = 1024;
// The app stops at MAX_LIVE_SECONDS; the slack covers a slow last sentence.
const MAX_REPORTED_SECONDS = MAX_LIVE_SECONDS + 60;

export async function POST(request: Request) {
  const auth = await authenticate(request);
  if ("failed" in auth) return auth.failed;
  if (!auth.userId) return unauthorized();

  let raw: unknown;
  try {
    raw = await readJsonBody(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof BadRequestError) return badRequest();
    throw error;
  }

  const seconds = clampNumber(asObject(raw).seconds, 0, MAX_REPORTED_SECONDS);
  if (seconds === undefined) return badRequest();

  if (seconds > 0) await recordPlanUsage(auth.userId, "live", Math.ceil(seconds));
  return Response.json({ ok: true });
}
