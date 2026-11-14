// Reads a repeat out of a typed line — "every Monday", "every other week",
// "every 1st", "weekdays", "tous les lundis", "cada 2 semanas", "jeden
// zweiten Tag" — for the quick-add line on Add Task (lib/quickAdd.ts). Plain
// rules on the phone, no AI: they cost nothing, so they're on every plan.
//
// It returns where in the text the repeat was said, so the quick-add line can
// take those words out of the title. Only the repeat itself is read here; a
// time of day ("at 9") or a start day ("starting Monday") stays in the text
// for the date rules (lib/ai/parseDate.ts).

import { parseDeadlinePhrase } from "@/lib/ai/parseDate";
import type { RuleInput } from "@/lib/recurrence";
import type { AppLanguage } from "@/types/settings";
import type { RecurrenceFrequency, Weekday } from "@/types/task";

export type RepeatMatch = {
  rule: RuleInput;
  /** Where the repeat words start and end in the text (end exclusive), "until …" included. */
  start: number;
  end: number;
};

type Groups = (string | undefined)[];

type Pattern = {
  body: string;
  build: (groups: Groups, spec: LanguageSpec) => RuleInput | undefined;
};

type LanguageSpec = {
  /** One weekday, as this language writes it. */
  day: string;
  weekday: (word: string) => Weekday | undefined;
  /** What sits between weekdays in a list: "monday, wednesday and friday". */
  separator: string;
  patterns: Pattern[];
  /** The words in front of an end date: "until", "jusqu'au", "hasta", "bis". */
  until: string;
};

// Letters a word can be made of, accents included — \b only knows a–z.
const LETTER = "a-zß-ÿœæ0-9";

const WEEKDAYS_ONLY: Weekday[] = [1, 2, 3, 4, 5];
const WEEKEND: Weekday[] = [6, 0];

const NUMBER_WORDS: Record<string, number> = {
  other: 2,
  second: 2,
  "2nd": 2,
  third: 3,
  "3rd": 3,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  zwei: 2,
  zweite: 2,
  zweiten: 2,
  drei: 3,
  dritte: 3,
  dritten: 3,
  vier: 4,
  vierte: 4,
  vierten: 4,
  fünf: 5,
  sechs: 6,
};

function toInterval(word: string | undefined): number {
  if (!word) return 1;
  const digits = Number.parseInt(word, 10);
  if (Number.isFinite(digits)) return Math.max(1, digits);
  return NUMBER_WORDS[word] ?? 1;
}

function stripAccents(word: string): string {
  return word.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Every weekday named in a matched list, in week order, each once. */
function weekdaysIn(list: string | undefined, spec: LanguageSpec): Weekday[] {
  if (!list) return [];
  const found = new Set<Weekday>();
  for (const word of list.split(/[^a-zß-ÿœæ]+/)) {
    const day = word ? spec.weekday(word) : undefined;
    if (day !== undefined) found.add(day);
  }
  return [...found].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
}

function monthDayRule(day: string | undefined, interval = 1): RuleInput | undefined {
  const value = Number(day);
  return Number.isInteger(value) && value >= 1 && value <= 31 ? { frequency: "monthly", interval, monthDay: value } : undefined;
}

function every(frequency: RecurrenceFrequency, interval = 1): RuleInput {
  return { frequency, interval };
}

function weekly(weekdays: Weekday[], interval = 1): RuleInput | undefined {
  return weekdays.length > 0 ? { frequency: "weekly", interval, weekdays } : undefined;
}

/** A weekday list: "monday", "mon, wed and fri", "lundi et jeudi". */
function dayList(spec: { day: string; separator: string }): string {
  return `(?:${spec.day})(?:\\s*(?:${spec.separator})\\s*(?:${spec.day}))*`;
}

// ── English ─────────────────────────────────────────────────────────────────

const EN_DAY =
  "mon(?:day)?s?|tue(?:s(?:day)?)?s?|wed(?:nesday)?s?|thu(?:r(?:s(?:day)?)?)?s?|fri(?:day)?s?|sat(?:urday)?s?|sun(?:day)?s?";
const EN_PLURAL_DAY = "mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays";
const EN_SEPARATOR = ",\\s*and|,|and|&|/|\\+";
const EN_EVERY = "(?:every|each)";
const EN_N = "(\\d+|other|second|2nd|third|3rd|two|three|four|five|six)";
const EN_UNIT: Record<string, RecurrenceFrequency> = { day: "daily", week: "weekly", month: "monthly", year: "yearly" };
const EN_LIST = dayList({ day: EN_DAY, separator: EN_SEPARATOR });

const english: LanguageSpec = {
  day: EN_DAY,
  separator: EN_SEPARATOR,
  weekday: (word) => ({ sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 } as Record<string, Weekday>)[word.slice(0, 3)],
  until: "until|till|through|thru|ending(?:\\s+on)?|up\\s+to",
  patterns: [
    // "every month on the 15th", "every 2 months on the 1st"
    {
      body: `${EN_EVERY}\\s+(?:${EN_N}\\s+)?months?\\s+on\\s+the\\s+(\\d{1,2})(?:st|nd|rd|th)?`,
      build: ([n, day]) => monthDayRule(day, toInterval(n)),
    },
    // "on the 1st of every month", "the 15th of each month"
    {
      body: `(?:on\\s+)?the\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${EN_EVERY}\\s+month`,
      build: ([day]) => monthDayRule(day),
    },
    // "every 1st", "every 15th of the month" — the ordinal is required, so "every 3 days" isn't one.
    {
      body: `${EN_EVERY}\\s+(\\d{1,2})(?:st|nd|rd|th)(?:\\s+of\\s+the\\s+month)?`,
      build: ([day]) => monthDayRule(day),
    },
    // "every 2 weeks on monday and thursday"
    {
      body: `${EN_EVERY}\\s+(?:${EN_N}\\s+)?weeks?\\s+on\\s+(${EN_LIST})`,
      build: ([n, list], spec) => weekly(weekdaysIn(list, spec), toInterval(n)),
    },
    // "every weekday", "weekdays", "monday to friday", "mon-fri"
    {
      body: `${EN_EVERY}\\s+(?:weekday|workday|work\\s+day|business\\s+day)s?|(?:on\\s+)?weekdays|mon(?:day)?\\s*(?:to|through|thru|-|–)\\s*fri(?:day)?`,
      build: () => weekly(WEEKDAYS_ONLY),
    },
    // "every weekend", "on weekends"
    { body: `${EN_EVERY}\\s+weekend|(?:on\\s+)?weekends`, build: () => weekly(WEEKEND) },
    // "every monday", "every other tuesday", "every mon, wed and fri"
    {
      body: `${EN_EVERY}\\s+(?:${EN_N}\\s+)?(${EN_LIST})`,
      build: ([n, list], spec) => weekly(weekdaysIn(list, spec), toInterval(n)),
    },
    // "every day", "every other week", "every 3 months", "each year"
    {
      body: `${EN_EVERY}\\s+(?:${EN_N}\\s+)?(day|week|month|year)s?`,
      build: ([n, unit]) => every(EN_UNIT[unit ?? "day"] ?? "daily", toInterval(n)),
    },
    { body: "every\\s*day|daily|nightly|every\\s+(?:morning|afternoon|evening|night)", build: () => every("daily") },
    { body: "bi-?weekly|fortnightly", build: () => every("weekly", 2) },
    { body: "weekly", build: () => every("weekly") },
    { body: "monthly", build: () => every("monthly") },
    { body: "yearly|annually", build: () => every("yearly") },
    // "on mondays", "tuesdays and thursdays"
    {
      body: `(?:on\\s+)?(${dayList({ day: EN_PLURAL_DAY, separator: EN_SEPARATOR })})`,
      build: ([list], spec) => weekly(weekdaysIn(list, spec)),
    },
  ],
};

// ── French ──────────────────────────────────────────────────────────────────

const FR_DAY = "(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)s?";
const FR_SEPARATOR = ",\\s*et|,|et|&|/";
const FR_N = "(\\d+|deux|trois|quatre|cinq|six)";
const FR_UNIT: Record<string, RecurrenceFrequency> = { jour: "daily", semaine: "weekly", mois: "monthly", an: "yearly", annee: "yearly" };
const FR_LIST = dayList({ day: FR_DAY, separator: FR_SEPARATOR });

const french: LanguageSpec = {
  day: FR_DAY,
  separator: FR_SEPARATOR,
  weekday: (word) =>
    ({ lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6, dim: 0 } as Record<string, Weekday>)[word.slice(0, 3)],
  until: "jusqu['’]\\s*(?:au|à|a)",
  patterns: [
    // "le 1er de chaque mois", "tous les 15 du mois"
    {
      body: "(?:le\\s+)?(\\d{1,2})(?:er)?\\s+(?:de\\s+)?chaque\\s+mois|tous\\s+les\\s+(\\d{1,2})\\s+du\\s+mois",
      build: ([a, b]) => monthDayRule(a ?? b),
    },
    // "tous les deux jours", "toutes les 3 semaines"
    {
      body: `tou(?:te)?s\\s+les\\s+${FR_N}\\s+(jour|semaine|mois|an|ann[ée]e)s?`,
      build: ([n, unit]) => every(FR_UNIT[stripAccents(unit ?? "jour")] ?? "daily", toInterval(n)),
    },
    { body: "un\\s+jour\\s+sur\\s+deux", build: () => every("daily", 2) },
    { body: "une\\s+semaine\\s+sur\\s+deux", build: () => every("weekly", 2) },
    // "un lundi sur deux"
    { body: `un\\s+(${FR_DAY})\\s+sur\\s+deux`, build: ([day], spec) => weekly(weekdaysIn(day, spec), 2) },
    // Before "tous les jours", which "tous les jours de la semaine" starts with.
    {
      body: "en\\s+semaine|les\\s+jours\\s+de\\s+semaine|tous\\s+les\\s+jours\\s+de\\s+(?:la\\s+)?semaine|du\\s+lundi\\s+au\\s+vendredi",
      build: () => weekly(WEEKDAYS_ONLY),
    },
    { body: "(?:tous\\s+les|chaque)\\s+week-?ends?", build: () => weekly(WEEKEND) },
    // "tous les lundis", "chaque mardi et jeudi"
    { body: `(?:tous\\s+les|chaque)\\s+(${FR_LIST})`, build: ([list], spec) => weekly(weekdaysIn(list, spec)) },
    {
      body: "tous\\s+les\\s+jours|chaque\\s+jour|quotidien(?:ne)?(?:ment)?|chaque\\s+(?:matin|soir)|tous\\s+les\\s+(?:matins|soirs)",
      build: () => every("daily"),
    },
    { body: "toutes\\s+les\\s+semaines|chaque\\s+semaine|hebdomadaire(?:ment)?", build: () => every("weekly") },
    { body: "tous\\s+les\\s+mois|chaque\\s+mois|mensuel(?:le)?(?:ment)?", build: () => every("monthly") },
    { body: "tous\\s+les\\s+ans|chaque\\s+ann[ée]e|annuel(?:le)?(?:ment)?", build: () => every("yearly") },
    // "les lundis" — habitual; "le lundi" is left to the date rules.
    {
      body: `les\\s+(${dayList({ day: "(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)s", separator: FR_SEPARATOR })})`,
      build: ([list], spec) => weekly(weekdaysIn(list, spec)),
    },
  ],
};

// ── Spanish ─────────────────────────────────────────────────────────────────

const ES_DAY = "lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bados?|domingos?";
const ES_SEPARATOR = ",\\s*y|,|y|&|/";
const ES_N = "(\\d+|dos|tres|cuatro|cinco|seis)";
const ES_UNIT: Record<string, RecurrenceFrequency> = { dia: "daily", semana: "weekly", mes: "monthly", ano: "yearly" };
const ES_LIST = dayList({ day: ES_DAY, separator: ES_SEPARATOR });

const spanish: LanguageSpec = {
  day: ES_DAY,
  separator: ES_SEPARATOR,
  weekday: (word) =>
    ({ lun: 1, mar: 2, mie: 3, jue: 4, vie: 5, sab: 6, dom: 0 } as Record<string, Weekday>)[stripAccents(word).slice(0, 3)],
  until: "hasta(?:\\s+el)?",
  patterns: [
    // "el 1 de cada mes", "cada 15 de mes"
    {
      body: "(?:el\\s+)?(\\d{1,2})\\s+de\\s+cada\\s+mes|cada\\s+(\\d{1,2})\\s+del?\\s+mes",
      build: ([a, b]) => monthDayRule(a ?? b),
    },
    // "cada dos días", "cada 3 semanas"
    {
      body: `cada\\s+${ES_N}\\s+(d[íi]a|semana|mes|año)(?:e?s)?`,
      build: ([n, unit]) => every(ES_UNIT[stripAccents(unit ?? "dia")] ?? "daily", toInterval(n)),
    },
    { body: "d[íi]a\\s+(?:por\\s+medio|s[íi]\\s+d[íi]a\\s+no)", build: () => every("daily", 2) },
    {
      body: "entre\\s+semana|(?:los\\s+)?d[íi]as\\s+(?:laborables|h[áa]biles)|de\\s+lunes\\s+a\\s+viernes",
      build: () => weekly(WEEKDAYS_ONLY),
    },
    { body: "(?:cada|todos\\s+los)\\s+fines?\\s+de\\s+semana", build: () => weekly(WEEKEND) },
    // "cada lunes", "todos los martes y jueves"
    { body: `(?:cada|todos\\s+los)\\s+(${ES_LIST})`, build: ([list], spec) => weekly(weekdaysIn(list, spec)) },
    {
      body: "cada\\s+d[íi]a|todos\\s+los\\s+d[íi]as|diari(?:o|a|amente)|cada\\s+(?:mañana|tarde|noche)|todas\\s+las\\s+(?:mañanas|tardes|noches)",
      build: () => every("daily"),
    },
    { body: "cada\\s+semana|todas\\s+las\\s+semanas|semanal(?:mente)?", build: () => every("weekly") },
    { body: "cada\\s+mes|todos\\s+los\\s+meses|mensual(?:mente)?", build: () => every("monthly") },
    { body: "cada\\s+año|todos\\s+los\\s+años|anual(?:mente)?", build: () => every("yearly") },
    // "los lunes" — habitual; "el lunes" is left to the date rules.
    { body: `los\\s+(${ES_LIST})`, build: ([list], spec) => weekly(weekdaysIn(list, spec)) },
  ],
};

// ── German ──────────────────────────────────────────────────────────────────

const DE_DAY = "montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonnabend|sonntag";
const DE_ADVERB = "montags|dienstags|mittwochs|donnerstags|freitags|samstags|sonntags";
const DE_SEPARATOR = ",\\s*und|,|und|&|/";
const DE_N = "(\\d+|zwei|drei|vier|fünf|sechs)";
const DE_ORDINAL = "(zweite[n]?|dritte[n]?|vierte[n]?)";
const DE_UNIT: Record<string, RecurrenceFrequency> = {
  tag: "daily",
  tage: "daily",
  woche: "weekly",
  wochen: "weekly",
  monat: "monthly",
  monate: "monthly",
  jahr: "yearly",
  jahre: "yearly",
};

function germanUnit(word: string | undefined): RecurrenceFrequency {
  return DE_UNIT[word ?? "tag"] ?? "daily";
}

const german: LanguageSpec = {
  day: `${DE_DAY}|${DE_ADVERB}`,
  separator: DE_SEPARATOR,
  weekday: (word) => {
    if (word.startsWith("sonna")) return 6;
    return ({ mon: 1, die: 2, mit: 3, don: 4, fre: 5, sam: 6, son: 0 } as Record<string, Weekday>)[word.slice(0, 3)];
  },
  until: "bis(?:\\s+(?:zum|am))?",
  patterns: [
    // "am 1. jedes Monats", "jeden 15."
    {
      body: "am\\s+(\\d{1,2})\\.?\\s+(?:jedes|jeden)\\s+monats?|jeden\\s+(\\d{1,2})\\.(?:\\s+des\\s+monats)?",
      build: ([a, b]) => monthDayRule(a ?? b),
    },
    // "alle zwei Tage", "alle 3 Wochen"
    { body: `alle\\s+${DE_N}\\s+(tage|wochen|monate|jahre)`, build: ([n, unit]) => every(germanUnit(unit), toInterval(n)) },
    { body: "zweiw[öo]chentlich", build: () => every("weekly", 2) },
    {
      body: "werktags|an\\s+werktagen|unter\\s+der\\s+woche|(?:von\\s+)?montags?\\s+bis\\s+freitags?",
      build: () => weekly(WEEKDAYS_ONLY),
    },
    { body: "jedes\\s+wochenende|an\\s+wochenenden", build: () => weekly(WEEKEND) },
    // "jeden Montag", "jeden zweiten Dienstag", "jeden Montag und Donnerstag"
    {
      body: `jede[n]?\\s+(?:${DE_ORDINAL}\\s+)?(${dayList({ day: DE_DAY, separator: DE_SEPARATOR })})`,
      build: ([n, list], spec) => weekly(weekdaysIn(list, spec), toInterval(n)),
    },
    // "jeden zweiten Tag", "jede zweite Woche"
    {
      body: `jede[ns]?\\s+${DE_ORDINAL}\\s+(tag|woche|monat|jahr)`,
      build: ([n, unit]) => every(germanUnit(unit), toInterval(n)),
    },
    { body: "jeden\\s+tag|t[äa]glich|jeden\\s+(?:morgen|abend)", build: () => every("daily") },
    { body: "jede\\s+woche|w[öo]chentlich", build: () => every("weekly") },
    { body: "jeden\\s+monat|monatlich", build: () => every("monthly") },
    { body: "jedes\\s+jahr|j[äa]hrlich", build: () => every("yearly") },
    // "montags", "dienstags und donnerstags"
    { body: `(${dayList({ day: DE_ADVERB, separator: DE_SEPARATOR })})`, build: ([list], spec) => weekly(weekdaysIn(list, spec)) },
  ],
};

const SPECS: Partial<Record<AppLanguage, LanguageSpec>> = { en: english, fr: french, es: spanish, de: german };

/** English always works; the app's language on top. Unknown: every language we read. */
function specsFor(language: AppLanguage | undefined): LanguageSpec[] {
  if (!language) return Object.values(SPECS) as LanguageSpec[];
  const own = SPECS[language];
  return own && own !== english ? [english, own] : [english];
}

function wordPattern(body: string, flags = "i"): RegExp {
  return new RegExp(`(^|[^${LETTER}])(?:${body})(?![${LETTER}])`, flags);
}

const compiled = new WeakMap<Pattern, RegExp>();
function regexFor(pattern: Pattern): RegExp {
  let regex = compiled.get(pattern);
  if (!regex) {
    regex = wordPattern(pattern.body);
    compiled.set(pattern, regex);
  }
  return regex;
}

const sameDay = (a: { date: string } | undefined, b: { date: string } | undefined) => !!a && !!b && a.date === b.date;

/**
 * The end day said right after a repeat ("… until June 5"), and how far into
 * `rest` it reaches. The shortest run of words that reads as the same day as
 * the longest one, so words after it aren't swallowed.
 */
function readEndDate(rest: string, now: Date, language: AppLanguage | undefined): { date: string; length: number } | undefined {
  const words = [...rest.matchAll(/\S+/g)].slice(0, 6);
  if (words.length === 0) return undefined;
  const upTo = (count: number) => rest.slice(0, words[count - 1].index! + words[count - 1][0].length);
  for (let longest = words.length; longest >= 1; longest -= 1) {
    const target = parseDeadlinePhrase(upTo(longest), now, language);
    if (!target) continue;
    for (let count = 1; count <= longest; count += 1) {
      const parsed = parseDeadlinePhrase(upTo(count), now, language);
      if (sameDay(parsed, target)) return { date: target.date, length: upTo(count).length };
    }
  }
  return undefined;
}

/**
 * The repeat a typed line asks for, and where it was said. Undefined when it
 * names none. The first pattern that matches wins — they're ordered from the
 * most specific ("every 2 weeks on Monday") to the loosest ("weekly").
 */
export function findRepeat(text: string, now: Date = new Date(), language?: AppLanguage): RepeatMatch | undefined {
  const lower = text.toLowerCase();
  for (const spec of specsFor(language)) {
    for (const pattern of spec.patterns) {
      const match = regexFor(pattern).exec(lower);
      if (!match) continue;
      const rule = pattern.build(match.slice(2), spec);
      if (!rule) continue;
      const start = match.index + match[1].length;
      let end = match.index + match[0].length;

      // "… until June 5" / "jusqu'au 5 juin" right after it.
      const until = new RegExp(`^\\s*,?\\s*(?:${spec.until})\\s+`, "i").exec(lower.slice(end));
      if (until) {
        const ending = readEndDate(text.slice(end + until[0].length), now, language);
        if (ending) {
          rule.endDate = ending.date;
          end += until[0].length + ending.length;
        }
      }
      return { rule, start, end };
    }
  }
  return undefined;
}

/** A weekday named anywhere in the text, in any language read — a sign of a date the rules may have missed. */
export function mentionsWeekday(text: string, language?: AppLanguage): boolean {
  const lower = text.toLowerCase();
  return specsFor(language).some((spec) =>
    wordPattern(spec === english ? "monday|tuesday|wednesday|thursday|friday|saturday|sunday" : spec.day).test(lower),
  );
}
