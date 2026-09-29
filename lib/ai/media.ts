import * as FileSystem from "expo-file-system/legacy";

import type { ExtractTextRequestBody, ExtractTextResponseBody } from "@/app/api/extract-text+api";
import type { ExtractedAttachment } from "@/lib/ai/attachmentMessage";
import { apiPost } from "@/lib/api";
import { isImageAttachment } from "@/lib/chatAttachments";
import type { ChatAttachment } from "@/types/chat";
import type { AppLanguage } from "@/types/settings";

// The legacy string-based API (readAsStringAsync) is far simpler than the
// new File/Directory class API for this one-shot "give me base64" need —
// still officially supported, see expo-file-system's "/legacy" export.
//
// It refuses files outside the folders it considers the app's own, though,
// and on Expo Go that includes the document picker's copies (they land in
// Expo Go's shared cache, not this project's): "Location '…/cache/
// DocumentPicker/….jpg' isn't readable". fetch() reads the same file://
// uri through React Native's blob support without that check — it's how
// uploadAttachment() already reads every attachment — so it's the fallback.
export async function readFileAsBase64(uri: string): Promise<string> {
  try {
    return await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  } catch (error) {
    if (__DEV__) console.log("[media] file system read refused, reading through fetch instead", error);
    return readFileAsBase64ViaFetch(uri);
  }
}

async function readFileAsBase64ViaFetch(uri: string): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(`Couldn't read ${uri}`));
    reader.readAsDataURL(blob);
  });
  // "data:<mime>;base64,<data>" — only the part after the comma is the file.
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

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

/** One attachment through the vision/audio model — the text it holds, or "" if unreadable. */
export async function extractAttachmentText(
  attachment: ChatAttachment,
  options: { language?: AppLanguage; userInstruction?: string } = {},
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
    language: options.language,
    userInstruction: options.userInstruction?.trim() || undefined,
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
 */
export async function extractAttachmentsText(
  attachments: ChatAttachment[],
  options: { language?: AppLanguage; userInstruction?: string } = {},
): Promise<{ extracted: ExtractedAttachment[]; failedCount: number }> {
  const settled = await Promise.allSettled(
    attachments.map(async (attachment) => ({
      kind: extractionKind(attachment),
      text: await extractAttachmentText(attachment, options),
    })),
  );
  const extracted = settled.flatMap((outcome) => {
    if (outcome.status === "rejected") {
      console.warn("[media] attachment extraction failed", outcome.reason);
      return [];
    }
    return outcome.value.text ? [outcome.value] : [];
  });
  const failedCount = settled.filter((outcome) => outcome.status === "rejected").length;
  return { extracted, failedCount };
}
