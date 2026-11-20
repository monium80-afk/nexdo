import { router, type Href } from "expo-router";
import { useEffect } from "react";
import { AppState } from "react-native";

import { translate } from "@/lib/i18n";
import {
  getNotificationPermission,
  listenForAlarms,
  listenForNotificationTaps,
  reconcileNotifications,
  requestNotificationPermission,
  type AlarmInfo,
  type NotificationTap,
} from "@/lib/notifications";
import { isPurchasesEnabled, resyncTrialReminder } from "@/lib/purchases";
import { planNotifications, type ReminderPreferences } from "@/lib/reminders";
import { reminderPreferences, useSettingsStore } from "@/store/useSettingsStore";
import { useSubscriptionStore } from "@/store/useSubscriptionStore";
import { useTaskStore, whenAccountRead } from "@/store/useTaskStore";
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
        `${task.id}|${task.deadline?.date ?? ""}|${task.deadline?.time ?? ""}|${task.title}|${task.importance}|${task.estimatedMinutes}|${JSON.stringify(task.reminders ?? null)}|${task.pinnedAt ?? ""}|${task.recurrence?.rule ? JSON.stringify(task.recurrence.rule) : ""}`,
    )
    .join("\n");
}

/**
 * Whether a task set to "Alarm" may ring as one: alarms are Pro. Until
 * RevenueCat has answered (customerInfo still null) the alarms stay as they
 * are, rather than being swapped for notifications at every launch.
 */
export function alarmsAllowedNow(): boolean {
  const { customerInfo, pro } = useSubscriptionStore.getState();
  return !isPurchasesEnabled || pro !== null || customerInfo === null;
}

/** The reminder settings with the plan's say on alarms — what every screen and the planner read. */
export function currentReminderPreferences(): ReminderPreferences {
  return reminderPreferences(useSettingsStore.getState(), alarmsAllowedNow());
}

function preferencesKey(state: ReturnType<typeof useSettingsStore.getState>): string {
  // The language too: a notification's text is written when it's scheduled.
  return JSON.stringify({ ...reminderPreferences(state), language: state.language });
}

/** The alarm screen, over whatever is showing. */
function openAlarm(alarm: AlarmInfo) {
  // (Cast until the typed-routes file is regenerated with app/alarm.tsx in it.)
  router.push({
    pathname: "/alarm",
    params: { taskId: alarm.taskId ?? "", title: alarm.title, startsAt: alarm.startsAt ? String(alarm.startsAt) : "" },
  } as unknown as Href);
}

/** The plan for the tasks as they are right now, applied to the phone. */
function reconcileNow() {
  const tasks = useTaskStore.getState().tasks;
  const plan = planNotifications(tasks, currentReminderPreferences(), new Date(), translate());
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
  // An alarm opens its own screen (Stop / Snooze), whatever else it carries.
  if (tap.alarm && tap.action === "open") {
    openAlarm(tap.alarm);
    return;
  }
  if (!tap.taskId) {
    if (tap.url) router.push(tap.url as Href);
    return;
  }
  // "Mark as done" is checked against the account's latest list, not just
  // the phone's saved copy: on a cold start the read from Supabase may still
  // be on its way, with another device's change to the task in it. If that
  // read doesn't work, the task is opened instead.
  const upToDate = tap.action === "complete" ? await whenAccountRead() : false;
  const task = useTaskStore.getState().tasks.find((candidate) => candidate.id === tap.taskId);
  if (!task) {
    router.push("/(tabs)/tasks");
    return;
  }
  const deadline = task.deadline ? `${task.deadline.date}|${task.deadline.time ?? ""}` : undefined;
  if (upToDate && task.status === "pending" && (!tap.deadline || tap.deadline === deadline)) {
    useTaskStore.getState().completeTask(task.id);
    return;
  }
  router.push({ pathname: "/task/[id]", params: { id: task.id } });
}

/**
 * Keeps the phone's scheduled reminders in step with the task list and the
 * reminder settings, and handles what the user does with them.
 *
 * Mounted in the root layout next to useAuthSync, and only acts once an
 * account's tasks are being synced: the reminders are about this account's
 * tasks. Signing out clears them (see useTaskStore.handleSignOut), along
 * with the task list itself.
 */
export function useNotifications() {
  const userId = useTaskStore((state) => state.syncUserId);
  const taskKey = useTaskStore((state) => reminderKey(state.tasks));
  const settingsKey = useSettingsStore(preferencesKey);
  const hasDeadlineTask = useTaskStore((state) => state.tasks.some((task) => task.status === "pending" && !!task.deadline));
  // Anything that would send a notification: the main switch, and one of its parts.
  const remindersOn = useSettingsStore(
    (state) =>
      state.notificationsEnabled &&
      (state.deadlineRemindersEnabled || state.dailyNudgeEnabled || state.overdueAlertsEnabled),
  );
  // Pro starting or ending turns alarms on or back into notifications.
  const alarmsAllowed = useSubscriptionStore(
    (state) => !isPurchasesEnabled || state.pro !== null || state.customerInfo === null,
  );

  // Any change to what a notification shows or when it fires: plan again.
  useEffect(() => {
    if (!userId) return;
    const timer = setTimeout(() => void reconcileNow(), SYNC_DELAY_MS);
    return () => clearTimeout(timer);
  }, [userId, taskKey, settingsKey, alarmsAllowed]);

  // Back in the app (and at every midnight, while it's open): times that have
  // passed drop out, the daily planning notes move on a day, and anything
  // another device changed while the app was away is reflected.
  useEffect(() => {
    if (!userId) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void reconcileNow();
      // Notifications may have been allowed in the phone's settings meanwhile.
      resyncTrialReminder();
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
      if (await requestNotificationPermission()) {
        void reconcileNow();
        resyncTrialReminder();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, remindersOn, hasDeadlineTask]);

  useEffect(() => {
    if (!userId) return;
    const stopTaps = listenForNotificationTaps((tap) => {
      handleTap(tap).catch((error) => console.warn("[useNotifications] couldn't handle a notification", error));
    });
    // An alarm going off while Nexdo is open: straight to the alarm screen.
    const stopAlarms = listenForAlarms(openAlarm);
    return () => {
      stopTaps();
      stopAlarms();
    };
  }, [userId]);
}
