import AsyncStorage from "@react-native-async-storage/async-storage";
import { I18nManager, NativeModules, Platform } from "react-native";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { DEFAULT_REMINDER_PREFERENCES, type ReminderPreferences } from "@/lib/reminders";
import { FOCUS_SOUND_CHOICES, type AppLanguage, type FocusSound, type ThemePreference } from "@/types/settings";

// "language" drives the interface copy (see lib/i18n.ts) and the language the
// AI replies in. "theme" is saved but not applied yet.
type SettingsStore = {
  theme: ThemePreference;
  language: AppLanguage;
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
  /** How long before a deadline with a time to remind: [] = at the start, or [minutes]. */
  reminderOffsets: number[];
  /** One more reminder the day before, for high-priority tasks. */
  importantExtraReminder: boolean;
  /** Whether Nexdo has already asked for notification permission on its own (it asks once, when a first deadline needs a reminder). */
  notificationPromptShown: boolean;
  /** Whether the first-run tour (components/AppTour.tsx) has been finished or skipped on this phone. */
  tourSeen: boolean;
  /** The gem's evolution stage last celebrated on Today (lib/gemLevel.ts), so each new star is announced once. */
  gemStageSeen: number;
  /**
   * Whether the user allowed Nexdo to send their own content to Google's
   * Gemini AI (lib/aiConsent.ts). Off until they say yes; "Not now" leaves it
   * off, so the question comes back the next time an AI feature is used.
   */
  aiConsent: boolean;
  /** The sound a focus session plays while its clock runs (Pro; lib/focusSound.ts). Off by default. */
  focusSound: FocusSound;
  setTheme: (theme: ThemePreference) => void;
  setLanguage: (language: AppLanguage) => void;
  setDailyNudgeEnabled: (dailyNudgeEnabled: boolean) => void;
  setDailyNudgeTime: (dailyNudgeTime: string) => void;
  setOverdueAlertsEnabled: (overdueAlertsEnabled: boolean) => void;
  setDeadlineRemindersEnabled: (deadlineRemindersEnabled: boolean) => void;
  setDayReminderTime: (dayReminderTime: string) => void;
  /** How long before a task with a time to remind (0 = at the start). One choice. */
  setReminderLead: (minutes: number) => void;
  setImportantExtraReminder: (importantExtraReminder: boolean) => void;
  setNotificationPromptShown: (notificationPromptShown: boolean) => void;
  setTourSeen: (tourSeen: boolean) => void;
  setGemStageSeen: (gemStageSeen: number) => void;
  setAiConsent: (aiConsent: boolean) => void;
  setFocusSound: (focusSound: FocusSound) => void;
};

/** The settings the reminder engine reads, in its own shape. */
export function reminderPreferences(state: SettingsStore): ReminderPreferences {
  return {
    deadlineReminders: state.deadlineRemindersEnabled,
    dayReminderTime: state.dayReminderTime,
    beforeOffsets: state.reminderOffsets,
    importantDayBefore: state.importantExtraReminder,
    overdueAlerts: state.overdueAlertsEnabled,
    // The morning nudge (back in Settings 2026-11-12, merged with the
    // date-only morning ping).
    dailyPlanning: state.dailyNudgeEnabled,
    dailyPlanningTime: state.dailyNudgeTime,
  };
}

const APP_LANGUAGES: AppLanguage[] = ["en", "fr", "es", "ar", "de", "zh", "hi", "pt", "bn", "ru"];

/** The app language for a locale ("fr-CA", "fr_CA", "ar"), or null when Nexdo doesn't have it. */
export function languageFromLocale(locale: string | undefined | null): AppLanguage | null {
  const code = typeof locale === "string" ? locale.slice(0, 2).toLowerCase() : "";
  return APP_LANGUAGES.find((language) => language === code) ?? null;
}

/**
 * The phone's languages, most preferred first, as its own settings list
 * them: Android's current locale, iOS's preferred languages. Read through
 * React Native's built-in modules, so no extra library.
 */
function phoneLocales(): string[] {
  try {
    if (Platform.OS === "android") {
      const identifier = I18nManager.getConstants?.().localeIdentifier;
      return identifier ? [identifier] : [];
    }
    if (Platform.OS === "ios") {
      const settings = NativeModules.SettingsManager?.settings as { AppleLanguages?: string[]; AppleLocale?: string } | undefined;
      return [...(settings?.AppleLanguages ?? []), ...(settings?.AppleLocale ? [settings.AppleLocale] : [])];
    }
  } catch {
    // Not available here: the engine's own locale below.
  }
  return [];
}

/**
 * The phone's own language, if Nexdo has it — English otherwise. Only the
 * first launch uses it: once saved, the language stays what it was set to.
 * The phone's settings are asked first, then the JavaScript engine's own
 * locale (Intl), which follows the phone too.
 */
export function deviceLanguage(): AppLanguage {
  for (const locale of phoneLocales()) {
    const language = languageFromLocale(locale);
    if (language) return language;
  }
  try {
    return languageFromLocale(Intl.DateTimeFormat().resolvedOptions().locale) ?? "en";
  } catch {
    return "en";
  }
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      theme: "system",
      language: deviceLanguage(),
      dailyNudgeEnabled: false,
      dailyNudgeTime: "09:00",
      overdueAlertsEnabled: false,
      deadlineRemindersEnabled: DEFAULT_REMINDER_PREFERENCES.deadlineReminders,
      dayReminderTime: DEFAULT_REMINDER_PREFERENCES.dayReminderTime,
      reminderOffsets: DEFAULT_REMINDER_PREFERENCES.beforeOffsets,
      importantExtraReminder: DEFAULT_REMINDER_PREFERENCES.importantDayBefore,
      notificationPromptShown: false,
      tourSeen: false,
      gemStageSeen: 0,
      aiConsent: false,
      focusSound: "off",
      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
      setDailyNudgeEnabled: (dailyNudgeEnabled) => set({ dailyNudgeEnabled }),
      setDailyNudgeTime: (dailyNudgeTime) => set({ dailyNudgeTime }),
      setOverdueAlertsEnabled: (overdueAlertsEnabled) => set({ overdueAlertsEnabled }),
      setDeadlineRemindersEnabled: (deadlineRemindersEnabled) => set({ deadlineRemindersEnabled }),
      setDayReminderTime: (dayReminderTime) => set({ dayReminderTime }),
      setReminderLead: (minutes) =>
        set(() => ({
          reminderOffsets: minutes > 0 ? [minutes] : [],
        })),
      setImportantExtraReminder: (importantExtraReminder) => set({ importantExtraReminder }),
      setNotificationPromptShown: (notificationPromptShown) => set({ notificationPromptShown }),
      setTourSeen: (tourSeen) => set({ tourSeen }),
      setGemStageSeen: (gemStageSeen) => set({ gemStageSeen }),
      setAiConsent: (aiConsent) => set({ aiConsent }),
      setFocusSound: (focusSound) => set({ focusSound }),
    }),
    {
      name: "nexdo-settings",
      storage: createJSONStorage(() => AsyncStorage),
      // A focus sound the app no longer has (brown noise 2026-11-09, café 2026-11-10) is "off".
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<SettingsStore>;
        const focusSound =
          saved.focusSound && (FOCUS_SOUND_CHOICES as readonly string[]).includes(saved.focusSound)
            ? saved.focusSound
            : current.focusSound;
        return { ...current, ...saved, focusSound };
      },
      // Listing the keys also drops retired values older installs still have
      // saved ("planningStyle", "aiAutoMode" / "voiceAddButton" from before
      // the AI chat was removed, "soundsEnabled" from before Settings →
      // Sounds was removed), the next time this store writes.
      partialize: (state) => ({
        theme: state.theme,
        language: state.language,
        dailyNudgeEnabled: state.dailyNudgeEnabled,
        dailyNudgeTime: state.dailyNudgeTime,
        overdueAlertsEnabled: state.overdueAlertsEnabled,
        deadlineRemindersEnabled: state.deadlineRemindersEnabled,
        dayReminderTime: state.dayReminderTime,
        reminderOffsets: state.reminderOffsets,
        importantExtraReminder: state.importantExtraReminder,
        notificationPromptShown: state.notificationPromptShown,
        tourSeen: state.tourSeen,
        gemStageSeen: state.gemStageSeen,
        aiConsent: state.aiConsent,
        focusSound: state.focusSound,
      }),
    },
  ),
);
