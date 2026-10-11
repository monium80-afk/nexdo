/**
 * A file the AI reads — onboarding's spoken brain dump, and a photo or
 * document given as context for a task (lib/contextFile.ts). Named after the
 * AI chat it was first built for, which has since been removed.
 */
export type ChatAttachment = {
  kind: "photo" | "voice" | "document";
  /**
   * Internal only — used for upload file names, accessibility labels and the
   * voice-note chip. An image is never labelled in the UI: it shows as itself.
   */
  label: string;
  uri: string;
  mimeType?: string;
  name?: string;
  size?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
};
