import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";

import type { ContextAttachment } from "@/store/useReassessStore";

// Picking a photo or a document to give Nexdo as context for a task. Only
// what /api/extract-text reads (its ALLOWED_MIME_TYPES): images, PDFs and
// plain text. The photo library needs no permission prompt on Android 13+
// (the system photo picker) or iOS (PHPicker); there's no camera — Nexdo
// doesn't ask for it (app.json), and a photo just taken is in the library.

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const DOCUMENT_TYPES = ["application/pdf", "text/plain", "text/csv", "text/markdown"];

/**
 * The biggest file sent. The route takes a 9 MB body, and base64 makes a file
 * a third bigger on the way — so about 6.5 MB, with room to spare.
 */
export const MAX_CONTEXT_FILE_BYTES = 6 * 1024 * 1024;

export type PickOutcome =
  | { status: "picked"; file: ContextAttachment }
  | { status: "cancelled" }
  /** Bigger than MAX_CONTEXT_FILE_BYTES. */
  | { status: "tooBig" }
  /** A kind of file Nexdo can't read (a Word document, a spreadsheet…). */
  | { status: "unsupported" };

function checked(file: ContextAttachment): PickOutcome {
  if (file.size !== undefined && file.size > MAX_CONTEXT_FILE_BYTES) return { status: "tooBig" };
  const type = file.mimeType?.toLowerCase() === "image/jpg" ? "image/jpeg" : file.mimeType?.toLowerCase();
  if (type && !IMAGE_TYPES.includes(type) && !DOCUMENT_TYPES.includes(type)) return { status: "unsupported" };
  return { status: "picked", file };
}

/** A photo from the library. */
export async function pickContextPhoto(): Promise<PickOutcome> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return { status: "cancelled" };
  return checked({
    kind: "photo",
    label: asset.fileName ?? "photo",
    uri: asset.uri,
    mimeType: asset.mimeType ?? "image/jpeg",
    name: asset.fileName ?? undefined,
    size: asset.fileSize,
    width: asset.width,
    height: asset.height,
  });
}

/** A PDF or text file — or an image saved as a file, which is read as a photo. */
export async function pickContextDocument(): Promise<PickOutcome> {
  const result = await DocumentPicker.getDocumentAsync({
    type: [...DOCUMENT_TYPES, ...IMAGE_TYPES],
    copyToCacheDirectory: true,
    multiple: false,
  });
  const asset = result.canceled ? undefined : result.assets?.[0];
  if (!asset) return { status: "cancelled" };
  const isImage = Boolean(asset.mimeType?.toLowerCase().startsWith("image/"));
  return checked({
    kind: isImage ? "photo" : "document",
    label: asset.name,
    uri: asset.uri,
    mimeType: asset.mimeType ?? undefined,
    name: asset.name,
    size: asset.size ?? undefined,
  });
}
