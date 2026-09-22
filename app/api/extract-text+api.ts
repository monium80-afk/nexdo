import { extractTextFromMedia } from "@/lib/ai/gemini";
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

export type ExtractTextResponseBody = { text: string };

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
};

// The accompanying message steers what to look for, but must not become the
// answer: the model reads the file, it doesn't act on the request. Acting on
// it here would produce text that the layer above then reads as a new task.
function focusNote(userInstruction: string | undefined): string {
  const instruction = userInstruction?.trim();
  if (!instruction) return "";
  return `\n\nAlongside this file the user wrote: "${instruction}". Make sure everything it refers to is included in what you write out, and leave out clutter that clearly has nothing to do with it. Still only write what the file actually contains — do not answer the user, do not carry out the request, and do not add anything of your own.`;
}

export async function POST(request: Request) {
  const body = (await request.json()) as ExtractTextRequestBody;
  const languageNote = body.kind === "voice" || !body.language ? "" : (DESCRIPTION_LANGUAGE[body.language] ?? "");

  try {
    const text = await extractTextFromMedia({
      mimeType: body.mimeType,
      base64: body.base64,
      instruction: `${INSTRUCTIONS[body.kind] ?? INSTRUCTIONS.document}${languageNote}${focusNote(body.userInstruction)}`,
    });
    return Response.json({ text } satisfies ExtractTextResponseBody);
  } catch (error) {
    console.error("[api/extract-text]", error);
    return Response.json({ text: "" } satisfies ExtractTextResponseBody, { status: 200 });
  }
}
