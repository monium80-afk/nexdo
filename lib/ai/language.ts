// Server-safe (imported by app/api routes): no store or React imports here.
import type { AppLanguage } from "@/types/settings";

const LANGUAGE_NAMES: Record<AppLanguage, string> = {
  en: "English",
  fr: "French",
  es: "Spanish",
  ar: "Arabic",
  de: "German",
};

/**
 * Appended to a system prompt so the model writes everything the user reads
 * in their app language. The prompts themselves stay in English — the model
 * follows them just as well, and there's only one copy to maintain.
 */
export function languageInstruction(language: AppLanguage | undefined): string {
  if (!language || language === "en" || !LANGUAGE_NAMES[language]) return "";
  const name = LANGUAGE_NAMES[language];
  return `

RESPONSE LANGUAGE — ${name.toUpperCase()}
The user has set the app to ${name}. Everything a person will read — "reply", task titles, notes, step titles, advice, explanations — must be written in natural, fluent ${name}, even though these instructions and their examples are in English. Use the polite form of address where ${name} has one (e.g. "vous" in French). The user may write in ${name} or English; understand both.
Never translate the machine-readable parts: JSON keys, action types, enum values (priority, scope, complexity, status) and ids stay exactly as specified.`;
}

// Worked examples in the user's own language keep that translation tight.
const DATE_PHRASE_EXAMPLES: Partial<Record<AppLanguage, string>> = {
  fr: `"demain" → "tomorrow", "vendredi prochain" → "next friday", "dans trois jours" → "in 3 days", "le 25 septembre à 19h" → "september 25 at 19:00"`,
  ar: `"غدًا" → "tomorrow", "الجمعة القادمة" → "next friday", "بعد ثلاثة أيام" → "in 3 days", "25 سبتمبر الساعة 7 مساءً" → "september 25 at 19:00"`,
};

/** Inbox only: the app's date parser reads English deadline phrases. */
export function datePhraseInstruction(language: AppLanguage | undefined): string {
  if (!language || language === "en" || !LANGUAGE_NAMES[language]) return "";
  const examples = DATE_PHRASE_EXAMPLES[language];
  return `
Exception: fields.dueDatePhrase is always written in English. Translate the user's deadline words and nothing more${
    examples ? ` — ${examples}` : ""
  }. Still never work out the calendar date yourself.`;
}

const AI_UNAVAILABLE: Partial<Record<AppLanguage, string>> = {
  en: "Sorry, I'm having trouble reaching the AI right now — try again in a moment.",
  fr: "Désolé, je n'arrive pas à joindre l'IA pour le moment — réessayez dans un instant.",
  ar: "عذرًا، أواجه صعوبة في الوصول إلى الذكاء الاصطناعي الآن — أعد المحاولة بعد قليل.",
};

export function aiUnavailableMessage(language: AppLanguage | undefined): string {
  return AI_UNAVAILABLE[language ?? "en"] ?? AI_UNAVAILABLE.en!;
}
