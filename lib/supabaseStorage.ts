import { readFileBytes } from "@/lib/localFile";
import { supabase } from "@/lib/supabase";

const BUCKET = "chat-attachments";
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/** Anything larger is past what the extract-text route will read anyway (see its MAX_BODY_BYTES). */
const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024;

// An allowlist, matching what the pickers produce and what the AI route
// accepts. Keeping the two in step means a file can't be stored here and then
// be unreadable at extraction time.
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "audio/aac",
  "audio/mp4",
  "audio/m4a",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/webm",
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/markdown",
];

// The name comes off the user's device, so it can hold anything — path
// separators, "..", control characters, or a few thousand characters of
// padding. It is interpolated straight into the storage key below, and that
// key's first segment is what storage RLS matches the user id against, so it
// gets reduced to the harmless characters a filename actually needs.
function safeFileName(fileName: string): string {
  const cleaned = fileName
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    // Leading dots would make a hidden file, and ".." a traversal attempt.
    .replace(/^\.+/, "")
    .slice(0, 100);
  return cleaned || "attachment";
}

// Uploads a local file:// uri (from expo-image-picker/expo-document-picker/
// expo-audio) into the private chat-attachments bucket, under a per-user
// folder so storage RLS can scope access. Returns the storage path to store
// on the ChatAttachment instead of the local uri.
//
// The bucket itself refuses anything over MAX_ATTACHMENT_BYTES or not in
// ALLOWED_MIME_TYPES (supabase/schema.sql), so the type is always sent:
// without one, storage would label the file text/plain.
export async function uploadAttachment(localUri: string, userId: string, fileName: string, mimeType: string): Promise<string> {
  if (!ALLOWED_MIME_TYPES.includes(mimeType.toLowerCase())) {
    throw new Error(`Unsupported file type: ${mimeType}`);
  }

  // Read the way the AI reads it (see lib/localFile.ts): a bare fetch() once
  // uploaded a "File not found" message in place of every camera photo.
  const bytes = await readFileBytes(localUri);
  if (bytes.byteLength === 0) throw new Error("File is empty");
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error(`File is too large (max ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB)`);
  }

  const path = `${userId}/${Date.now()}-${safeFileName(fileName)}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: mimeType.toLowerCase(),
    upsert: false,
  });
  if (error) throw error;

  return path;
}

/** True for a path uploadAttachment() returned — a local uri always starts with a scheme like file://. */
export function isStoragePath(uri: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(uri);
}

export async function getAttachmentSignedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}
