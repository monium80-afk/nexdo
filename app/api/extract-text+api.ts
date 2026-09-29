import { extractTextFromMedia } from "@/lib/ai/gemini";
import { anonymousRateLimit } from "@/lib/anonymousRateLimit";
import { claimTrialCall } from "@/lib/anonymousTrial";
import { authenticate } from "@/lib/serverAuth";
import { asObject, badRequest, BadRequestError, clampString, LANGUAGES, oneOf, readJsonBody } from "@/lib/serverRequest";
import type { AppLanguage } from "@/types/settings";

export type ExtractTextRequestBody = {
  mimeType: string;
  base64: string;
  kind: "photo" | "voice" | "document";
  /** The app language — used for any description the model writes itself. */
  language?: AppLanguage;
  /** What the user typed alongside the file ("pull out the deadlines"), if anything. */
  userInstruction?: string;
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

// Open to signed-out callers only for onboarding's free run: the brain dump
// can be spoken (app/onboarding-dump.tsx) before the user signs up. The body
// is an arbitrary media file plus an instruction — the shape of a general LLM
// proxy — so the MIME allowlist and MAX_BODY_BYTES limit what one request can
// be, and lib/anonymousTrial.ts allows a signed-out install only a few.
export async function POST(request: Request) {
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

  if (!auth.userId) {
    const trialResponse = await claimTrialCall(request, "extract-text");
    if (trialResponse) return trialResponse;
  }

  const language = oneOf(parsed.language, LANGUAGES);
  const userInstruction = clampString(parsed.userInstruction, MAX_INSTRUCTION_LENGTH);
  const languageNote = kind === "voice" || !language ? "" : (DESCRIPTION_LANGUAGE[language] ?? "");

  // Base64 is 4 characters per 3 bytes. Logged on both paths below because
  // it is the one number that separates "the model couldn't read it" from
  // "the recorder handed us a file with nothing in it" — a silent emulator
  // mic and a genuinely unreadable recording look identical from up here.
  const bytes = Math.floor((base64.length * 3) / 4);

  try {
    const text = await extractTextFromMedia({
      label: `extract-text:${kind}`,
      mimeType,
      base64,
      instruction: `${INSTRUCTIONS[kind]}${languageNote}${focusNote(userInstruction)}`,
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
    return Response.json({ text: "", error: "extraction_failed" } satisfies ExtractTextResponseBody, { status: 502 });
  }
}
