import type { ChatAttachment, ChatMessage } from "@/types/chat";

/**
 * Every file on a message, including ones saved back when a message could
 * only carry one — persisted chats (AsyncStorage and Supabase) still hold
 * that older shape, so nothing reads `message.attachments` directly.
 */
export function messageAttachments(message: ChatMessage): ChatAttachment[] {
  if (message.attachments?.length) return message.attachments;
  return message.attachment ? [message.attachment] : [];
}

/** A camera photo, or an image file picked with the paperclip. */
export function isImageAttachment(attachment: ChatAttachment): boolean {
  return attachment.kind === "photo" || Boolean(attachment.mimeType?.startsWith("image/"));
}
