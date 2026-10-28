import * as FileSystem from "expo-file-system/legacy";

// Reading a file on this phone (a camera photo, a voice note, a picked
// document) — for uploading it, and for the AI to read.
//
// expo-file-system comes first. It refuses files outside the folders it
// considers the app's own, though, and on Expo Go that includes the document
// picker's copies (they land in Expo Go's shared cache, not this project's):
// "Location '…/cache/DocumentPicker/….jpg' isn't readable". fetch() reads
// those through React Native's blob support, so it's the fallback.
//
// fetch() can't be the only way, though: on Expo Go the camera's and the
// recorder's files sit under a %-encoded folder (…/ExperienceData/%2540…),
// and fetch() answered those with a 14-byte "File not found" body and no
// error — which is what got uploaded in place of every camera photo and voice
// note until 2026-09-30. So a fetch that doesn't come back OK is an error.

/** The file as base64 (the legacy string API is the simplest for this one-shot need). */
export async function readFileAsBase64(uri: string): Promise<string> {
  try {
    return await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  } catch (error) {
    if (__DEV__) console.log("[localFile] file system read refused, reading through fetch instead", error);
    return readFileAsBase64ViaFetch(uri);
  }
}

/** The file's bytes, for uploading. */
export async function readFileBytes(uri: string): Promise<ArrayBuffer> {
  let base64: string;
  try {
    base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  } catch (error) {
    if (__DEV__) console.log("[localFile] file system read refused, reading through fetch instead", error);
    return (await fetchLocal(uri)).arrayBuffer();
  }
  return base64ToArrayBuffer(base64);
}

async function fetchLocal(uri: string): Promise<Response> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error(`Couldn't read ${uri} (status ${response.status})`);
  return response;
}

async function readFileAsBase64ViaFetch(uri: string): Promise<string> {
  const blob = await (await fetchLocal(uri)).blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(`Couldn't read ${uri}`));
    reader.readAsDataURL(blob);
  });
  // "data:<mime>;base64,<data>" — only the part after the comma is the file.
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
