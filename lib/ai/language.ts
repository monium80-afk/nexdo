// Server-safe (imported by app/api routes): no store or React imports here.
import type { AppLanguage } from "@/types/settings";

const LANGUAGE_NAMES: Record<AppLanguage, string> = {
  en: "English",
  fr: "French",
  es: "Spanish",
  ar: "Arabic",
  de: "German",
};

// Matches how the interface copy speaks to the user. Spanish and German apps
// say "tú" / "du" — "usted" and "Sie" read as stiff there — so they're the
// exceptions to the polite form.
const FORM_OF_ADDRESS: Partial<Record<AppLanguage, string>> = {
  es: `Address the user informally as "tú", as the rest of the app does — never "usted".`,
  de: `Address the user informally as "du", as the rest of the app does — never "Sie".`,
};

/**
 * Appended to a system prompt so the model writes everything the user reads
 * in their app language. The prompts themselves stay in English — the model
 * follows them just as well, and there's only one copy to maintain.
 */
export function languageInstruction(language: AppLanguage | undefined): string {
  if (!language || language === "en" || !LANGUAGE_NAMES[language]) return "";
  const name = LANGUAGE_NAMES[language];
  const address =
    FORM_OF_ADDRESS[language] ?? `Use the polite form of address where ${name} has one (e.g. "vous" in French).`;
  return `

RESPONSE LANGUAGE — ${name.toUpperCase()}
The user has set the app to ${name}. Everything a person will read — "reply", task titles, notes, step titles, advice, explanations — must be written in natural, fluent ${name}, even though these instructions and their examples are in English. ${address} The user may write in ${name} or English; understand both.
Never translate the machine-readable parts: JSON keys, action types, enum values (priority, scope, complexity, status) and ids stay exactly as specified.`;
}

// Worked examples in the user's own language keep that translation tight.
const DATE_PHRASE_EXAMPLES: Partial<Record<AppLanguage, string>> = {
  fr: `"demain" → "tomorrow", "vendredi prochain" → "next friday", "dans trois jours" → "in 3 days", "le 25 septembre à 19h" → "september 25 at 19:00"`,
  es: `"mañana" → "tomorrow", "el próximo viernes" → "next friday", "dentro de tres días" → "in 3 days", "el 25 de septiembre a las 7 de la tarde" → "september 25 at 19:00"`,
  de: `"morgen" → "tomorrow", "nächsten Freitag" → "next friday", "in drei Tagen" → "in 3 days", "am 25. September um 19 Uhr" → "september 25 at 19:00"`,
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
  es: "Lo siento, ahora mismo no consigo conectar con la IA — inténtalo de nuevo en un momento.",
  de: "Entschuldige, ich erreiche die KI gerade nicht — versuch es gleich noch einmal.",
  ar: "عذرًا، أواجه صعوبة في الوصول إلى الذكاء الاصطناعي الآن — أعد المحاولة بعد قليل.",
};

export function aiUnavailableMessage(language: AppLanguage | undefined): string {
  return AI_UNAVAILABLE[language ?? "en"] ?? AI_UNAVAILABLE.en!;
}
