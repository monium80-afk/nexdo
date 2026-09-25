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
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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

async function callGemini(params: {
  systemPrompt?: string;
  parts: GeminiPart[];
  responseSchema?: GeminiJsonSchema;
}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Add GEMINI_API_KEY to your .env file");
  }

  const request: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: params.systemPrompt ? { parts: [{ text: params.systemPrompt }] } : undefined,
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

  let response = await fetch(`${GEMINI_URL}?key=${apiKey}`, request);
  for (const delay of RETRY_DELAYS_MS) {
    if (!RETRYABLE_STATUSES.includes(response.status)) break;
    console.warn(`[gemini] ${response.status}, retrying in ${delay}ms`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    response = await fetch(`${GEMINI_URL}?key=${apiKey}`, request);
  }

  if (!response.ok) {
    throw new Error(`Gemini request failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  // find() rather than parts[0] as cheap insurance against a stray
  // non-text part (e.g. a thought) landing before the real text part.
  const text = data.candidates?.[0]?.content?.parts?.find((p: { text?: string }) => typeof p.text === "string")?.text;
  if (typeof text !== "string") {
    throw new Error("Gemini response had no text content");
  }
  return text;
}

export async function generateStructuredJson(params: {
  systemPrompt: string;
  userContent: string;
  responseSchema: GeminiJsonSchema;
}): Promise<unknown> {
  const text = await callGemini({
    systemPrompt: params.systemPrompt,
    parts: [{ text: params.userContent }],
    responseSchema: params.responseSchema,
  });
  return JSON.parse(text);
}

// Multimodal extraction (photo/voice/document -> plain text) for the AI
// Inbox — see app/api/extract-text+api.ts. Gemini reads the media inline,
// so this is limited to what fits in one request (a few MB); good enough
// for the short recordings/compressed photos this app captures.
export async function extractTextFromMedia(params: { mimeType: string; base64: string; instruction: string }): Promise<string> {
  const text = await callGemini({
    parts: [{ inlineData: { mimeType: params.mimeType, data: params.base64 } }, { text: params.instruction }],
  });
  return text.trim();
}
