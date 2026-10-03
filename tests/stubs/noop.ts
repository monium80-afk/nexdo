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

export const posthog = {
  capture() {},
  screen() {},
  identify() {},
  reset() {},
  captureException() {},
};

export async function extractAttachmentsText() {
  return { extracted: [], failedCount: 0 };
}
export async function extractAttachmentText() {
  return "";
}
