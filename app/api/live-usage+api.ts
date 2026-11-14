import { authenticate, unauthorized } from "@/lib/serverAuth";
import { settleLiveSession } from "@/lib/serverPlan";
import { asObject, badRequest, BadRequestError, clampNumber, readJsonBody } from "@/lib/serverRequest";

// Live voice's minutes, settled. A session's audio goes from the phone
// straight to Google, so this server never hears how long it ran: its time
// was taken from the account's month when it opened (app/api/live-session+api.ts),
// and the app says here how long it really listened once it stops
// (lib/liveVoice.ts), which gives the rest back (lib/serverPlan.ts).
//
// The number is still the app's word. A tampered app that says a session
// used nothing gets that session's time back — but no more than that, since
// a session can't outlast its token, and app/api/live-session+api.ts only
// opens so many a day. An app that never reports keeps it all counted.

export type LiveUsageRequestBody = {
  /** The session, as /api/live-session named it. */
  sessionId: string;
  /** How long it listened. */
  seconds: number;
};

const MAX_BODY_BYTES = 1024;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Anything past a session's own time is ignored when it's settled; this only
// keeps the number sane.
const MAX_REPORTED_SECONDS = 24 * 60 * 60;

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

  const body = asObject(raw);
  const sessionId = typeof body.sessionId === "string" && SESSION_ID_PATTERN.test(body.sessionId) ? body.sessionId : undefined;
  const seconds = clampNumber(body.seconds, 0, MAX_REPORTED_SECONDS);
  if (!sessionId || seconds === undefined) return badRequest();

  await settleLiveSession(auth.userId, sessionId, Math.ceil(seconds));
  return Response.json({ ok: true });
}
