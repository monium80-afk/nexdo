import { ar } from "@/constants/translations/ar";
import { de } from "@/constants/translations/de";
import { en } from "@/constants/translations/en";
import { es } from "@/constants/translations/es";
import { fr } from "@/constants/translations/fr";
import { useSettingsStore } from "@/store/useSettingsStore";
import type { AppLanguage } from "@/types/settings";

export type Translations = typeof en;

// Every language Settings offers has its own copy — adding one to AppLanguage
// without a translation file is a type error here.
const TRANSLATIONS: Record<AppLanguage, Translations> = { en, fr, es, ar, de };

export const ALL_TRANSLATIONS: Translations[] = Object.values(TRANSLATIONS);

export function getTranslations(language: AppLanguage): Translations {
  // The fallback covers a stored language value this build doesn't know.
  return TRANSLATIONS[language] ?? en;
}

/** Arabic is the only right-to-left language Settings offers so far. */
export function isRtlLanguage(language: AppLanguage): boolean {
  return language === "ar";
}

export function getLanguage(): AppLanguage {
  return useSettingsStore.getState().language;
}

/**
 * For stores and lib code, which can't use hooks. Components should use
 * useTranslation() instead, so they re-render when the language changes.
 */
export function translate(): Translations {
  return getTranslations(getLanguage());
}
