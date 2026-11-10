export type ThemePreference = "light" | "dark" | "system";

/**
 * The app's languages. Since 2026-11-02 also the five most spoken ones it
 * didn't have: Chinese (Simplified), Hindi, Portuguese (Brazil), Bengali and
 * Russian.
 */
export type AppLanguage = "en" | "fr" | "es" | "ar" | "de" | "zh" | "hi" | "pt" | "bn" | "ru";

/**
 * A focus session's background sounds, in the picker's order
 * (lib/focusSound.ts). "brown" (brown noise) was removed 2026-11-09; a saved
 * pick that's no longer here reads as "off" (store/useSettingsStore.ts).
 */
export const FOCUS_SOUND_CHOICES = ["off", "rain", "waves", "thunder", "stream", "forest", "fireplace", "cafe"] as const;

export type FocusSound = (typeof FOCUS_SOUND_CHOICES)[number];
