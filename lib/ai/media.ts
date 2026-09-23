import * as FileSystem from "expo-file-system/legacy";

import type { ExtractTextRequestBody, ExtractTextResponseBody } from "@/app/api/extract-text+api";
import type { ExtractedAttachment } from "@/lib/ai/attachmentMessage";
import { apiPost } from "@/lib/api";
import type { ChatAttachment } from "@/types/chat";
import type { AppLanguage } from "@/types/settings";

// The legacy string-based API (readAsStringAsync) is far simpler than the
// new File/Directory class API for this one-shot "give me base64" need —
// still officially supported, see expo-file-system's "/legacy" export.
export async function readFileAsBase64(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

const DEFAULT_MIME_TYPE: Record<ChatAttachment["kind"], string> = {
  photo: "image/jpeg",
  voice: "audio/aac",
  document: "application/pdf",
};

export function resolveMimeType(attachment: ChatAttachment): string {
  return attachment.mimeType ?? DEFAULT_MIME_TYPE[attachment.kind];
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
    kind: attachment.kind,
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
 * shouldn't lose the other one.
 */
export async function extractAttachmentsText(
  attachments: ChatAttachment[],
  options: { language?: AppLanguage; userInstruction?: string } = {},
): Promise<ExtractedAttachment[]> {
  const settled = await Promise.allSettled(
    attachments.map(async (attachment) => ({
      kind: attachment.kind,
      text: await extractAttachmentText(attachment, options),
    })),
  );
  return settled.flatMap((outcome) => {
    if (outcome.status === "rejected") {
      console.warn("[media] attachment extraction failed", outcome.reason);
      return [];
    }
    return outcome.value.text ? [outcome.value] : [];
  });
}
