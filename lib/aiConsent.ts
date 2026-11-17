import { useSettingsStore } from "@/store/useSettingsStore";

// Permission to send the user's own content — what they type, say or
// photograph for an AI feature — to Google's Gemini AI. Apple's guideline
// 5.1.2(i) asks for it explicitly before personal data goes to a third-party
// AI, and Quebec's Law 25 asks for consent too. Nothing reaches an AI route
// without it (lib/api.ts); the question itself is lib/aiConsentPrompt.ts.
//
// No native imports here, so the stores that check for AiConsentError still
// run under the tests.

/** Thrown by apiPost for an AI route the user hasn't allowed. Not an outage: callers stay quiet. */
export class AiConsentError extends Error {
  constructor() {
    super("The user hasn't allowed Nexdo to use AI");
    this.name = "AiConsentError";
  }
}

export function hasAiConsent(): boolean {
  return useSettingsStore.getState().aiConsent;
}
