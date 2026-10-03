export type ChatRole = "ai" | "user";

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

export type ChatMessage = {
  id: string;
  role: ChatRole;
  /** Only what the user typed — never a file name standing in for an attachment. */
  text: string;
  createdAt: string; // ISO 8601
  /** One message can carry several files (e.g. two photos of the same board). */
  attachments?: ChatAttachment[];
  /** Messages saved before multi-attachment support — read via messageAttachments(). */
  attachment?: ChatAttachment;
  relatedTaskId?: string; // links a bubble to the task it acted on
};
