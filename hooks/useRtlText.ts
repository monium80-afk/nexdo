import type { TextStyle } from "react-native";

import { isRtlLanguage } from "@/lib/i18n";
import { useSettingsStore } from "@/store/useSettingsStore";

// One shared object, so every text using it keeps the same style identity.
const RTL_TEXT: TextStyle = { textAlign: "right", writingDirection: "rtl" };

/**
 * Style for text that owns its own line — headings, body copy, list rows and
 * text inputs — so Arabic starts from the right. Returns undefined in
 * left-to-right languages, which leaves the text exactly as it was.
 *
 * Text sitting beside an icon inside a flex row doesn't need this: the row
 * already places it, and Arabic words shape right-to-left within their own
 * line either way.
 */
export function useRtlText(): TextStyle | undefined {
  const language = useSettingsStore((state) => state.language);
  return isRtlLanguage(language) ? RTL_TEXT : undefined;
}
