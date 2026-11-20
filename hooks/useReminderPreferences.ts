import { useMemo } from "react";

import { isPurchasesEnabled } from "@/lib/purchases";
import type { ReminderPreferences } from "@/lib/reminders";
import { reminderPreferences, useSettingsStore } from "@/store/useSettingsStore";
import { useSubscriptionStore } from "@/store/useSubscriptionStore";

/**
 * The reminder settings as the planner sees them (lib/reminders.ts), kept
 * current: Settings → Notifications, plus whether alarms ring as alarms on
 * this plan (Pro). What the edit card, the task cards and Task Details read.
 */
export function useReminderPreferences(): ReminderPreferences {
  // As a string, so a screen re-renders when a reminder setting changes but not on every store write.
  const key = useSettingsStore((state) => JSON.stringify(reminderPreferences(state)));
  const alarmsAllowed = useSubscriptionStore((state) => !isPurchasesEnabled || state.pro !== null || state.customerInfo === null);
  return useMemo(() => ({ ...(JSON.parse(key) as ReminderPreferences), alarmsAllowed }), [key, alarmsAllowed]);
}

/** Whether the Alarm choice is locked behind Pro for this account. */
export function useAlarmLocked(): boolean {
  return useSubscriptionStore((state) => isPurchasesEnabled && state.pro === null);
}
