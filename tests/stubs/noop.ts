// Native-only services the stores call but tests don't care about:
// notifications, analytics, reading attachments.
export async function syncOverdueAlerts() {}
export function configureNotifications() {}
export async function requestNotificationPermission() {
  return false;
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
