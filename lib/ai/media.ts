import type { ExtractTextRequestBody, ExtractTextResponseBody } from "@/app/api/extract-text+api";
import type { ExtractedAttachment } from "@/lib/ai/attachmentMessage";
import { apiPost } from "@/lib/api";
import { isImageAttachment } from "@/lib/chatAttachments";
import { readFileAsBase64 } from "@/lib/localFile";
import { PlanLimitError } from "@/lib/plan";
import type { ChatAttachment } from "@/types/chat";
import type { AppLanguage } from "@/types/settings";

const DEFAULT_MIME_TYPE: Record<ChatAttachment["kind"], string> = {
  photo: "image/jpeg",
  voice: "audio/aac",
  document: "application/pdf",
};

// What a file actually is, whichever button attached it. The paperclip calls
// everything it picks a "document", but the extract-text route only reads
// images as "photo" and audio as "voice" — a picked JPEG sent as a document
// is turned away with a 400 before the model ever sees it.
function extractionKind(attachment: ChatAttachment): ChatAttachment["kind"] {
  if (isImageAttachment(attachment)) return "photo";
  if (attachment.mimeType?.startsWith("audio/")) return "voice";
  return attachment.kind;
}

export function resolveMimeType(attachment: ChatAttachment): string {
  const mimeType = attachment.mimeType?.toLowerCase() ?? DEFAULT_MIME_TYPE[extractionKind(attachment)];
  // Some pickers report the non-standard "image/jpg", which no allowlist has.
  return mimeType === "image/jpg" ? "image/jpeg" : mimeType;
}

/**
 * One attachment through the vision/audio model — the text it holds, or "" if
 * unreadable. Throws PlanLimitError when the month's photos and documents, or
 * voice minutes, are used up.
 */
export async function extractAttachmentText(
  attachment: ChatAttachment,
  options: {
    language?: AppLanguage;
    userInstruction?: string;
    /** Read as context for this task (Task Details, a session), not for to-dos to add. */
    forTask?: { title: string };
  } = {},
): Promise<string> {
  const base64 = await readFileAsBase64(attachment.uri);
  // A recorder that captured nothing still hands back a valid file, just a
  // tiny one — so the size is worth seeing next to the result. A few seconds
  // of the HIGH_QUALITY preset is tens of KB; a few hundred bytes is a
  // container header and no audio.
  if (__DEV__) console.log(`[media] ${attachment.kind} ${Math.floor((base64.length * 3) / 4)}B`);
  const request: ExtractTextRequestBody = {
    mimeType: resolveMimeType(attachment),
    base64,
    kind: extractionKind(attachment),
    // A voice note is counted by its length (the month's voice minutes).
    durationSeconds: attachment.durationSeconds,
    language: options.language,
    userInstruction: options.userInstruction?.trim() || undefined,
    purpose: options.forTask ? "context" : undefined,
    taskTitle: options.forTask?.title,
  };
  const { text } = await apiPost<ExtractTextResponseBody>("/api/extract-text", request);
  return text.trim();
}

/**
 * Every attachment on one message, read in parallel. The user's own words go
 * along as the instruction so the model knows what to look for ("pull out the
 * assignments and their deadlines") instead of narrating the whole picture.
 * Files that fail or come back empty are dropped — one unreadable photo
 * shouldn't lose the other one — but failures are counted, because "the
 * photo has no text in it" and "the photo never reached the model" need
 * different replies: only the first is fixed by taking a clearer shot.
 *
 * A file turned away because the month's allowance is used up is neither:
 * `limit` carries that refusal, so the caller can say so rather than answer
 * as if the file had simply been left out.
 */
export async function extractAttachmentsText(
  attachments: ChatAttachment[],
  options: { language?: AppLanguage; userInstruction?: string } = {},
): Promise<{ extracted: ExtractedAttachment[]; failedCount: number; limit?: PlanLimitError }> {
  const settled = await Promise.allSettled(
    attachments.map(async (attachment) => ({
      kind: extractionKind(attachment),
      text: await extractAttachmentText(attachment, options),
    })),
  );
  let limit: PlanLimitError | undefined;
  let failedCount = 0;
  const extracted = settled.flatMap((outcome) => {
    if (outcome.status === "rejected") {
      if (outcome.reason instanceof PlanLimitError) {
        limit = outcome.reason;
      } else {
        console.warn("[media] attachment extraction failed", outcome.reason);
        failedCount += 1;
      }
      return [];
    }
    return outcome.value.text ? [outcome.value] : [];
  });
  return { extracted, failedCount, limit };
}
