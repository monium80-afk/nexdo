import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { AppLanguage, ThemePreference } from "@/types/settings";

// "language" drives the interface copy (see lib/i18n.ts) and the language the
// AI replies in. "theme" is saved but not applied yet.
type SettingsStore = {
  theme: ThemePreference;
  language: AppLanguage;
  // Auto mode: the AI chat adds and updates tasks straight away instead of
  // showing a confirmation card first.
  aiAutoMode: boolean;
  // Notification preferences. The daily nudge is saved but nothing schedules
  // it yet — that lands in a later lesson.
  dailyNudgeEnabled: boolean;
  /** 24-hour "HH:MM" — the time of day the daily nudge should arrive. */
  dailyNudgeTime: string;
  /** An alert the moment a task's deadline passes — scheduled by hooks/useNotifications.ts. */
  overdueAlertsEnabled: boolean;
  setTheme: (theme: ThemePreference) => void;
  setLanguage: (language: AppLanguage) => void;
  setAiAutoMode: (aiAutoMode: boolean) => void;
  setDailyNudgeEnabled: (dailyNudgeEnabled: boolean) => void;
  setDailyNudgeTime: (dailyNudgeTime: string) => void;
  setOverdueAlertsEnabled: (overdueAlertsEnabled: boolean) => void;
};

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      theme: "system",
      language: "en",
      aiAutoMode: false,
      dailyNudgeEnabled: false,
      dailyNudgeTime: "09:00",
      overdueAlertsEnabled: false,
      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
      setAiAutoMode: (aiAutoMode) => set({ aiAutoMode }),
      setDailyNudgeEnabled: (dailyNudgeEnabled) => set({ dailyNudgeEnabled }),
      setDailyNudgeTime: (dailyNudgeTime) => set({ dailyNudgeTime }),
      setOverdueAlertsEnabled: (overdueAlertsEnabled) => set({ overdueAlertsEnabled }),
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
        dailyNudgeEnabled: state.dailyNudgeEnabled,
        dailyNudgeTime: state.dailyNudgeTime,
        overdueAlertsEnabled: state.overdueAlertsEnabled,
      }),
    },
  ),
);
