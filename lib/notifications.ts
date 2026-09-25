import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { colors } from "@/constants/theme";
import { translate } from "@/lib/i18n";
import type { Task } from "@/types/task";

// Local notifications only: the phone schedules each alert itself, so it
// arrives at the deadline even when Nexdo is closed — no server, no push
// tokens. The web build has no scheduler, so everything here is a no-op there.
const isSupported = Platform.OS !== "web";

const OVERDUE_CHANNEL_ID = "overdue";

// Every overdue alert's id starts with this, so a sync can find and cancel its
// own alerts without touching other kinds of notification added later.
const OVERDUE_ID_PREFIX = "overdue-";

// iOS keeps at most 64 pending notifications per app and quietly drops the
// rest. The soonest deadlines win; later ones get their turn on a later sync
// (every launch and every task edit runs one).
const MAX_OVERDUE_ALERTS = 50;

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
// the phone's settings, where this name is shown. Setting it again just
// renames it — that's how it follows a language change.
async function ensureOverdueChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(OVERDUE_CHANNEL_ID, {
    name: translate().notifications.overdueChannel,
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: colors.orange[500],
  });
}

/** Shows the system prompt if the user hasn't answered it yet. Resolves true when Nexdo may notify. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!isSupported) return false;
  try {
    // Android 13+ only shows the prompt once the app has a channel.
    await ensureOverdueChannel();
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

function overdueAlertId(taskId: string): string {
  return `${OVERDUE_ID_PREFIX}${taskId}`;
}

/** When an open task's deadline passes, in ms — null for finished tasks and ones without a deadline. */
function openDeadline(task: Task): number | null {
  if (task.status !== "pending" || !task.dueDate) return null;
  const time = Date.parse(task.dueDate);
  return Number.isNaN(time) ? null : time;
}

async function runOverdueSync(tasks: Task[]) {
  const now = Date.now();
  const upcoming: { task: Task; dueAt: number }[] = [];
  const overdueIds = new Set<string>();
  for (const task of tasks) {
    const dueAt = openDeadline(task);
    if (dueAt === null) continue;
    if (dueAt > now) upcoming.push({ task, dueAt });
    else overdueIds.add(overdueAlertId(task.id));
  }

  // Start from a clean slate: cancel every alert the last sync scheduled...
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const request of scheduled) {
    if (request.identifier.startsWith(OVERDUE_ID_PREFIX)) {
      await Notifications.cancelScheduledNotificationAsync(request.identifier);
    }
  }

  // ...take back alerts already on screen for tasks that aren't overdue any
  // more (finished, deleted or given a new deadline)...
  const presented = await Notifications.getPresentedNotificationsAsync();
  for (const notification of presented) {
    const id = notification.request.identifier;
    if (id.startsWith(OVERDUE_ID_PREFIX) && !overdueIds.has(id)) {
      await Notifications.dismissNotificationAsync(id);
    }
  }

  // ...then schedule one alert per open task, for the moment its deadline passes.
  if (upcoming.length === 0) return;
  const { granted } = await Notifications.getPermissionsAsync();
  if (!granted) return;
  await ensureOverdueChannel();

  const t = translate();
  upcoming.sort((a, b) => a.dueAt - b.dueAt);
  for (const { task, dueAt } of upcoming.slice(0, MAX_OVERDUE_ALERTS)) {
    await Notifications.scheduleNotificationAsync({
      identifier: overdueAlertId(task.id),
      content: {
        title: t.notifications.overdueTitle(task.title),
        body: t.notifications.overdueBody,
        sound: "default",
        // The screen a tap opens — see hooks/useNotifications.ts.
        data: { url: `/task/${task.id}` },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: dueAt,
        channelId: OVERDUE_CHANNEL_ID,
      },
    });
  }
}

// Syncs run one at a time, in order. Two overlapping runs could interleave
// their cancels and schedules and leave an alert behind for a task that no
// longer needs one.
let syncQueue: Promise<void> = Promise.resolve();

/**
 * Makes the phone's scheduled overdue alerts match `tasks`: one per open task
 * whose deadline is still ahead, and none for anything else. Pass an empty
 * list to clear them all.
 */
export function syncOverdueAlerts(tasks: Task[]): Promise<void> {
  if (!isSupported) return Promise.resolve();
  syncQueue = syncQueue
    .then(() => runOverdueSync(tasks))
    .catch((error) => console.warn("[notifications] couldn't sync overdue alerts", error));
  return syncQueue;
}
