import { router, type Href } from "expo-router";
import { useEffect } from "react";
import { AppState } from "react-native";

import { translate } from "@/lib/i18n";
import {
  getNotificationPermission,
  listenForNotificationTaps,
  reconcileNotifications,
  requestNotificationPermission,
  type NotificationTap,
} from "@/lib/notifications";
import { planNotifications } from "@/lib/reminders";
import { reminderPreferences, useSettingsStore } from "@/store/useSettingsStore";
import { useTaskStore } from "@/store/useTaskStore";
import type { Task } from "@/types/task";

// Edits tend to arrive in bursts (the AI adding several tasks at once, the
// Supabase fetch landing on launch), so scheduling waits for a quiet moment.
const SYNC_DELAY_MS = 1000;

/** Everything a scheduled notification depends on, as one string — so the plan is only redone when one of them changes. */
function reminderKey(tasks: Task[]): string {
  return tasks
    .filter((task) => task.status === "pending")
    .map(
      (task) =>
        `${task.id}|${task.deadline?.date ?? ""}|${task.deadline?.time ?? ""}|${task.title}|${task.importance}|${task.reminders?.muted ? 1 : 0}|${task.pinnedAt ?? ""}`,
    )
    .join("\n");
}

function preferencesKey(state: ReturnType<typeof useSettingsStore.getState>): string {
  // The language too: a notification's text is written when it's scheduled.
  return JSON.stringify({ ...reminderPreferences(state), language: state.language });
}

/** The plan for the tasks as they are right now, applied to the phone. */
function reconcileNow() {
  const tasks = useTaskStore.getState().tasks;
  const plan = planNotifications(tasks, reminderPreferences(useSettingsStore.getState()), new Date(), translate());
  const open = new Set(tasks.filter((task) => task.status === "pending").map((task) => task.id));
  return reconcileNotifications(plan, open);
}

/** Resolves once the task list has been read back from the phone, so a notification from a cold start finds its task. */
function whenTasksLoaded(): Promise<void> {
  if (useTaskStore.persist.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = useTaskStore.persist.onFinishHydration(() => {
      unsubscribe();
      resolve();
    });
  });
}

/**
 * A notification the user acted on, checked against the task as it is now:
 * it may have been finished, deleted or moved since the notification was
 * scheduled. "Mark as done" only completes a task that is still open and
 * still due when the notification said — otherwise the task is opened so the
 * user sees how it stands, rather than something being done on stale information.
 */
async function handleTap(tap: NotificationTap) {
  await whenTasksLoaded();
  if (!tap.taskId) {
    if (tap.url) router.push(tap.url as Href);
    return;
  }
  const task = useTaskStore.getState().tasks.find((candidate) => candidate.id === tap.taskId);
  if (!task) {
    router.push("/(tabs)/tasks");
    return;
  }
  const deadline = task.deadline ? `${task.deadline.date}|${task.deadline.time ?? ""}` : undefined;
  if (tap.action === "complete" && task.status === "pending" && (!tap.deadline || tap.deadline === deadline)) {
    useTaskStore.getState().completeTask(task.id);
    return;
  }
  router.push({ pathname: "/task/[id]", params: { id: task.id } });
}

/**
 * Keeps the phone's scheduled reminders in step with the task list and the
 * reminder settings, and handles what the user does with them.
 *
 * Mounted in the signed-in tabs layout, next to useAuthSync: the reminders
 * are about this account's tasks. Signing out clears them (see
 * useTaskStore.handleSignOut), along with the task list itself.
 */
export function useNotifications() {
  const userId = useTaskStore((state) => state.syncUserId);
  const taskKey = useTaskStore((state) => reminderKey(state.tasks));
  const settingsKey = useSettingsStore(preferencesKey);
  const hasDeadlineTask = useTaskStore((state) => state.tasks.some((task) => task.status === "pending" && !!task.deadline));
  const remindersOn = useSettingsStore((state) => state.deadlineRemindersEnabled);

  // Any change to what a notification shows or when it fires: plan again.
  useEffect(() => {
    if (!userId) return;
    const timer = setTimeout(() => void reconcileNow(), SYNC_DELAY_MS);
    return () => clearTimeout(timer);
  }, [userId, taskKey, settingsKey]);

  // Back in the app (and at every midnight, while it's open): times that have
  // passed drop out, the daily planning notes move on a day, and anything
  // another device changed while the app was away is reflected.
  useEffect(() => {
    if (!userId) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void reconcileNow();
    });
    let midnight: ReturnType<typeof setTimeout>;
    // Each run sets up the next, so an app left open for days keeps moving on.
    const scheduleMidnight = () => {
      const now = new Date();
      const untilMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5).getTime() - now.getTime();
      midnight = setTimeout(() => {
        void reconcileNow();
        scheduleMidnight();
      }, untilMidnight);
    };
    scheduleMidnight();
    return () => {
      subscription.remove();
      clearTimeout(midnight);
    };
  }, [userId]);

  // Reminders are on by default, but the phone decides whether Nexdo may
  // show them. The question comes once, when there's first a deadline worth
  // reminding about — not at launch, when it would make no sense yet.
  useEffect(() => {
    if (!userId || !remindersOn || !hasDeadlineTask) return;
    if (useSettingsStore.getState().notificationPromptShown) return;
    let cancelled = false;
    (async () => {
      if ((await getNotificationPermission()) !== "undetermined" || cancelled) return;
      useSettingsStore.getState().setNotificationPromptShown(true);
      if (await requestNotificationPermission()) void reconcileNow();
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, remindersOn, hasDeadlineTask]);

  useEffect(() => {
    if (!userId) return;
    return listenForNotificationTaps((tap) => {
      handleTap(tap).catch((error) => console.warn("[useNotifications] couldn't handle a notification", error));
    });
  }, [userId]);
}
