import { isRunningInExpoGo } from "expo";
import type { NotificationResponse } from "expo-notifications";
import { Platform } from "react-native";

import { colors } from "@/constants/theme";
import { translate } from "@/lib/i18n";
import {
  diffNotifications,
  LEGACY_NOTIFICATION_ID_PREFIX,
  NOTIFICATION_ID_PREFIX,
  type PlannedNotification,
  type ReminderChannel,
} from "@/lib/reminders";

// Local notifications only: the phone schedules each one itself, so it
// arrives on time even when Nexdo is closed — no server, no push tokens. What
// to schedule is decided by lib/reminders.ts; this file only makes the phone
// match that plan. The web build has no scheduler, so everything here is a
// no-op there. Expo Go on Android is a no-op too: since SDK 53, merely
// importing expo-notifications there throws (it wires up push tokens on
// load), so the module is only loaded where it works. Test reminders on
// Android in a development build.
const isSupported = Platform.OS !== "web" && !(Platform.OS === "android" && isRunningInExpoGo());

// Only ever read after an isSupported check, so it's never actually null then.
const Notifications: typeof import("expo-notifications") = isSupported
  ? // An import statement would always load it — only require() can skip it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("expo-notifications")
  : (null as never);

/** The "Mark as done" button a task reminder carries. */
const TASK_CATEGORY_ID = "nexdo-task";
export const COMPLETE_ACTION_ID = "complete";

const CHANNEL_IDS: Record<ReminderChannel, string> = {
  reminders: "reminders",
  overdue: "overdue",
  planning: "planning",
};

export type NotificationPermission = "granted" | "denied" | "undetermined" | "unsupported";

/** Call once at startup, before any notification can arrive. */
export function configureNotifications() {
  if (!isSupported) return;
  // Without a handler, a notification that fires while Nexdo is open is
  // dropped instead of shown.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

// Android 8+ files every notification under a channel the user can mute in
// the phone's settings, where these names are shown. Setting one again just
// renames it — that's how they follow a language change. The action button's
// label is set the same way.
async function ensureChannelsAndActions() {
  const t = translate();
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(CHANNEL_IDS.reminders, {
      name: t.notifications.remindersChannel,
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: colors.orange[500],
    });
    await Notifications.setNotificationChannelAsync(CHANNEL_IDS.overdue, {
      name: t.notifications.overdueChannel,
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: colors.orange[500],
    });
    await Notifications.setNotificationChannelAsync(CHANNEL_IDS.planning, {
      name: t.notifications.planningChannel,
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  // Opens the app to do it: the completion goes through the task store like
  // any other, is saved to the account, and is checked against the task as
  // it is now (see hooks/useNotifications.ts) — not handled blind in the background.
  await Notifications.setNotificationCategoryAsync(TASK_CATEGORY_ID, [
    { identifier: COMPLETE_ACTION_ID, buttonTitle: t.notifications.completeAction, options: { opensAppToForeground: true } },
  ]);
}

export async function getNotificationPermission(): Promise<NotificationPermission> {
  if (!isSupported) return "unsupported";
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return "granted";
    return current.canAskAgain ? "undetermined" : "denied";
  } catch {
    return "unsupported";
  }
}

/** Shows the system prompt if the user hasn't answered it yet. Resolves true when Nexdo may notify. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!isSupported) return false;
  try {
    // Android 13+ only shows the prompt once the app has a channel.
    await ensureChannelsAndActions();
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    // Denied before: the phone won't ask again, only its settings can change it.
    if (!current.canAskAgain) return false;
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  } catch (error) {
    console.warn("[notifications] couldn't request permission", error);
    return false;
  }
}

function isOurs(identifier: string): boolean {
  return identifier.startsWith(NOTIFICATION_ID_PREFIX) || identifier.startsWith(LEGACY_NOTIFICATION_ID_PREFIX);
}

async function runReconcile(desired: PlannedNotification[], openTaskIds: Set<string>) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const { cancel, schedule } = diffNotifications(
    desired,
    scheduled.map((request) => ({
      id: request.identifier,
      signature: typeof request.content.data?.signature === "string" ? request.content.data.signature : undefined,
    })),
  );
  for (const id of cancel) await Notifications.cancelScheduledNotificationAsync(id);

  // Take back reminders already on screen about tasks that no longer need
  // them (finished, deleted, archived, or no longer due).
  const presented = await Notifications.getPresentedNotificationsAsync();
  for (const notification of presented) {
    const id = notification.request.identifier;
    const taskId = notification.request.content.data?.taskId;
    if (!isOurs(id)) continue;
    if (id.startsWith(LEGACY_NOTIFICATION_ID_PREFIX) || (typeof taskId === "string" && !openTaskIds.has(taskId))) {
      await Notifications.dismissNotificationAsync(id);
    }
  }

  if (schedule.length === 0) return;
  const { granted } = await Notifications.getPermissionsAsync();
  if (!granted) return;
  await ensureChannelsAndActions();
  for (const entry of schedule) {
    await Notifications.scheduleNotificationAsync({
      identifier: entry.id,
      content: {
        title: entry.title,
        body: entry.body,
        sound: "default",
        data: entry.data,
        categoryIdentifier: entry.completable ? TASK_CATEGORY_ID : undefined,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: entry.fireAt,
        channelId: CHANNEL_IDS[entry.channel],
      },
    });
  }
}

// Runs one at a time, in order: two overlapping runs could interleave their
// cancels and schedules and leave a reminder behind that no longer applies.
let reconcileQueue: Promise<void> = Promise.resolve();

/**
 * Makes the phone's scheduled notifications exactly `desired` (from
 * lib/reminders.ts planNotifications). Pass an empty list to clear them all.
 * `openTaskIds`: tasks still open, whose reminders on screen may stay.
 */
export function reconcileNotifications(desired: PlannedNotification[], openTaskIds: Set<string> = new Set()): Promise<void> {
  if (!isSupported) return Promise.resolve();
  reconcileQueue = reconcileQueue
    .then(() => runReconcile(desired, openTaskIds))
    .catch((error) => console.warn("[notifications] couldn't update scheduled reminders", error));
  return reconcileQueue;
}

/** Clears every reminder this app scheduled — signing out. */
export function clearAllNotifications(): Promise<void> {
  return reconcileNotifications([]);
}

/**
 * The one notification that isn't about a task: the heads-up before a free
 * trial turns into a paid plan (lib/trialReminder.ts). Outside the "nexdo-"
 * prefix, so the task reconciler above leaves it alone.
 */
const TRIAL_REMINDER_ID = "trial-end";

/**
 * Schedules the trial reminder for `fireAt`, replacing any earlier one — or
 * just cancels it, given null. Resolves false when the phone isn't left as
 * asked (no permission to notify, or it failed), so the caller can try again.
 */
export async function setTrialReminder(reminder: { fireAt: number; title: string; body: string } | null): Promise<boolean> {
  if (!isSupported) return true;
  try {
    await Notifications.cancelScheduledNotificationAsync(TRIAL_REMINDER_ID);
    if (!reminder) return true;
    const { granted } = await Notifications.getPermissionsAsync();
    if (!granted) return false;
    await ensureChannelsAndActions();
    await Notifications.scheduleNotificationAsync({
      identifier: TRIAL_REMINDER_ID,
      content: {
        title: reminder.title,
        body: reminder.body,
        sound: "default",
        // Where the subscription can be managed or cancelled.
        data: { url: "/(tabs)/settings" },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: reminder.fireAt,
        channelId: CHANNEL_IDS.reminders,
      },
    });
    return true;
  } catch (error) {
    console.warn("[notifications] couldn't update the trial reminder", error);
    return false;
  }
}

export type NotificationTap = {
  /** "complete" when the user pressed "Mark as done", otherwise a plain tap. */
  action: "open" | "complete";
  url?: string;
  taskId?: string;
  /** The deadline the notification was scheduled for ("YYYY-MM-DD|HH:MM"). */
  deadline?: string;
};

/**
 * Calls `handle` for each notification the user acts on, starting with the
 * one that launched Nexdo if there was one. Returns a function that stops listening.
 */
export function listenForNotificationTaps(handle: (tap: NotificationTap) => void): () => void {
  if (!isSupported) return () => {};

  const onResponse = (response: NotificationResponse) => {
    const data = response.notification.request.content.data ?? {};
    handle({
      action: response.actionIdentifier === COMPLETE_ACTION_ID ? "complete" : "open",
      url: typeof data.url === "string" ? data.url : undefined,
      taskId: typeof data.taskId === "string" ? data.taskId : undefined,
      deadline: typeof data.deadline === "string" ? data.deadline : undefined,
    });
    // The notification that was acted on goes from the tray.
    Notifications.dismissNotificationAsync(response.notification.request.identifier).catch(() => {});
    // Handled — otherwise the next listener would act on it again.
    Notifications.clearLastNotificationResponse();
  };

  // A tap that launched the app happened before this listener existed.
  const launchResponse = Notifications.getLastNotificationResponse();
  if (launchResponse) onResponse(launchResponse);

  const subscription = Notifications.addNotificationResponseReceivedListener(onResponse);
  return () => subscription.remove();
}
