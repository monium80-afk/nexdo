// Native-only services the stores call but tests don't care about:
// notifications, analytics, reading attachments.
export async function reconcileNotifications() {}
export async function clearAllNotifications() {}
export function configureNotifications() {}
export async function requestNotificationPermission() {
  return false;
}
export async function getNotificationPermission() {
  return "unsupported";
}
export function listenForNotificationTaps() {
  return () => {};
}

/** Every analytics event the code captured, oldest first — a test empties it. */
export const captured: { event: string; properties?: Record<string, unknown> }[] = [];

export const posthog = {
  capture(event: string, properties?: Record<string, unknown>) {
    captured.push({ event, properties });
  },
  screen() {},
  identify() {},
  reset() {},
  captureException() {},
};

export async function extractAttachmentsText() {
  return { extracted: [], failedCount: 0 };
}
type FileReader = (attachment: unknown, options: unknown) => string | Promise<string>;

let readFile: FileReader = () => "";

/** What the next files read as — a test sets it; "" (nothing readable) otherwise. */
export function setFileReader(next: FileReader) {
  readFile = next;
}

export async function extractAttachmentText(attachment: unknown, options: unknown) {
  return readFile(attachment, options);
}
