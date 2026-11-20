import { getTranslations, type Translations } from "@/lib/i18n";
import { useSettingsStore } from "@/store/useSettingsStore";

/** The copy for the language picked in Settings — re-renders when it changes. */
export function useTranslation(): Translations {
  const language = useSettingsStore((state) => state.language);
  return getTranslations(language);
}
