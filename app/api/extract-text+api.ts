import { extractTextFromMedia, measureAudioSeconds } from "@/lib/ai/gemini";
import { anonymousRateLimit } from "@/lib/anonymousRateLimit";
import { claimTrialCall } from "@/lib/anonymousTrial";
import { authenticate } from "@/lib/serverAuth";
import { checkPlanAllowance, claimPlanUsage, refundPlanUsage } from "@/lib/serverPlan";
import {
  asObject,
  badRequest,
  BadRequestError,
  clampNumber,
  clampString,
  LANGUAGES,
  MAX_TITLE_LENGTH,
  oneOf,
  readJsonBody,
} from "@/lib/serverRequest";
import type { AppLanguage } from "@/types/settings";

export type ExtractTextRequestBody = {
  mimeType: string;
  base64: string;
  kind: "photo" | "voice" | "document";
  /** A voice note's length — what the account's monthly voice minutes are counted in. */
  durationSeconds?: number;
  /** The app language — used for any description the model writes itself. */
  language?: AppLanguage;
  /** What the user typed alongside the file ("pull out the deadlines"), if anything. */
  userInstruction?: string;
  /**
   * "context": a photo or document given as context for one task (Task
   * Details, a focus session) — read for what doing that task needs, rather
   * than for to-dos to add. Photos and documents only.
   */
  purpose?: "context";
  /** With "context": the task's title, so the reading knows what matters. */
  taskTitle?: string;
};

export type ExtractTextResponseBody = {
  text: string;
  /** Present only on a failure response. */
  error?: string;
};

// This is a reading pass, not a task-extraction pass: whatever comes back is
// fed through the exact same Task Manager pipeline as typed text (see
// app/api/inbox+api.ts), which is what keeps image-based and text-based
// extraction on identical rules. So the job here is to transcribe faithfully
// and invent nothing — every "guess a duration / resolve a date" decision
// belongs to the layer above, which has the user's tasks and today's date.
const INSTRUCTIONS: Record<ExtractTextRequestBody["kind"], string> = {
  photo: [
    "Read this image and write out everything in it that could matter to a to-do list: every line of text, every action item, and every date, time, deadline or duration shown.",
    "- Transcribe verbatim. Keep dates, times, numbers and names exactly as they are written — never reformat them and never work out a calendar date.",
    "- Put each separate item, assignment or row on its own line, in the order it appears.",
    "- Keep an item's own deadline, time and details on that item's line, so two items never borrow each other's details.",
    "- Invent nothing. If something is blurred, cropped or unreadable, leave it out instead of guessing — and never add a deadline, duration or priority the image doesn't actually show.",
    "- If there is nothing task-like in the image, describe in one short line what it shows.",
    "Output plain text only, exactly as if the user had typed it themselves — no commentary, no markdown, no headings.",
  ].join("\n"),
  voice: "Transcribe this audio recording verbatim into plain text. Output only the transcription, no commentary.",
  document: [
    "Extract the text content of this file, focusing on anything that reads like tasks, deadlines or action items.",
    "- Transcribe verbatim, keeping dates, times and durations exactly as written — never work out a calendar date.",
    "- Put each separate item on its own line, with its own deadline and details on that same line.",
    "- Invent nothing: leave out anything you cannot actually read.",
    "Output plain text only, exactly as if the user had typed it themselves — no commentary, no markdown.",
  ].join("\n"),
};

// A file given as context for one task the user is working on: what's read
// out is kept as a note on that task and fed to its reassessment, breakdowns
// and advice — so it has to say what the task needs to know, including what
// a diagram or a screenshot shows, not just pull out to-dos. Exported so a
// live check can run it against the real model without a server.
export function contextInstruction(kind: "photo" | "document", taskTitle: string | undefined): string {
  const task = taskTitle ? ` ("${taskTitle}")` : "";
  const what =
    kind === "photo"
      ? "Write out everything in this image that matters for doing that task: every line of text, verbatim, and for anything that isn't text — a diagram, a chart, a screenshot, handwritten working, an object — one or two plain sentences saying what it shows."
      : "Write out what in this file matters for doing that task: its instructions, requirements, questions, figures and dates, verbatim where you can. For a long file, keep what the task needs and leave out boilerplate.";
  return [
    `The user attached this ${kind === "photo" ? "image" : "file"} to a task on their to-do list${task} so their assistant can help them do it.`,
    what,
    "- Keep numbers, dates, times, names and formulas exactly as they are written — never reformat them and never work out a calendar date.",
    "- Invent nothing. Leave out anything blurred, cropped or unreadable instead of guessing.",
    "- At most about 600 words.",
    "Output plain text only — no commentary, no markdown, no headings.",
  ].join("\n");
}

// Text that's already in the image/file stays in its own language; only what
// the model writes in its own words (a description) follows the app language.
const DESCRIPTION_LANGUAGE: Partial<Record<AppLanguage, string>> = {
  fr: " Keep extracted text in its original language, but write any description of your own in French.",
  es: " Keep extracted text in its original language, but write any description of your own in Spanish.",
  de: " Keep extracted text in its original language, but write any description of your own in German.",
};

// The accompanying message steers what to look for, but must not become the
// answer: the model reads the file, it doesn't act on the request. Acting on
// it here would produce text that the layer above then reads as a new task.
function focusNote(userInstruction: string | undefined): string {
  const instruction = userInstruction?.trim();
  if (!instruction) return "";
  return `\n\nAlongside this file the user wrote: "${instruction}". Make sure everything it refers to is included in what you write out, and leave out clutter that clearly has nothing to do with it. Still only write what the file actually contains — do not answer the user, do not carry out the request, and do not add anything of your own.`;
}

const KINDS = ["photo", "voice", "document"] as const;

// Only what the app itself captures, and only what Gemini can actually read
// inline. An allowlist rather than a blocklist: an unknown type here is a
// file this app never produces, so there is nothing to be permissive about.
const ALLOWED_MIME_TYPES: Record<ExtractTextRequestBody["kind"], readonly string[]> = {
  photo: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
  voice: ["audio/aac", "audio/mp4", "audio/m4a", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm"],
  document: ["application/pdf", "text/plain", "text/csv", "text/markdown"],
};

// Gemini reads the media inline, so the whole file rides in this one JSON
// body as base64 (~4 bytes per 3 bytes of file). 9MB of body is roughly a
// 6.5MB file — well above the compressed photos and short recordings the app
// captures, and well under the point where one request ties up the runtime.
const MAX_BODY_BYTES = 9 * 1024 * 1024;

// The user's own words steer the read (see focusNote). A sentence or two is
// the real use; anything longer is someone trying to use this as a general
// prompt channel rather than a caption.
const MAX_INSTRUCTION_LENGTH = 500;

// A voice note is counted by its length — what Google hears in it, measured
// before it's transcribed (measureAudioSeconds). The length the app states,
// with the file's size as a floor under it, only stands in when that can't
// be measured: a low-bitrate file holds far more audio than its size
// suggests, so on their own those two let a tampered app pass off a long
// recording as a short one. The floor assumes a bitrate far above anything
// the app records (compressed audio is about 16 KB a second, uncompressed
// WAV under 200), so an honest length is never raised by it.
const TYPICAL_BYTES_PER_SECOND = 16_000;
const MAX_BYTES_PER_SECOND = { compressed: 40_000, wav: 200_000 };
// Well past anything the app records (MAX_BODY_BYTES alone stops its own
// recordings at a few minutes). Also what bounds a signed-out request, whose
// trial counts calls rather than seconds.
const MAX_VOICE_SECONDS = 15 * 60;

const EXTRACT_BUDGET_MS = 26_000;

function estimatedVoiceSeconds(declared: number | undefined, bytes: number, mimeType: string): number {
  const ceiling = mimeType.includes("wav") ? MAX_BYTES_PER_SECOND.wav : MAX_BYTES_PER_SECOND.compressed;
  const seconds = Math.max(declared ?? bytes / TYPICAL_BYTES_PER_SECOND, bytes / ceiling);
  return Math.min(MAX_VOICE_SECONDS, Math.max(1, Math.ceil(seconds)));
}

/** A voice note's length in whole seconds, or null for one longer than the app ever records. */
async function voiceSeconds(params: { declared: number | undefined; bytes: number; mimeType: string; base64: string }): Promise<number | null> {
  let seconds: number;
  try {
    seconds = await measureAudioSeconds(params);
  } catch (error) {
    console.warn(
      "[api/extract-text] couldn't measure a voice note, going by its stated length:",
      error instanceof Error ? error.message : error,
    );
    return estimatedVoiceSeconds(params.declared, params.bytes, params.mimeType.toLowerCase());
  }
  return seconds > MAX_VOICE_SECONDS ? null : Math.max(1, Math.ceil(seconds));
}

// Open to signed-out callers only for onboarding's free run: the brain dump
// can be spoken (app/onboarding-dump.tsx) before the user signs up. The body
// is an arbitrary media file plus an instruction — the shape of a general LLM
// proxy — so the MIME allowlist and MAX_BODY_BYTES limit what one request can
// be, and lib/anonymousTrial.ts allows a signed-out install only a few.
// Signed in, a photo or document is one of the account's files for the month
// and a voice note uses its length in voice minutes (lib/serverPlan.ts).
export async function POST(request: Request) {
  // The app's 30 s wait (lib/api.ts) began before it sent the file, so the
  // reading has to be done within this of the request arriving — upload,
  // length check and plan check included.
  const deadline = Date.now() + EXTRACT_BUDGET_MS;

  // See the same call in app/api/inbox+api.ts for why this 503s rather than
  // falling through to the anonymous path.
  const auth = await authenticate(request);
  if ("failed" in auth) return auth.failed;
  if (!auth.userId) {
    const rateLimitResponse = anonymousRateLimit(request, "extract-text");
    if (rateLimitResponse) return rateLimitResponse;
  }

  let raw: unknown;
  try {
    raw = await readJsonBody(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof BadRequestError) return badRequest();
    throw error;
  }

  const parsed = asObject(raw);
  const kind = oneOf(parsed.kind, KINDS);
  const mimeType = clampString(parsed.mimeType, 100);
  const base64 = typeof parsed.base64 === "string" ? parsed.base64 : undefined;
  if (!kind || !mimeType || !base64) return badRequest();
  if (!ALLOWED_MIME_TYPES[kind].includes(mimeType.toLowerCase())) return badRequest();

  // Base64 is 4 characters per 3 bytes. Logged on both paths below because
  // it is the one number that separates "the model couldn't read it" from
  // "the recorder handed us a file with nothing in it" — a silent emulator
  // mic and a genuinely unreadable recording look identical from up here.
  const bytes = Math.floor((base64.length * 3) / 4);

  // What this file uses of the account's month — given back below if the
  // model then can't read it.
  // Measuring a voice note sends it to Google, so whether this caller may use
  // anything at all is settled first: a signed-out trial counts calls, so it
  // is claimed outright; an account is only checked for voice time left, and
  // then charged the measured length.
  const { userId } = auth;
  let usage: { meter: "voice" | "media"; amount: number } = { meter: "media", amount: 1 };
  const earlyLimitResponse = !userId
    ? await claimTrialCall(request, "extract-text")
    : kind === "voice"
      ? await checkPlanAllowance(request, userId, "voice")
      : null;
  if (earlyLimitResponse) return earlyLimitResponse;

  if (kind === "voice") {
    const declared = clampNumber(parsed.durationSeconds, 0, MAX_VOICE_SECONDS);
    const seconds = await voiceSeconds({ declared, bytes, mimeType, base64 });
    if (seconds === null) return badRequest();
    usage = { meter: "voice", amount: seconds };
  }

  const claimedAt = new Date();
  const limitResponse = userId ? await claimPlanUsage(request, userId, usage.meter, usage.amount) : null;
  if (limitResponse) return limitResponse;

  const language = oneOf(parsed.language, LANGUAGES);
  const userInstruction = clampString(parsed.userInstruction, MAX_INSTRUCTION_LENGTH);
  const languageNote = kind === "voice" || !language ? "" : (DESCRIPTION_LANGUAGE[language] ?? "");
  const forTask = parsed.purpose === "context" && kind !== "voice";
  const instruction = forTask
    ? contextInstruction(kind, clampString(parsed.taskTitle, MAX_TITLE_LENGTH))
    : INSTRUCTIONS[kind];

  try {
    const text = await extractTextFromMedia({
      label: `extract-text:${forTask ? "context-" : ""}${kind}`,
      mimeType,
      base64,
      instruction: `${instruction}${languageNote}${focusNote(userInstruction)}`,
      deadline,
    });
    if (!text) console.warn(`[api/extract-text] ${kind} ${mimeType} ${bytes}B -> empty (model read nothing in it)`);
    return Response.json({ text } satisfies ExtractTextResponseBody);
  } catch (error) {
    // Deliberately not a 200 with empty text any more. That made every key,
    // quota, network and decode failure arrive at the client looking exactly
    // like "your recording was silent" — the one explanation the user can act
    // on, and the one it usually wasn't. A 5xx makes apiPost throw, so the
    // caller's catch branch runs and says "couldn't transcribe" instead.
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[api/extract-text] ${kind} ${mimeType} ${bytes}B failed:`, reason);
    if (userId) await refundPlanUsage(userId, usage.meter, claimedAt, usage.amount);
    return Response.json({ text: "", error: "extraction_failed" } satisfies ExtractTextResponseBody, { status: 502 });
  }
}
