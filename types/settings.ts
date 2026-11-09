export type ThemePreference = "light" | "dark" | "system";

/**
 * The app's languages. Since 2026-11-02 also the five most spoken ones it
 * didn't have: Chinese (Simplified), Hindi, Portuguese (Brazil), Bengali and
 * Russian.
 */
export type AppLanguage = "en" | "fr" | "es" | "ar" | "de" | "zh" | "hi" | "pt" | "bn" | "ru";

/** A focus session's background sound (lib/focusSound.ts). */
export type FocusSound = "off" | "rain" | "brown" | "waves";
