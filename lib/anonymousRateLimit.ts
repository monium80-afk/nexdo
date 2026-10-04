// A per-IP cap on the routes that stay open to signed-out callers
// (app/api/inbox+api.ts, app/api/extract-text+api.ts and app/api/next+api.ts,
// all for onboarding).
//
// Known limits, because this is the only thing between the open internet and
// the project's Gemini quota and it should not be mistaken for more than it is:
//
//  - The bucket map lives in this process. It resets on every cold start and
//    isn't shared between instances, so the real ceiling is this cap times the
//    number of running instances.
//  - The client is identified by cf-connecting-ip where Cloudflare sets it
//    (EAS Hosting). Anywhere else it falls back to x-forwarded-for, which is
//    client-supplied and only trustworthy if whatever sits in front of this
//    server overwrites it; otherwise every request can look like a new client.
//  - Everyone behind one NAT shares a bucket, so a school or office network
//    can rate-limit itself.
//
// That makes this a cheap first filter for bursts, not the limit that holds:
// lib/anonymousTrial.ts is — it counts each signed-out install's free
// onboarding run in Supabase, shared by every instance.
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 5;

type RequestBucket = {
  startedAt: number;
  count: number;
};

const buckets = new Map<string, RequestBucket>();

// cf-connecting-ip first: EAS Hosting runs on Cloudflare, which sets that
// header itself, while the FIRST x-forwarded-for entry is whatever the caller
// sent (Cloudflare appends to it rather than replacing it) — reading that one
// let anyone look like a new client on every request.
export function getClientIp(request: Request): string {
  const connecting = request.headers.get("cf-connecting-ip")?.trim();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  return connecting || forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
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
