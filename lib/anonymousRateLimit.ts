// A per-IP cap on the two routes that stay open to signed-out callers
// (app/api/inbox+api.ts and app/api/extract-text+api.ts, both for onboarding).
//
// Known limits, because this is the only thing between the open internet and
// the project's Gemini quota and it should not be mistaken for more than it is:
//
//  - The bucket map lives in this process. It resets on every cold start and
//    isn't shared between instances, so the real ceiling is this cap times the
//    number of running instances.
//  - x-forwarded-for is client-supplied. It is only trustworthy if whatever
//    sits in front of this server overwrites it; if requests can reach the
//    runtime directly, the header can be forged and every request looks like a
//    new client.
//  - Everyone behind one NAT shares a bucket, so a school or office network
//    can rate-limit itself.
//
// Anything that needs to hold properly wants a shared store (a Supabase table,
// Redis) keyed the same way. Closing the two routes to signed-out callers —
// see the TODOs on them — removes the need entirely.
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 5;

type RequestBucket = {
  startedAt: number;
  count: number;
};

const buckets = new Map<string, RequestBucket>();

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function anonymousRateLimit(request: Request, route: string): Response | null {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now - bucket.startedAt >= WINDOW_MS) buckets.delete(key);
  }

  const key = `${route}:${getClientIp(request)}`;
  const current = buckets.get(key);
  const bucket = !current || now - current.startedAt >= WINDOW_MS ? { startedAt: now, count: 0 } : current;

  bucket.count += 1;
  buckets.set(key, bucket);

  if (bucket.count <= MAX_REQUESTS_PER_WINDOW) return null;

  const retryAfter = Math.max(1, Math.ceil((bucket.startedAt + WINDOW_MS - now) / 1000));
  return Response.json(
    { error: "Too many requests" },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
