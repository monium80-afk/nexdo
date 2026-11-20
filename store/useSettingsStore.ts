import AsyncStorage from "@react-native-async-storage/async-storage";
import { I18nManager, NativeModules, Platform } from "react-native";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { DEFAULT_REMINDER_PREFERENCES, type ReminderPreferences } from "@/lib/reminders";
import { FOCUS_SOUND_CHOICES, type AppLanguage, type AppTheme, type FocusSound } from "@/types/settings";

// "language" drives the interface copy (see lib/i18n.ts) and the language the
// AI replies in. "theme" is Settings → Dark mode (2026-11-17): "system"
// follows the phone, applied in app/_layout.tsx (an older, never-applied
// "theme" was removed 2026-11-13). "analyticsEnabled" turns PostHog off and on
// (Settings → Preferences, applied in app/_layout.tsx).
type SettingsStore = {
  language: AppLanguage;
  theme: AppTheme;
  analyticsEnabled: boolean;
  // Notification preferences (reworked 2026-11-18) — lib/reminders.ts turns
  // them (and the task list) into what the phone schedules;
  // hooks/useNotifications.ts applies it. None of these switches ever touches
  // a task's own reminder choice: off only pauses, on brings it all back.
  /** The main switch (Settings → Notifications): off, Nexdo sends nothing. */
  notificationsEnabled: boolean;
  /** The morning summary: the day's tasks and routines in one notification. */
  dailyNudgeEnabled: boolean;
  /** 24-hour "HH:MM" — when the morning summary arrives. */
  dailyNudgeTime: string;
  /** An alert when a timed task should have been finished. */
  overdueAlertsEnabled: boolean;
  /** Tasks with a time get a reminder of their own — on by default. */
  deadlineRemindersEnabled: boolean;
  /** The default "how long before" for tasks with a time: [] = at the start, or [minutes]. */
  reminderOffsets: number[];
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
  setAnalyticsEnabled: (analyticsEnabled: boolean) => void;
  setLanguage: (language: AppLanguage) => void;
  setTheme: (theme: AppTheme) => void;
  setDailyNudgeEnabled: (dailyNudgeEnabled: boolean) => void;
  setDailyNudgeTime: (dailyNudgeTime: string) => void;
  setOverdueAlertsEnabled: (overdueAlertsEnabled: boolean) => void;
  setDeadlineRemindersEnabled: (deadlineRemindersEnabled: boolean) => void;
  setNotificationsEnabled: (notificationsEnabled: boolean) => void;
  /** The default "how long before" for a task with a time (0 = at the start). */
  setReminderLead: (minutes: number) => void;
  setNotificationPromptShown: (notificationPromptShown: boolean) => void;
  setTourSeen: (tourSeen: boolean) => void;
  setGemStageSeen: (gemStageSeen: number) => void;
  setAiConsent: (aiConsent: boolean) => void;
  setFocusSound: (focusSound: FocusSound) => void;
};

/** The default lead for tasks with a time, in minutes (0 = at the start). */
export function defaultReminderLead(state: Pick<SettingsStore, "reminderOffsets">): number {
  return state.reminderOffsets.find((value) => Number.isFinite(value) && value > 0) ?? 0;
}

/**
 * The settings the reminder engine reads, in its own shape. `alarmsAllowed`
 * comes from the plan (alarms are Pro) — see hooks/useNotifications.ts.
 */
export function reminderPreferences(state: SettingsStore, alarmsAllowed = true): ReminderPreferences {
  return {
    enabled: state.notificationsEnabled,
    morningSummary: state.dailyNudgeEnabled,
    morningSummaryTime: state.dailyNudgeTime,
    timedReminders: state.deadlineRemindersEnabled,
    defaultLead: defaultReminderLead(state),
    overdueAlerts: state.overdueAlertsEnabled,
    alarmsAllowed,
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

/**
 * Settings saved before the 2026-11-18 rework (no main switch yet): a task
 * with only a date used to get its own 9:00 ping, which is now the morning
 * summary's job — so whoever had those pings gets the summary instead, at
 * that same time, and nothing they had goes quiet. Leaves newer settings alone.
 */
function migrateNotifications(saved: Partial<SettingsStore> & { dayReminderTime?: string }): Partial<SettingsStore> {
  if (saved.notificationsEnabled !== undefined || Object.keys(saved).length === 0) return {};
  const hadDayPings = saved.deadlineRemindersEnabled !== false;
  if (saved.dailyNudgeEnabled || !hadDayPings) return { notificationsEnabled: true };
  return { notificationsEnabled: true, dailyNudgeEnabled: true, dailyNudgeTime: saved.dayReminderTime ?? DEFAULT_REMINDER_PREFERENCES.morningSummaryTime };
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      analyticsEnabled: true,
      language: deviceLanguage(),
      theme: "system",
      notificationsEnabled: DEFAULT_REMINDER_PREFERENCES.enabled,
      dailyNudgeEnabled: DEFAULT_REMINDER_PREFERENCES.morningSummary,
      dailyNudgeTime: DEFAULT_REMINDER_PREFERENCES.morningSummaryTime,
      overdueAlertsEnabled: DEFAULT_REMINDER_PREFERENCES.overdueAlerts,
      deadlineRemindersEnabled: DEFAULT_REMINDER_PREFERENCES.timedReminders,
      reminderOffsets: [],
      notificationPromptShown: false,
      tourSeen: false,
      gemStageSeen: 0,
      aiConsent: false,
      focusSound: "off",
      setAnalyticsEnabled: (analyticsEnabled) => set({ analyticsEnabled }),
      setLanguage: (language) => set({ language }),
      setTheme: (theme) => set({ theme }),
      setDailyNudgeEnabled: (dailyNudgeEnabled) => set({ dailyNudgeEnabled }),
      setDailyNudgeTime: (dailyNudgeTime) => set({ dailyNudgeTime }),
      setOverdueAlertsEnabled: (overdueAlertsEnabled) => set({ overdueAlertsEnabled }),
      setDeadlineRemindersEnabled: (deadlineRemindersEnabled) => set({ deadlineRemindersEnabled }),
      setNotificationsEnabled: (notificationsEnabled) => set({ notificationsEnabled }),
      setReminderLead: (minutes) =>
        set(() => ({
          reminderOffsets: minutes > 0 ? [minutes] : [],
        })),
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
        // Only the three appearance choices; anything else (an older build's
        // value) follows the phone.
        const theme = saved.theme === "light" || saved.theme === "dark" ? saved.theme : "system";
        return { ...current, ...saved, focusSound, theme, ...migrateNotifications(saved) };
      },
      // Listing the keys also drops retired values older installs still have
      // saved ("planningStyle", "aiAutoMode" / "voiceAddButton" from before
      // the AI chat was removed, "soundsEnabled" from before Settings →
      // Sounds was removed), the next time this store writes.
      partialize: (state) => ({
        analyticsEnabled: state.analyticsEnabled,
        language: state.language,
        theme: state.theme,
        dailyNudgeEnabled: state.dailyNudgeEnabled,
        dailyNudgeTime: state.dailyNudgeTime,
        overdueAlertsEnabled: state.overdueAlertsEnabled,
        deadlineRemindersEnabled: state.deadlineRemindersEnabled,
        reminderOffsets: state.reminderOffsets,
        notificationsEnabled: state.notificationsEnabled,
        notificationPromptShown: state.notificationPromptShown,
        tourSeen: state.tourSeen,
        gemStageSeen: state.gemStageSeen,
        aiConsent: state.aiConsent,
        focusSound: state.focusSound,
      }),
    },
  ),
);
