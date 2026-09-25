import * as Notifications from "expo-notifications";
import { router, type Href } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";

import { syncOverdueAlerts } from "@/lib/notifications";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTaskStore } from "@/store/useTaskStore";
import type { Task } from "@/types/task";

// Edits tend to arrive in bursts (the AI adding several tasks at once, the
// Supabase fetch landing on launch), so the sync waits for a quiet moment.
const SYNC_DELAY_MS = 1000;

/** Everything an overdue alert depends on, as one string: which open tasks have a deadline, when, and what they're called. */
function overdueAlertKey(tasks: Task[]): string {
  return tasks
    .filter((task) => task.status === "pending" && task.dueDate)
    .map((task) => `${task.id}|${task.dueDate}|${task.title}`)
    .join("\n");
}

/**
 * Keeps the phone's scheduled notifications in step with the task list, and
 * opens the right screen when one is tapped.
 *
 * Mounted in the signed-in tabs layout, next to useAuthSync: the alerts are
 * about this account's tasks. Signing out clears them (see
 * useTaskStore.handleSignOut), since the list left behind is only sample data.
 */
export function useNotifications() {
  const userId = useTaskStore((state) => state.syncUserId);
  const overdueAlertsEnabled = useSettingsStore((state) => state.overdueAlertsEnabled);
  const language = useSettingsStore((state) => state.language);
  // A string rather than the task array, so the sync only re-runs when
  // something an alert shows or depends on changes, not on every edit.
  const alertKey = useTaskStore((state) => overdueAlertKey(state.tasks));

  useEffect(() => {
    if (!userId) return;
    const timer = setTimeout(() => {
      syncOverdueAlerts(overdueAlertsEnabled ? useTaskStore.getState().tasks : []);
    }, SYNC_DELAY_MS);
    return () => clearTimeout(timer);
    // language: the alerts' text is written when they're scheduled.
  }, [userId, overdueAlertsEnabled, language, alertKey]);

  useEffect(() => {
    if (!userId || Platform.OS === "web") return;

    const openFromNotification = (response: Notifications.NotificationResponse) => {
      const url = response.notification.request.content.data?.url;
      if (typeof url === "string") router.push(url as Href);
      // Handled — otherwise the next run of this effect would open it again.
      Notifications.clearLastNotificationResponse();
    };

    // A tap that launched the app happened before this listener existed.
    const launchResponse = Notifications.getLastNotificationResponse();
    if (launchResponse) openFromNotification(launchResponse);

    const subscription = Notifications.addNotificationResponseReceivedListener(openFromNotification);
    return () => subscription.remove();
  }, [userId]);
}
