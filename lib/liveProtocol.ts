import type { LiveToolCall } from "@/lib/liveVoiceTools";

// Live voice (app/live-voice.tsx), the parts that don't need a phone: reading
// what Gemini Live sends back and packing microphone audio for the socket.
// No React or React Native imports, so `npm test` runs all of it under Node.

/** What one message from the Gemini Live socket means for the app. */
export type LiveEvent =
  | { type: "ready" }
  /** Google heard speech begin: a turn is open until turnComplete. */
  | { type: "speechStart" }
  /** Google heard the speaker stop. */
  | { type: "speechEnd" }
  /** Changes to make, now. */
  | { type: "toolCalls"; calls: LiveToolCall[] }
  | { type: "turnComplete" }
  /** Google is about to close the connection. */
  | { type: "goAway" }
  /** What Google heard — never shown, only logged in development. */
  | { type: "transcript"; text: string }
  /** Tokens the turn cost — logged in development. */
  | { type: "usage"; promptTokens: number; responseTokens: number; thoughtsTokens: number };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function toolCallOf(value: unknown): LiveToolCall | null {
  const raw = asRecord(value);
  const name = raw && typeof (raw.name ?? raw.functionName) === "string" ? String(raw.name ?? raw.functionName) : null;
  if (!raw || !name) return null;
  return { id: typeof raw.id === "string" ? raw.id : "", name, args: asRecord(raw.args) ?? {} };
}

/**
 * Everything one server message carries, in order. What gemini-3.8-live
 * actually sends for one instruction (checked 2026-09-29): voiceActivity
 * ACTIVITY_START; serverContent.inputTranscription with what it heard and
 * voiceActivity ACTIVITY_END ~0.5–1 s after the speaker stops; then, a tenth
 * to half a second later, toolCall { functionCalls: [{ id, name, args }] },
 * generationComplete and turnComplete with usageMetadata. It also sends
 * sessionResumptionUpdate and empty messages, which mean nothing here.
 */
export function parseServerMessage(message: unknown): LiveEvent[] {
  const root = asRecord(message);
  if (!root) return [];
  const events: LiveEvent[] = [];

  if (root.setupComplete !== undefined) events.push({ type: "ready" });

  const activity = asRecord(root.voiceActivity)?.type;
  if (activity === "ACTIVITY_START") events.push({ type: "speechStart" });
  if (activity === "ACTIVITY_END") events.push({ type: "speechEnd" });

  const content = asRecord(root.serverContent);
  const heard = asRecord(content?.inputTranscription)?.text;
  if (typeof heard === "string" && heard.trim()) events.push({ type: "transcript", text: heard });

  const toolCall = asRecord(root.toolCall);
  if (toolCall) {
    // The documented shape is a list; one guide shows a single call instead.
    const calls = (Array.isArray(toolCall.functionCalls) ? toolCall.functionCalls : [toolCall])
      .map(toolCallOf)
      .filter((call): call is LiveToolCall => call !== null);
    if (calls.length > 0) events.push({ type: "toolCalls", calls });
  }

  if (content?.turnComplete === true) events.push({ type: "turnComplete" });

  const usage = asRecord(root.usageMetadata);
  if (usage) {
    events.push({
      type: "usage",
      promptTokens: Number(usage.promptTokenCount) || 0,
      responseTokens: Number(usage.responseTokenCount) || 0,
      thoughtsTokens: Number(usage.thoughtsTokenCount) || 0,
    });
  }

  if (root.goAway !== undefined) events.push({ type: "goAway" });
  return events;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Standard base64, for the audio chunks the socket carries inside JSON. */
export function encodeBase64(bytes: Uint8Array): string {
  const out: string[] = [];
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out.push(
      BASE64_ALPHABET[(n >> 18) & 63],
      BASE64_ALPHABET[(n >> 12) & 63],
      BASE64_ALPHABET[(n >> 6) & 63],
      BASE64_ALPHABET[n & 63],
    );
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out.push(BASE64_ALPHABET[(n >> 18) & 63], BASE64_ALPHABET[(n >> 12) & 63], "==");
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out.push(BASE64_ALPHABET[(n >> 18) & 63], BASE64_ALPHABET[(n >> 12) & 63], BASE64_ALPHABET[(n >> 6) & 63], "=");
  }
  return out.join("");
}

/**
 * Google sends its JSON as binary frames. Decoded by hand rather than with
 * TextDecoder, which not every React Native engine has — and task titles in
 * French or Arabic are exactly where a wrong decode would show.
 */
export function decodeUtf8(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const byte = bytes[i++];
    let codePoint: number;
    if (byte < 0x80) {
      codePoint = byte;
    } else if (byte >= 0xf0) {
      codePoint = ((byte & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    } else if (byte >= 0xe0) {
      codePoint = ((byte & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    } else {
      codePoint = ((byte & 0x1f) << 6) | (bytes[i++] & 0x3f);
    }
    out += String.fromCodePoint(codePoint);
  }
  return out;
}

/**
 * 16-bit PCM as the socket wants it: one channel. The app asks the
 * microphone for mono, but the hardware may deliver more, and interleaved
 * stereo sent as mono would reach Google as noise.
 */
export function toMonoPcm16(data: ArrayBuffer, channels: number): Uint8Array {
  if (channels <= 1) return new Uint8Array(data);
  const samples = new Int16Array(data);
  const frames = Math.floor(samples.length / channels);
  const mono = new Int16Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel++) sum += samples[frame * channels + channel];
    mono[frame] = Math.round(sum / channels);
  }
  return new Uint8Array(mono.buffer);
}

// The loudness range the sound waves cover: a quiet room sits below the
// first, a raised voice close to the phone reaches the second.
const QUIET_DB = -50;
const LOUD_DB = -10;

/**
 * How loud one buffer of mono 16-bit PCM is, from 0 (silence) to 1 — on a
 * decibel scale, so ordinary speech lands mid-range. Drives the sound waves
 * on the Live voice stop button.
 */
export function audioLevel(pcm: Uint8Array): number {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  const rms = Math.sqrt(sum / samples.length) / 32768;
  if (rms === 0) return 0;
  const decibels = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (decibels - QUIET_DB) / (LOUD_DB - QUIET_DB)));
}
