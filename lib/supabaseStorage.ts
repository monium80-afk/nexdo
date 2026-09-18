import { supabase } from "@/lib/supabase";

const BUCKET = "chat-attachments";
const SIGNED_URL_TTL_SECONDS = 60 * 60;

// Uploads a local file:// uri (from expo-image-picker/expo-document-picker/
// expo-audio) into the private chat-attachments bucket, under a per-user
// folder so storage RLS can scope access. Returns the storage path to store
// on the ChatAttachment instead of the local uri.
export async function uploadAttachment(localUri: string, userId: string, fileName: string, mimeType?: string): Promise<string> {
  const response = await fetch(localUri);
  const bytes = await response.arrayBuffer();
  const path = `${userId}/${Date.now()}-${fileName}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: mimeType,
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
