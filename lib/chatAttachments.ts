import type { ChatAttachment } from "@/types/chat";

/** A camera photo, or an image file picked with the paperclip. */
export function isImageAttachment(attachment: ChatAttachment): boolean {
  return attachment.kind === "photo" || Boolean(attachment.mimeType?.startsWith("image/"));
}
