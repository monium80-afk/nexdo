/**
 * Where the Support section in Settings points.
 *
 * TODO: these are placeholders — swap in the real feedback address and the
 * live legal pages before shipping. Everything lives here so it's a one-file
 * change, not a hunt through the screens.
 */
export const SUPPORT_LINKS = {
  feedbackEmail: "support@nexdo.app",
  privacyPolicy: "https://nexdo.app/privacy",
  termsOfService: "https://nexdo.app/terms",
} as const;

/** Subject line on the feedback email, so support can triage at a glance. */
export const FEEDBACK_SUBJECT = "Nexdo feedback";
