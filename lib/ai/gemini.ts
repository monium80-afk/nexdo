// Server-only: imported exclusively by app/api/**/+api.ts route handlers,
// which run on the Expo server runtime, not in the app bundle — this is
// what keeps GEMINI_API_KEY (no EXPO_PUBLIC_ prefix) out of the client.
// See AGENTS.md "AI / Stream / Vision Agent Rules".

// Pinned rather than a rolling "-latest" alias, which can silently move
// onto a brand-new release with a tiny temporary free-tier quota (this
// happened with gemini-3.8-flash: 20 requests/day). gemini-2.5-flash is
// deprecated for new API keys entirely (404). Of the remaining options,
// the bigger "thinking" flash models (3.5/3.6/3.7/3.8) were unreliable for
// this app's structured extraction: even at temperature 0 they would
// sometimes narrate their own reasoning *inside* a JSON string field
// instead of just filling it in. gemini-3.1-flash-lite doesn't have that
// problem, but had its own: with thinking fully disabled, anything that
// invited even a little reasoning — a weekday name like "Thursday" was
// enough — made it spiral into runaway repetitive output instead of
// answering, because it had no legitimate channel left to work that out.
// A small thinking budget (see thinkingConfig below) gives it that outlet
// back and fixed this completely in testing.
const GEMINI_MODEL = "gemini-3.1-flash-lite";
const GEMINI_ORIGIN = "https://generativelanguage.googleapis.com";
const GEMINI_API = `${GEMINI_ORIGIN}/v1beta`;
const GEMINI_URL = `${GEMINI_API}/models/${GEMINI_MODEL}:generateContent`;

// Google answers "503: this model is currently experiencing high demand" in
// bursts — at busy times a third or more of requests, in testing — and it
// clears within a second or two. Retried here so one blip doesn't reach the
// user as a failed transcription or reply. Anything else (a 400 for an
// unreadable file, a 429 for a used-up quota, a bad key) fails the same way
// every time, so retrying it would only make the user wait longer for it.
const RETRYABLE_STATUSES = [500, 503, 504];
const RETRY_DELAYS_MS = [1000, 2500];

export type GeminiJsonSchema = Record<string, unknown>;

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

/**
 * Google answered with an error status (after retries). Its own type so a
 * caller can tell "Google refused this" — a used-up quota, a bad key, an
 * unreadable file — apart from the model answering with something unusable:
 * sending more requests only helps with the second.
 */
export class GeminiHttpError extends Error {
  // A plain field rather than a constructor parameter property: `npm test`
  // runs under Node's type stripping, which can't compile those, and the
  // reassess route's tests load this file.
  readonly status: number;

  constructor(status: number, body: string) {
    super(`Gemini request failed: ${status} ${body}`);
    this.status = status;
  }
}

type GeminiUsage = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
};

// One line per billed call: what each feature really costs, straight from
// Google's own count. Thinking tokens are billed at the output rate, so they
// are reported next to the answer tokens rather than folded into them.
function logUsage(label: string, usage: GeminiUsage | undefined) {
  if (!usage) return;
  console.info(
    `[gemini] ${label} in=${usage.promptTokenCount ?? 0} out=${usage.candidatesTokenCount ?? 0} thinking=${usage.thoughtsTokenCount ?? 0} cached=${usage.cachedContentTokenCount ?? 0}`,
  );
}

function geminiHeaders(): Record<string, string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Add GEMINI_API_KEY to your .env file");
  }
  // A header rather than "?key=" on the URL, so the key never ends up in
  // anything that logs request URLs.
  return { "Content-Type": "application/json", "x-goog-api-key": apiKey };
}

// ---------------------------------------------------------------------
// System prompt caching
// ---------------------------------------------------------------------
// The inbox sends the same ~4,000-token system prompt with every call, and a
// single message can make several. Saved once at Google as a "cached
// content", each call reads it at the cached rate — a tenth of the normal
// input price — plus storage while the cache is alive: $1 per million tokens
// per hour, about $0.004 an hour for this prompt, ~$2.90 a month if it is
// never idle. That pays for itself after roughly 3,000 inbox calls a month.
//
// Every server instance finds the same cache by its display name (a hash of
// the model and prompt) instead of making its own, and a changed prompt is a
// new name — the old cache simply runs out. It is renewed only while calls
// keep arriving, so a quiet night lets it lapse and stops the storage bill.
//
// A request that uses a cache can't also send a systemInstruction (Google
// answers 400), which is why the inbox route puts its per-language notes in
// the message: that keeps the system prompt identical for every user.
const CACHE_TTL = "3600s";
/** Renew once less than this is left, so a busy cache never lapses. */
const CACHE_RENEW_BELOW_MS = 20 * 60 * 1000;
/** Never hand out a cache closer than this to expiring — the call could land after it. */
const CACHE_MIN_REMAINING_MS = 60 * 1000;
/** After a failure (Google down, prompt too small to cache), send prompts in full for a while. */
const CACHE_RETRY_AFTER_MS = 5 * 60 * 1000;

type PromptCache = { name: string; expiresAt: number };

const promptCaches = new Map<string, PromptCache>();
const pendingCaches = new Map<string, Promise<PromptCache | null>>();
const cacheUnavailableUntil = new Map<string, number>();

async function cacheDisplayName(systemPrompt: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${GEMINI_MODEL}\n${systemPrompt}`));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `nexdo-prompt-${hex.slice(0, 16)}`;
}

async function cacheRequest(path: string, init: RequestInit = {}): Promise<{ name: string; expireTime: string }> {
  const response = await fetch(`${GEMINI_API}/${path}`, { ...init, headers: geminiHeaders() });
  if (!response.ok) throw new GeminiHttpError(response.status, await response.text());
  return response.json();
}

function toPromptCache(cache: { name: string; expireTime: string }): PromptCache {
  return { name: cache.name, expiresAt: Date.parse(cache.expireTime) };
}

// Another instance may already have made it. A list of caches is one page for
// this app — it only ever keeps one per prompt version.
async function findPromptCache(displayName: string): Promise<PromptCache | null> {
  const response = await fetch(`${GEMINI_API}/cachedContents?pageSize=100`, { headers: geminiHeaders() });
  if (!response.ok) throw new GeminiHttpError(response.status, await response.text());
  const { cachedContents = [] } = (await response.json()) as {
    cachedContents?: { name: string; displayName?: string; model?: string; expireTime: string }[];
  };
  const usable = cachedContents
    .filter((cache) => cache.displayName === displayName && cache.model === `models/${GEMINI_MODEL}`)
    .map(toPromptCache)
    .filter((cache) => cache.expiresAt - Date.now() > CACHE_MIN_REMAINING_MS)
    .sort((a, b) => b.expiresAt - a.expiresAt);
  return usable[0] ?? null;
}

async function renewPromptCache(name: string): Promise<PromptCache> {
  return toPromptCache(
    await cacheRequest(`${name}?updateMask=ttl`, { method: "PATCH", body: JSON.stringify({ ttl: CACHE_TTL }) }),
  );
}

async function acquirePromptCache(
  displayName: string,
  systemPrompt: string,
  current: PromptCache | undefined,
): Promise<PromptCache | null> {
  try {
    if (current && current.expiresAt - Date.now() > CACHE_MIN_REMAINING_MS) {
      try {
        return await renewPromptCache(current.name);
      } catch (error) {
        // Already gone (deleted, or expired early) — find or make another.
        console.warn("[gemini] prompt cache renewal failed", error);
      }
    }
    const found = await findPromptCache(displayName);
    if (found) {
      return found.expiresAt - Date.now() > CACHE_RENEW_BELOW_MS ? found : await renewPromptCache(found.name);
    }
    return toPromptCache(
      await cacheRequest("cachedContents", {
        method: "POST",
        body: JSON.stringify({
          model: `models/${GEMINI_MODEL}`,
          displayName,
          systemInstruction: { parts: [{ text: systemPrompt }] },
          ttl: CACHE_TTL,
        }),
      }),
    );
  } catch (error) {
    console.warn("[gemini] prompt cache unavailable, sending the prompt in full", error);
    cacheUnavailableUntil.set(displayName, Date.now() + CACHE_RETRY_AFTER_MS);
    return null;
  }
}

/**
 * The name of a live cache holding `systemPrompt`, or null if there isn't one
 * to be had right now — in which case the caller sends the prompt in full, as
 * it always used to. Never throws.
 */
async function promptCacheName(systemPrompt: string): Promise<string | null> {
  const displayName = await cacheDisplayName(systemPrompt);
  const current = promptCaches.get(displayName);
  const remaining = current ? current.expiresAt - Date.now() : 0;
  if (current && remaining > CACHE_RENEW_BELOW_MS) return current.name;
  if (!current && (cacheUnavailableUntil.get(displayName) ?? 0) > Date.now()) return null;

  // One find/create/renew at a time per prompt, shared by every call waiting.
  let pending = pendingCaches.get(displayName);
  if (!pending) {
    pending = acquirePromptCache(displayName, systemPrompt, current).then((cache) => {
      pendingCaches.delete(displayName);
      if (cache) promptCaches.set(displayName, cache);
      else promptCaches.delete(displayName);
      return cache;
    });
    pendingCaches.set(displayName, pending);
  }
  // A renewal doesn't have to be waited for while the current cache still
  // has time left; only a first acquisition does.
  if (current && remaining > CACHE_MIN_REMAINING_MS) return current.name;
  return (await pending)?.name ?? null;
}

/** A cache Google says doesn't exist any more (deleted, or expired early) — stop handing it out. */
function forgetPromptCache(name: string) {
  for (const [displayName, cache] of promptCaches) {
    if (cache.name === name) promptCaches.delete(displayName);
  }
}

async function callGemini(params: {
  /** Which feature this call is for — only used in the usage log. */
  label: string;
  systemPrompt?: string;
  /** A cache holding the system prompt, used instead of sending it. */
  cachedContent?: string;
  parts: GeminiPart[];
  responseSchema?: GeminiJsonSchema;
}): Promise<string> {
  const request: RequestInit = {
    method: "POST",
    headers: geminiHeaders(),
    body: JSON.stringify({
      ...(params.cachedContent
        ? { cachedContent: params.cachedContent }
        : { systemInstruction: params.systemPrompt ? { parts: [{ text: params.systemPrompt }] } : undefined }),
      contents: [{ role: "user", parts: params.parts }],
      generationConfig: {
        // A small but non-zero budget — see the model comment above. Zero
        // (thinking fully off) is what caused the runaway failures; this
        // model also accepts thinkingBudget: 0 without erroring, unlike some
        // other 3.x models, which makes that failure mode easy to miss.
        thinkingConfig: { thinkingBudget: 512 },
        // Generous enough for a normal reply, but deliberately not huge:
        // if the model ever does start rambling instead of answering, this
        // caps how much time/tokens that failure burns before falling back.
        maxOutputTokens: 2048,
        // Low temperature for a classification/extraction task with a
        // fixed schema — deterministic field-filling, not creative writing.
        temperature: 0,
        ...(params.responseSchema ? { responseMimeType: "application/json", responseSchema: params.responseSchema } : {}),
      },
    }),
  };

  let response = await fetch(GEMINI_URL, request);
  for (const delay of RETRY_DELAYS_MS) {
    if (!RETRYABLE_STATUSES.includes(response.status)) break;
    console.warn(`[gemini] ${response.status}, retrying in ${delay}ms`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    response = await fetch(GEMINI_URL, request);
  }

  if (!response.ok) {
    throw new GeminiHttpError(response.status, await response.text());
  }

  const data = await response.json();
  logUsage(params.label, data.usageMetadata);
  // find() rather than parts[0] as cheap insurance against a stray
  // non-text part (e.g. a thought) landing before the real text part.
  const text = data.candidates?.[0]?.content?.parts?.find((p: { text?: string }) => typeof p.text === "string")?.text;
  if (typeof text !== "string") {
    throw new Error("Gemini response had no text content");
  }
  return text;
}

export async function generateStructuredJson(params: {
  label: string;
  systemPrompt: string;
  userContent: string;
  responseSchema: GeminiJsonSchema;
  /**
   * Read the system prompt from a cache at Google (see "System prompt
   * caching" above). Only worth it for a long prompt sent often — the inbox.
   */
  cacheSystemPrompt?: boolean;
}): Promise<unknown> {
  const call = { label: params.label, parts: [{ text: params.userContent }], responseSchema: params.responseSchema };
  const cachedContent = params.cacheSystemPrompt ? await promptCacheName(params.systemPrompt) : null;

  let text: string;
  if (cachedContent) {
    try {
      text = await callGemini({ ...call, cachedContent });
    } catch (error) {
      // The cache went away between being handed out and being used (Google
      // answers 403 "CachedContent not found"). Same call, prompt in full; the
      // next call makes or finds a fresh cache.
      if (!(error instanceof GeminiHttpError) || !/cachedcontent/i.test(error.message)) throw error;
      forgetPromptCache(cachedContent);
      text = await callGemini({ ...call, systemPrompt: params.systemPrompt });
    }
  } else {
    text = await callGemini({ ...call, systemPrompt: params.systemPrompt });
  }
  return JSON.parse(text);
}

// ---------------------------------------------------------------------
// Live sessions
// ---------------------------------------------------------------------
// Live voice streams the microphone from the phone straight to Google over a
// WebSocket, and the phone can't be given GEMINI_API_KEY. The server mints a
// single-use "ephemeral token" instead, with the session's whole setup baked
// in, so the token opens that one kind of session and nothing else.
//
// Google's docs create tokens on v1beta while its own JS SDK still uses
// v1alpha, so both are tried; the socket must use the version that answered.
const LIVE_TOKEN_VERSIONS = ["v1beta", "v1alpha"] as const;
/** How long the phone has to open the socket once it has the token. */
const LIVE_CONNECT_WINDOW_MS = 60 * 1000;

export async function createLiveSessionToken(params: {
  /** The BidiGenerateContent setup — model, transcription options — the session is locked to. */
  setup: Record<string, unknown>;
  /** After this the token is dead — the ceiling on one session's length (and bill). */
  sessionMinutes: number;
}): Promise<{ websocketUrl: string }> {
  const now = Date.now();
  // The setup's own fields go straight into bidiGenerateContentSetup —
  // wrapped in { setup } (as the SDK's converter source suggests) Google
  // answers 400 "Unknown name setup" (checked 2026-09-29).
  const body = JSON.stringify({
    uses: 1,
    newSessionExpireTime: new Date(now + LIVE_CONNECT_WINDOW_MS).toISOString(),
    expireTime: new Date(now + params.sessionMinutes * 60 * 1000).toISOString(),
    bidiGenerateContentSetup: params.setup,
  });

  let notFound: GeminiHttpError | null = null;
  for (const version of LIVE_TOKEN_VERSIONS) {
    const response = await fetch(`${GEMINI_ORIGIN}/${version}/auth_tokens`, { method: "POST", headers: geminiHeaders(), body });
    if (response.status === 404) {
      notFound = new GeminiHttpError(404, await response.text());
      continue;
    }
    if (!response.ok) throw new GeminiHttpError(response.status, await response.text());
    const { name } = (await response.json()) as { name?: string };
    if (!name) throw new Error("Gemini returned no live session token");
    console.info(`[gemini] live token issued (${version})`);
    // A token rather than a key: the "Constrained" endpoint, with it as
    // access_token — as the SDK does for any key starting "auth_tokens/".
    return {
      websocketUrl: `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${version}.GenerativeService.BidiGenerateContentConstrained?access_token=${name}`,
    };
  }
  throw notFound ?? new Error("No live token endpoint answered");
}

// Multimodal extraction (photo/voice/document -> plain text) for the AI
// Inbox — see app/api/extract-text+api.ts. Gemini reads the media inline,
// so this is limited to what fits in one request (a few MB); good enough
// for the short recordings/compressed photos this app captures.
export async function extractTextFromMedia(params: {
  label: string;
  mimeType: string;
  base64: string;
  instruction: string;
}): Promise<string> {
  const text = await callGemini({
    label: params.label,
    parts: [{ inlineData: { mimeType: params.mimeType, data: params.base64 } }, { text: params.instruction }],
  });
  return text.trim();
}
