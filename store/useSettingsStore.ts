import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { DEFAULT_REMINDER_PREFERENCES, type ReminderPreferences } from "@/lib/reminders";
import type { AppLanguage, ThemePreference } from "@/types/settings";

// "language" drives the interface copy (see lib/i18n.ts) and the language the
// AI replies in. "theme" is saved but not applied yet.
type SettingsStore = {
  theme: ThemePreference;
  language: AppLanguage;
  // Auto mode: the AI chat adds and updates tasks straight away instead of
  // showing a confirmation card first.
  aiAutoMode: boolean;
  /** The tab bar's middle button opens Live voice (a microphone) instead of the Add Task form (a plus). */
  voiceAddButton: boolean;
  // Notification preferences — lib/reminders.ts turns them (and the task
  // list) into what the phone schedules; hooks/useNotifications.ts applies it.
  /** The daily planning note — separate from any deadline. */
  dailyNudgeEnabled: boolean;
  /** 24-hour "HH:MM" — the time of day the daily planning note arrives. */
  dailyNudgeTime: string;
  /** An alert the moment a task's exact deadline passes. */
  overdueAlertsEnabled: boolean;
  /** A reminder on the day a task is due — on by default. */
  deadlineRemindersEnabled: boolean;
  /** 24-hour "HH:MM" — when that on-the-day reminder arrives. 9:00 by default. */
  dayReminderTime: string;
  /** Minutes before an exact deadline to remind as well. */
  reminderOffsets: number[];
  /** One more reminder the day before, for high-priority tasks. */
  importantExtraReminder: boolean;
  /** Whether Nexdo has already asked for notification permission on its own (it asks once, when a first deadline needs a reminder). */
  notificationPromptShown: boolean;
  /** Whether the first-run tour (components/AppTour.tsx) has been finished or skipped on this phone. */
  tourSeen: boolean;
  setTheme: (theme: ThemePreference) => void;
  setLanguage: (language: AppLanguage) => void;
  setAiAutoMode: (aiAutoMode: boolean) => void;
  setVoiceAddButton: (voiceAddButton: boolean) => void;
  setDailyNudgeEnabled: (dailyNudgeEnabled: boolean) => void;
  setDailyNudgeTime: (dailyNudgeTime: string) => void;
  setOverdueAlertsEnabled: (overdueAlertsEnabled: boolean) => void;
  setDeadlineRemindersEnabled: (deadlineRemindersEnabled: boolean) => void;
  setDayReminderTime: (dayReminderTime: string) => void;
  toggleReminderOffset: (minutes: number) => void;
  setImportantExtraReminder: (importantExtraReminder: boolean) => void;
  setNotificationPromptShown: (notificationPromptShown: boolean) => void;
  setTourSeen: (tourSeen: boolean) => void;
};

/** The settings the reminder engine reads, in its own shape. */
export function reminderPreferences(state: SettingsStore): ReminderPreferences {
  return {
    deadlineReminders: state.deadlineRemindersEnabled,
    dayReminderTime: state.dayReminderTime,
    beforeOffsets: state.reminderOffsets,
    importantDayBefore: state.importantExtraReminder,
    overdueAlerts: state.overdueAlertsEnabled,
    dailyPlanning: state.dailyNudgeEnabled,
    dailyPlanningTime: state.dailyNudgeTime,
  };
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      theme: "system",
      language: "en",
      aiAutoMode: false,
      voiceAddButton: false,
      dailyNudgeEnabled: false,
      dailyNudgeTime: "09:00",
      overdueAlertsEnabled: false,
      deadlineRemindersEnabled: DEFAULT_REMINDER_PREFERENCES.deadlineReminders,
      dayReminderTime: DEFAULT_REMINDER_PREFERENCES.dayReminderTime,
      reminderOffsets: DEFAULT_REMINDER_PREFERENCES.beforeOffsets,
      importantExtraReminder: DEFAULT_REMINDER_PREFERENCES.importantDayBefore,
      notificationPromptShown: false,
      tourSeen: false,
      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
      setAiAutoMode: (aiAutoMode) => set({ aiAutoMode }),
      setVoiceAddButton: (voiceAddButton) => set({ voiceAddButton }),
      setDailyNudgeEnabled: (dailyNudgeEnabled) => set({ dailyNudgeEnabled }),
      setDailyNudgeTime: (dailyNudgeTime) => set({ dailyNudgeTime }),
      setOverdueAlertsEnabled: (overdueAlertsEnabled) => set({ overdueAlertsEnabled }),
      setDeadlineRemindersEnabled: (deadlineRemindersEnabled) => set({ deadlineRemindersEnabled }),
      setDayReminderTime: (dayReminderTime) => set({ dayReminderTime }),
      toggleReminderOffset: (minutes) =>
        set((state) => ({
          reminderOffsets: state.reminderOffsets.includes(minutes)
            ? state.reminderOffsets.filter((value) => value !== minutes)
            : [...state.reminderOffsets, minutes].sort((a, b) => a - b),
        })),
      setImportantExtraReminder: (importantExtraReminder) => set({ importantExtraReminder }),
      setNotificationPromptShown: (notificationPromptShown) => set({ notificationPromptShown }),
      setTourSeen: (tourSeen) => set({ tourSeen }),
    }),
    {
      name: "nexdo-settings",
      storage: createJSONStorage(() => AsyncStorage),
      // Listing the keys also drops the retired "planningStyle" value that
      // older installs still have saved, the next time this store writes.
      partialize: (state) => ({
        theme: state.theme,
        language: state.language,
        aiAutoMode: state.aiAutoMode,
        voiceAddButton: state.voiceAddButton,
        dailyNudgeEnabled: state.dailyNudgeEnabled,
        dailyNudgeTime: state.dailyNudgeTime,
        overdueAlertsEnabled: state.overdueAlertsEnabled,
        deadlineRemindersEnabled: state.deadlineRemindersEnabled,
        dayReminderTime: state.dayReminderTime,
        reminderOffsets: state.reminderOffsets,
        importantExtraReminder: state.importantExtraReminder,
        notificationPromptShown: state.notificationPromptShown,
        tourSeen: state.tourSeen,
      }),
    },
  ),
);
