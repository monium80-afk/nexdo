import Constants from "expo-constants";
import { Platform } from "react-native";

import { readFileBytes } from "@/lib/localFile";
import { supabase } from "@/lib/supabase";

// Settings → Send feedback. Rows go to the `feedback`
// table (supabase/schema.sql), which the app can add to but never read back.
// Who sent it isn't part of the request: the database takes the user id from
// the Clerk token itself, so there's nothing here a client could fake.

export type FeedbackType = "suggestion" | "bug" | "general" | "other";

/** The table's own limit, so the field stops where the database would refuse. */
export const FEEDBACK_MESSAGE_MAX = 5_000;

const SCREENSHOT_BUCKET = "feedback-screenshots";
// The bucket's file_size_limit and allowed_mime_types, checked here first so
// the user hears why before anything is uploaded.
const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;
const SCREENSHOT_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export type FeedbackScreenshot = { uri: string; mimeType: string };

/** What the image picker returned, if the bucket will take it. */
export function toFeedbackScreenshot(asset: { uri: string; mimeType?: string; fileSize?: number }): FeedbackScreenshot | null {
  const mimeType = (asset.mimeType ?? "image/jpeg").toLowerCase();
  if (!SCREENSHOT_EXTENSIONS[mimeType]) return null;
  if (asset.fileSize && asset.fileSize > SCREENSHOT_MAX_BYTES) return null;
  return { uri: asset.uri, mimeType };
}

async function uploadScreenshot(userId: string, screenshot: FeedbackScreenshot): Promise<string> {
  const bytes = await readFileBytes(screenshot.uri);
  if (bytes.byteLength === 0) throw new Error("Screenshot is empty");
  if (bytes.byteLength > SCREENSHOT_MAX_BYTES) throw new Error("Screenshot is too large");

  // The first segment is what storage RLS checks against the token's user id.
  const path = `${userId}/${Date.now()}-screenshot.${SCREENSHOT_EXTENSIONS[screenshot.mimeType]}`;
  const { error } = await supabase.storage.from(SCREENSHOT_BUCKET).upload(path, bytes, {
    contentType: screenshot.mimeType,
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export type SendFeedbackResult = "sent" | "rate_limited" | "screenshot_failed" | "failed";

export async function sendFeedback({
  userId,
  type,
  message,
  screenshot,
}: {
  userId: string;
  type: FeedbackType;
  message: string;
  screenshot: FeedbackScreenshot | null;
}): Promise<SendFeedbackResult> {
  let screenshotPath: string | null = null;
  if (screenshot) {
    try {
      screenshotPath = await uploadScreenshot(userId, screenshot);
    } catch (error) {
      console.warn("[feedback] screenshot upload failed", error);
      return "screenshot_failed";
    }
  }

  const { error } = await supabase.from("feedback").insert({
    source: "mobile_app",
    feedback_type: type,
    message: message.trim(),
    screenshot_path: screenshotPath,
    app_version: Constants.expoConfig?.version ?? null,
    platform: Platform.OS === "ios" || Platform.OS === "android" || Platform.OS === "web" ? Platform.OS : null,
  });
  if (!error) return "sent";

  console.warn("[feedback] couldn't save feedback", error);
  // Nothing points at the screenshot now; best effort, a retry uploads anew.
  if (screenshotPath) void supabase.storage.from(SCREENSHOT_BUCKET).remove([screenshotPath]);
  // The database's rate-limit trigger answers 429 with this code.
  return error.code === "rate_limited" ? "rate_limited" : "failed";
}
