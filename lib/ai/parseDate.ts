// Heuristic date-phrase parser shared by task extraction and intent
// classification. The Gemini path never computes dates itself — it copies
// the user's deadline wording verbatim into dueDatePhrase and this resolves
// it (see app/api/inbox+api.ts) — so anything this can't parse silently
// becomes "no deadline". That makes breadth here worth more than precision:
// it covers the phrasings people actually type, including past ones
// ("last week") that should land as overdue, not as no deadline at all.
// Returns undefined only when the text names no deadline whatsoever.

import type { AppLanguage } from "@/types/settings";

const DEFAULT_HOUR = 18;

const COUNT_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  couple: 2,
  three: 3,
  few: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const COUNT_PATTERN = `\\d+|${Object.keys(COUNT_WORDS).join("|")}`;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const MONTH_ALTERNATIVES = [
  ["january", "jan"],
  ["february", "feb"],
  ["march", "mar"],
  ["april", "apr"],
  ["may"],
  ["june", "jun"],
  ["july", "jul"],
  ["august", "aug"],
  ["september", "sep", "sept"],
  ["october", "oct"],
  ["november", "nov"],
  ["december", "dec"],
];

type TimeOfDay = { hour: number; minute: number };

// French deadline wording ("vendredi prochain à 19h", "dans trois jours") is
// rewritten into the English phrasing the rules below already understand,
// rather than maintaining a second parser. The AI is asked to send English
// phrases already — this covers the user's own words, which the inbox route
// re-reads when the model leaves a deadline out.
const LETTER = "a-zß-ÿœæ";

function wholeWord(pattern: string): RegExp {
  // \b doesn't treat accented letters as word characters, so the boundary is spelled out.
  return new RegExp(`(^|[^${LETTER}])(?:${pattern})(?![${LETTER}])`, "g");
}

const FRENCH_UNITS: Record<string, string> = { jour: "day", semaine: "week", mois: "month", heure: "hour", minute: "minute" };

const FRENCH_WEEKDAYS: Record<string, string> = {
  lundi: "monday",
  mardi: "tuesday",
  mercredi: "wednesday",
  jeudi: "thursday",
  vendredi: "friday",
  samedi: "saturday",
  dimanche: "sunday",
};

const FRENCH_MONTHS: Record<string, string> = {
  janvier: "january",
  "f[ée]vrier": "february",
  mars: "march",
  avril: "april",
  mai: "may",
  juin: "june",
  juillet: "july",
  "ao[uû]t": "august",
  septembre: "september",
  octobre: "october",
  novembre: "november",
  "d[ée]cembre": "december",
};

// "sept" is left out on purpose — it's also the English "sept 20".
const FRENCH_NUMBERS: Record<string, string> = {
  une: "1",
  un: "1",
  deux: "2",
  trois: "3",
  quatre: "4",
  cinq: "5",
  huit: "8",
  neuf: "9",
  dix: "10",
  onze: "11",
  douze: "12",
};

const FRENCH_PHRASES: [string, string][] = [
  ["apr[èe]s[- ]demain", "day after tomorrow"],
  ["demain", "tomorrow"],
  ["aujourd['’]hui", "today"],
  ["avant[- ]hier", "2 days ago"],
  ["hier", "yesterday"],
  ["ce soir", "tonight"],
  ["ce matin", "this morning"],
  ["cet apr[èe]s[- ]midi", "this afternoon"],
  ["d[èe]s que possible|au plus vite|imm[ée]diatement|tout de suite", "asap"],
  ["(?:la |en )?fin de (?:la )?semaine", "end of week"],
  ["(?:la |en )?fin du mois", "end of month"],
  ["(?:le )?week[- ]end prochain", "next weekend"],
  ["(?:ce )?week[- ]end", "weekend"],
  ["(?:la )?semaine prochaine", "next week"],
  ["(?:la )?semaine derni[èe]re", "last week"],
  ["cette semaine", "this week"],
  ["(?:le )?mois prochain", "next month"],
  ["(?:le )?mois dernier", "last month"],
  // Before "midi" — "après-midi" contains it.
  ["apr[èe]s[- ]midi", "afternoon"],
  ["midi", "noon"],
  ["minuit", "midnight"],
  ["matin", "morning"],
  ["soir(?:[ée]e)?", "evening"],
];

function normalizeFrenchDatePhrase(lower: string): string {
  let text = lower;

  for (const [word, digits] of Object.entries(FRENCH_NUMBERS)) {
    text = text.replace(wholeWord(word), `$1${digits}`);
  }
  // "à 19h", "vers 7h30", "à 18 h 45" — always with minutes, so "at 7:00"
  // stays 7am instead of being read as a bare evening "at 7".
  text = text.replace(/(^|\s)(?:à|vers)\s*(\d{1,2})\s*h\s*(\d{2})?(?![0-9a-z])/g, (_, lead: string, hour: string, minute?: string) =>
    `${lead}at ${hour}:${minute ?? "00"}`,
  );
  text = text.replace(/(\d{1,2})er(?![a-z])/g, "$1");
  text = text.replace(
    /(?:dans|d['’]ici)\s+(\d+)\s+(jour|semaine|mois|heure|minute)s?/g,
    (_, count: string, unit: string) => `in ${count} ${FRENCH_UNITS[unit]}s`,
  );
  text = text.replace(
    /il y a\s+(\d+)\s+(jour|semaine|mois|heure|minute)s?/g,
    (_, count: string, unit: string) => `${count} ${FRENCH_UNITS[unit]}s ago`,
  );

  for (const [french, english] of FRENCH_PHRASES) {
    text = text.replace(wholeWord(french), `$1${english}`);
  }
  for (const [french, english] of Object.entries(FRENCH_WEEKDAYS)) {
    text = text
      .replace(wholeWord(`${french} prochain`), `$1next ${english}`)
      .replace(wholeWord(`${french} dernier`), `$1last ${english}`)
      .replace(wholeWord(french), `$1${english}`);
  }
  for (const [french, english] of Object.entries(FRENCH_MONTHS)) {
    text = text.replace(wholeWord(french), `$1${english}`);
  }

  return text;
}

// Spanish gets the same treatment ("el viernes a las 7 de la tarde", "dentro
// de tres días").
const SPANISH_UNITS: Record<string, string> = {
  día: "day",
  dia: "day",
  semana: "week",
  mes: "month",
  hora: "hour",
  minuto: "minute",
};
const SPANISH_UNIT_PATTERN = "(d[íi]a|semana|mes|hora|minuto)(?:e?s)?";

const SPANISH_WEEKDAYS: Record<string, string> = {
  lunes: "monday",
  martes: "tuesday",
  "mi[ée]rcoles": "wednesday",
  jueves: "thursday",
  viernes: "friday",
  "s[áa]bado": "saturday",
  domingo: "sunday",
};

// Only read right after "<day> de" ("25 de mayo") — on its own "mayo" is as
// likely to be mayonnaise on a shopping list as the month.
const SPANISH_MONTHS: Record<string, string> = {
  enero: "january",
  febrero: "february",
  marzo: "march",
  abril: "april",
  mayo: "may",
  junio: "june",
  julio: "july",
  agosto: "august",
  "sep?tiembre": "september",
  octubre: "october",
  noviembre: "november",
  diciembre: "december",
};

// "once" is left out on purpose — it's also the English "once".
const SPANISH_NUMBERS: Record<string, string> = {
  una: "1",
  un: "1",
  dos: "2",
  tres: "3",
  cuatro: "4",
  cinco: "5",
  seis: "6",
  siete: "7",
  ocho: "8",
  nueve: "9",
  diez: "10",
  doce: "12",
};

const SPANISH_PHRASES: [string, string][] = [
  ["pasado ma[ñn]ana", "day after tomorrow"],
  ["anteayer|antier|antes de ayer", "2 days ago"],
  ["ayer", "yesterday"],
  ["hoy", "today"],
  ["esta noche", "tonight"],
  ["esta ma[ñn]ana", "this morning"],
  ["esta tarde", "this afternoon"],
  // Before plain "mañana" — "mañana por la mañana" is tomorrow morning.
  ["(?:por|en) la ma[ñn]ana", "morning"],
  ["(?:por|en) la tarde", "afternoon"],
  ["(?:por|en) la noche", "evening"],
  ["ma[ñn]ana", "tomorrow"],
  ["lo antes posible|cuanto antes|de inmediato|inmediatamente|ahora mismo", "asap"],
  // "fin de semana" is the weekend; the end of the week is "final de la semana".
  ["(?:a |al )?final(?:es)? de (?:la )?semana", "end of week"],
  ["(?:a |al )?(?:fin|final(?:es)?) del? mes", "end of month"],
  ["(?:el )?pr[óo]ximo fin de semana|(?:el )?fin de semana que viene", "next weekend"],
  ["(?:este |el )?(?:fin de semana|finde)", "weekend"],
  ["(?:la )?(?:pr[óo]xima semana|semana que viene|semana pr[óo]xima)", "next week"],
  ["(?:la )?semana pasada", "last week"],
  ["esta semana", "this week"],
  ["(?:el )?(?:pr[óo]ximo mes|mes que viene|mes pr[óo]ximo)", "next month"],
  ["(?:el )?mes pasado", "last month"],
  ["mediod[íi]a", "noon"],
  ["medianoche", "midnight"],
];

function normalizeSpanishDatePhrase(lower: string): string {
  let text = lower;

  for (const [word, digits] of Object.entries(SPANISH_NUMBERS)) {
    text = text.replace(wholeWord(word), `$1${digits}`);
  }
  // "a las 7 de la tarde" → "at 19:00", "a la 1:30" → "at 1:30". Runs before
  // the phrases so "de la mañana" is never read as "tomorrow". A bare "a las 7"
  // stays bare, so it gets the same evening reading as "at 7".
  text = text.replace(
    /(^|\s)(?:a|hacia|sobre|para|antes de|hasta)\s+las?\s+(\d{1,2})(?::(\d{2}))?(?:\s*h)?(?:\s+de\s+la\s+(ma[ñn]ana|madrugada|tarde|noche))?(?![0-9a-zà-ÿ])/g,
    (_, lead: string, hour: string, minute: string | undefined, period: string | undefined) => {
      if (!period) return `${lead}at ${hour}${minute ? `:${minute}` : ""}`;
      const hour24 = (Number(hour) % 12) + (period === "tarde" || period === "noche" ? 12 : 0);
      return `${lead}at ${hour24}:${minute ?? "00"}`;
    },
  );
  text = text.replace(
    wholeWord(`(?:en|dentro de)\\s+(\\d+)\\s+${SPANISH_UNIT_PATTERN}`),
    (_, lead: string, count: string, unit: string) => `${lead}in ${count} ${SPANISH_UNITS[unit]}s`,
  );
  text = text.replace(
    wholeWord(`hace\\s+(\\d+)\\s+${SPANISH_UNIT_PATTERN}`),
    (_, lead: string, count: string, unit: string) => `${lead}${count} ${SPANISH_UNITS[unit]}s ago`,
  );

  for (const [spanish, english] of SPANISH_PHRASES) {
    text = text.replace(wholeWord(spanish), `$1${english}`);
  }
  for (const [spanish, english] of Object.entries(SPANISH_WEEKDAYS)) {
    // "Domingo" is also a first name, so a bare Sunday needs "el"/"este" in front.
    const bare = spanish === "domingo" ? "(?:el|este) domingo" : spanish;
    text = text
      .replace(wholeWord(`(?:el )?pr[óo]ximo ${spanish}|${spanish} (?:que viene|pr[óo]ximo)`), `$1next ${english}`)
      .replace(wholeWord(`${spanish} pasado`), `$1last ${english}`)
      .replace(wholeWord(bare), `$1${english}`);
  }
  for (const [spanish, english] of Object.entries(SPANISH_MONTHS)) {
    text = text.replace(new RegExp(`(\\d{1,2})º?\\s+de\\s+${spanish}(?![${LETTER}])`, "g"), `$1 ${english}`);
  }

  return text;
}

// And German ("am Freitag um 15 Uhr", "in drei Tagen", "bis 25.9."). German
// "am" sits right after a clock time as often as the English "am" does —
// "15:00 am freitag" would read as 3 a.m. — so it's always consumed together
// with the word it belongs to ("am freitag" → "friday").
const GERMAN_UNITS: Record<string, string> = {
  tag: "day",
  woche: "week",
  monat: "month",
  stunde: "hour",
  minute: "minute",
};
const GERMAN_UNIT_PATTERN = "(tag|woche|monat|stunde|minute)(?:en|n|e)?";
const GERMAN_PERIOD = "(abends|nachmittags|morgens|vormittags|fr[üu]h|nachts)";

const GERMAN_WEEKDAYS: Record<string, string> = {
  montag: "monday",
  dienstag: "tuesday",
  mittwoch: "wednesday",
  donnerstag: "thursday",
  freitag: "friday",
  "samstag|sonnabend": "saturday",
  sonntag: "sunday",
};

// Only the names that differ from English.
const GERMAN_MONTHS: Record<string, string> = {
  "januar|j[äa]nner": "january",
  februar: "february",
  "m[äa]rz": "march",
  mai: "may",
  juni: "june",
  juli: "july",
  oktober: "october",
  dezember: "december",
};

// "elf" is left out on purpose — it's also the English "elf".
const GERMAN_NUMBERS: Record<string, string> = {
  "eins|eine[mnrs]?|ein": "1",
  zwei: "2",
  drei: "3",
  vier: "4",
  "f[üu]nf": "5",
  sechs: "6",
  sieben: "7",
  acht: "8",
  neun: "9",
  zehn: "10",
  "zw[öo]lf": "12",
};

const GERMAN_PHRASES: [string, string][] = [
  // A greeting, not a deadline — cleared before "morgen" (tomorrow) sees it.
  ["guten morgen", ""],
  ["[üu]bermorgen", "day after tomorrow"],
  ["vorgestern", "2 days ago"],
  ["gestern", "yesterday"],
  ["heute (?:abend|nacht)", "tonight"],
  ["heute (?:morgen|fr[üu]h|vormittag)", "this morning"],
  ["heute nachmittag", "this afternoon"],
  ["heute", "today"],
  ["am (?:n[äa]chsten|folgenden) tag", "tomorrow"],
  ["morgen fr[üu]h", "tomorrow morning"],
  // Before plain "morgen" (tomorrow) — "am Morgen" is the morning.
  ["am morgen|morgens|am vormittag|vormittags?", "morning"],
  ["morgen", "tomorrow"],
  ["am nachmittag|nachmittags?", "afternoon"],
  ["am abend|abends?", "evening"],
  ["(?:am|gegen|um) mittag|mittags", "noon"],
  ["mitternacht", "midnight"],
  ["so schnell wie m[öo]glich|schnellstm[öo]glich|m[öo]glichst bald|sofort|umgehend", "asap"],
  ["(?:bis |zum |am )?ende (?:der|dieser) woche", "end of week"],
  ["(?:bis |zum |am )?(?:ende (?:des|dieses) monats|monatsende)", "end of month"],
  ["(?:am )?(?:n[äa]chste[nms]?|kommende[nms]?) wochenende", "next weekend"],
  ["(?:am |dieses |[üu]bers )?wochenende", "weekend"],
  ["(?:in der )?(?:n[äa]chste[nr]?|kommende[nr]?) woche", "next week"],
  ["(?:in der )?(?:letzte[nr]?|vergangene[nr]?) woche", "last week"],
  ["(?:in )?diese[nr]? woche", "this week"],
  ["(?:im )?(?:n[äa]chste[nr]?|kommende[nr]?) monat", "next month"],
  ["(?:im )?(?:letzte[nr]?|vergangene[nr]?) monat", "last month"],
];

/** "7 abends" → 19, "11 nachts" → 23, "2 nachts" → 2 — no period keeps the hour as said. */
function germanHour(hour: string, period: string | undefined): number {
  const value = Number(hour);
  if (period === "abends" || period === "nachmittags") return value < 12 ? value + 12 : value;
  if (period === "nachts") return value >= 6 && value < 12 ? value + 12 : value;
  return value;
}

function normalizeGermanDatePhrase(lower: string): string {
  let text = lower;

  for (const [word, digits] of Object.entries(GERMAN_NUMBERS)) {
    text = text.replace(wholeWord(word), `$1${digits}`);
  }
  // "bis 25.9.", "am 03.10.2026". Without a lead-in word or a year it's left
  // alone, so "takes 1.5." at the end of a sentence doesn't become May 1st.
  // Runs before the clock times so "bis 25.10." isn't read as 25:10.
  text = text.replace(
    wholeWord(String.raw`(?:(am|bis(?: zum)?|zum|ab|vom|den)\s+)?(\d{1,2})\.(\d{1,2})\.(\d{4})?`),
    (match: string, lead: string, leadIn?: string, day?: string, month?: string, year?: string) => {
      const name = MONTHS[Number(month) - 1];
      return name && (leadIn || year) ? `${lead}${day} ${name}` : match;
    },
  );
  // "um halb 8" is half past seven.
  text = text.replace(wholeWord(String.raw`um\s+halb\s+(\d{1,2})`), (_, lead: string, hour: string) => {
    const previous = Number(hour) - 1;
    return `${lead}at ${previous === 0 ? 12 : previous}:30`;
  });
  // "um 15 Uhr", "gegen 7 Uhr abends", "18.30 Uhr" — "Uhr" is a 24-hour clock.
  text = text.replace(
    wholeWord(String.raw`(?:(?:um|gegen|bis|ab|vor)\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*uhr(?:\s+${GERMAN_PERIOD})?`),
    (_, lead: string, hour: string, minute?: string, period?: string) =>
      `${lead}at ${germanHour(hour, period)}:${minute ?? "00"}`,
  );
  text = text.replace(
    wholeWord(String.raw`(?:um|gegen|bis|ab|vor)\s+(\d{1,2})[:.](\d{2})(?:\s+${GERMAN_PERIOD})?`),
    (_, lead: string, hour: string, minute: string, period?: string) =>
      `${lead}at ${germanHour(hour, period)}:${minute}`,
  );
  // A bare "um 7" stays bare, so it gets the same evening reading as "at 7".
  text = text.replace(
    wholeWord(String.raw`um\s+(\d{1,2})(?:\s+${GERMAN_PERIOD})?`),
    (_, lead: string, hour: string, period?: string) =>
      period ? `${lead}at ${germanHour(hour, period)}:00` : `${lead}at ${hour}`,
  );
  text = text.replace(
    wholeWord(String.raw`(?:in|innerhalb von)\s+(\d+)\s+${GERMAN_UNIT_PATTERN}`),
    (_, lead: string, count: string, unit: string) => `${lead}in ${count} ${GERMAN_UNITS[unit]}s`,
  );
  text = text.replace(
    wholeWord(String.raw`vor\s+(\d+)\s+${GERMAN_UNIT_PATTERN}`),
    (_, lead: string, count: string, unit: string) => `${lead}${count} ${GERMAN_UNITS[unit]}s ago`,
  );

  for (const [german, english] of GERMAN_PHRASES) {
    text = text.replace(wholeWord(german), `$1${english}`);
  }
  for (const [german, english] of Object.entries(GERMAN_WEEKDAYS)) {
    text = text
      .replace(wholeWord(`(?:am )?(?:n[äa]chste[nr]?|kommende[nr]?) (?:${german})`), `$1next ${english}`)
      .replace(wholeWord(`(?:am )?(?:letzte[nr]?|vergangene[nr]?) (?:${german})`), `$1last ${english}`)
      .replace(wholeWord(`(?:am |diese[nm]? )?(?:${german})`), `$1${english}`);
  }
  for (const [german, english] of Object.entries(GERMAN_MONTHS)) {
    text = text.replace(wholeWord(german), `$1${english}`);
  }
  // "am 5. march" → "5 march": the ordinal dot goes, and so does the "am".
  text = text.replace(new RegExp(String.raw`(?:\bam\s+)?(\d{1,2})\.\s*(${MONTHS.join("|")})`, "g"), "$1 $2");

  return text;
}

// Each language's deadline words, rewritten into English. When the app
// language is known only its rules run (English always works): read all at
// once, French "hier" (yesterday) turns German "hier" (here) into a deadline.
const NORMALIZERS: Partial<Record<AppLanguage, (lower: string) => string>> = {
  fr: normalizeFrenchDatePhrase,
  es: normalizeSpanishDatePhrase,
  de: normalizeGermanDatePhrase,
};

function normalizeDatePhrase(lower: string, language?: AppLanguage): string {
  if (language) return NORMALIZERS[language]?.(lower) ?? lower;
  return Object.values(NORMALIZERS).reduce((text, normalize) => normalize(text), lower);
}

// "7pm", "7 pm", "7 p.m.", "7:30am" — voice transcription writes the dotted form.
const MERIDIEM_PATTERN = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/;
const EXPLICIT_TIME_PATTERN = /\b(?:\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)(?![a-z])|at\s+\d{1,2}(?::\d{2})?\b|\d{1,2}:\d{2}\b|noon\b|midday\b|midnight\b)/;

// Whether the user gave an actual clock time ("7 p.m.", "at 9", "noon") —
// used so a deadline only shows a time when one was really said, rather
// than the DEFAULT_HOUR filled in for a bare date.
export function hasExplicitTime(text: string, language?: AppLanguage): boolean {
  return EXPLICIT_TIME_PATTERN.test(normalizeDatePhrase(text.toLowerCase(), language));
}

function toCount(word: string | undefined): number | undefined {
  if (!word) return undefined;
  const digits = Number.parseInt(word, 10);
  if (!Number.isNaN(digits)) return digits;
  return COUNT_WORDS[word];
}

// "at 5", "5pm", "17:30", "noon", "tomorrow morning" — the time rides along
// with whichever day the phrase resolves to, so "today at 3pm" and "friday
// at 9am" both keep the hour the user actually said.
function extractTimeOfDay(lower: string): TimeOfDay | undefined {
  if (/\b(noon|midday)\b/.test(lower)) return { hour: 12, minute: 0 };
  if (/\bmidnight\b/.test(lower)) return { hour: 0, minute: 0 };

  const meridiem = lower.match(MERIDIEM_PATTERN);
  if (meridiem) {
    const hour12 = Number.parseInt(meridiem[1], 10) % 12;
    return {
      hour: meridiem[3].startsWith("p") ? hour12 + 12 : hour12,
      minute: meridiem[2] ? Number.parseInt(meridiem[2], 10) : 0,
    };
  }

  const clock = lower.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/);
  if (clock) {
    const hour = Number.parseInt(clock[1], 10);
    const minute = clock[2] ? Number.parseInt(clock[2], 10) : 0;
    if (hour <= 23 && minute <= 59) {
      // "tomorrow evening at 8" is 20:00, not 8am.
      if (hour < 12 && /\b(afternoon|evening|tonight)\b/.test(lower)) return { hour: hour + 12, minute };
      // A bare "at 7" means the evening far more often than 7am; hours that
      // can only be one thing on a 24h clock are left alone.
      return { hour: clock[2] === undefined && hour >= 1 && hour <= 7 ? hour + 12 : hour, minute };
    }
  }

  if (/\bmorning\b/.test(lower)) return { hour: 9, minute: 0 };
  if (/\bafternoon\b/.test(lower)) return { hour: 14, minute: 0 };
  if (/\b(evening|tonight)\b/.test(lower)) return { hour: 20, minute: 0 };
  return undefined;
}

export function parseDatePhrase(text: string, now: Date = new Date(), language?: AppLanguage): string | undefined {
  const lower = normalizeDatePhrase(text.toLowerCase(), language);
  const time = extractTimeOfDay(lower);

  const resolve = (date: Date, fallbackHour = DEFAULT_HOUR): string | undefined => {
    date.setHours(time?.hour ?? fallbackHour, time?.minute ?? 0, 0, 0);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  };

  const byDays = (days: number): Date => {
    const date = new Date(now);
    date.setDate(date.getDate() + days);
    return date;
  };

  const byMonths = (months: number): Date => {
    const date = new Date(now);
    date.setMonth(date.getMonth() + months);
    return date;
  };

  // Checked before "tomorrow" — it contains the word.
  if (/\bday after tomorrow\b/.test(lower)) return resolve(byDays(2));
  // Misspelling this is common enough ("tommorow", "tomorow") that matching
  // only the correct spelling loses real deadlines.
  if (/\btom+or+ow\b/.test(lower)) return resolve(byDays(1));
  if (/\byesterday\b/.test(lower)) return resolve(byDays(-1));
  if (/\b(today|tonight|this evening|this afternoon|this morning)\b/.test(lower)) return resolve(new Date(now));
  if (/\basap\b|\bright now\b|\bimmediately\b/.test(lower)) return resolve(new Date(now));

  const ago = lower.match(new RegExp(`\\b(${COUNT_PATTERN})\\s+(day|week|month|hour)s?\\s+ago\\b`));
  if (ago) {
    const count = toCount(ago[1]);
    if (count !== undefined) {
      if (ago[2] === "hour") return resolve(new Date(now.getTime() - count * 60 * 60 * 1000));
      if (ago[2] === "month") return resolve(byMonths(-count));
      return resolve(byDays(ago[2] === "week" ? -count * 7 : -count));
    }
  }

  const within = lower.match(new RegExp(`\\bin\\s+(?:the\\s+next\\s+)?(${COUNT_PATTERN})\\s+(day|week|month|hour|minute)s?\\b`));
  if (within) {
    const count = toCount(within[1]);
    if (count !== undefined) {
      if (within[2] === "minute") return resolve(new Date(now.getTime() + count * 60 * 1000));
      if (within[2] === "hour") return resolve(new Date(now.getTime() + count * 60 * 60 * 1000));
      if (within[2] === "month") return resolve(byMonths(count));
      return resolve(byDays(within[2] === "week" ? count * 7 : count));
    }
  }

  if (/\blast week\b/.test(lower)) return resolve(byDays(-7));
  if (/\blast month\b/.test(lower)) return resolve(byMonths(-1));
  if (/\bnext month\b/.test(lower)) return resolve(byMonths(1));

  if (/\bnext weekend\b/.test(lower)) {
    const date = byDays(7);
    date.setDate(date.getDate() + ((6 - date.getDay() + 7) % 7));
    return resolve(date, 12);
  }

  if (/\b(this |the )?weekend\b/.test(lower)) {
    const date = new Date(now);
    date.setDate(date.getDate() + ((6 - date.getDay() + 7) % 7));
    return resolve(date, 12);
  }

  if (/\bend of (the )?month\b/.test(lower)) {
    const date = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return resolve(date);
  }

  if (/\b(end of (the )?week|by friday)\b/.test(lower)) {
    const date = new Date(now);
    date.setDate(date.getDate() + ((5 - date.getDay() + 7) % 7));
    return resolve(date);
  }

  if (/\bnext week\b/.test(lower)) return resolve(byDays(7));

  // An explicit calendar date is checked before weekdays and bare clock
  // times — "25th September at 7 p.m." used to stop at "at 7" and land on
  // today/tomorrow.
  const iso = lower.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    return resolve(new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  }

  // "march 5", "5 march", "sept 20", "september 25th", "the 25th of september"
  // — the year is whichever keeps it closest to now, so a month already past
  // this year reads as next year.
  for (let i = 0; i < MONTHS.length; i += 1) {
    const name = `(?:${MONTH_ALTERNATIVES[i].join("|")})`;
    const ordinal = "(?:st|nd|rd|th)?";
    const match = lower.match(
      new RegExp(`\\b(?:${name}\\.?\\s+(?:the\\s+)?(\\d{1,2})${ordinal}|(\\d{1,2})${ordinal}\\s+(?:of\\s+)?${name})\\b`),
    );
    if (!match) continue;
    const day = Number.parseInt(match[1] ?? match[2], 10);
    if (!day || day > 31) continue;
    const date = new Date(now.getFullYear(), i, day);
    if (date.getTime() < now.getTime() - 180 * 24 * 60 * 60 * 1000) date.setFullYear(date.getFullYear() + 1);
    return resolve(date);
  }

  for (let i = 0; i < WEEKDAYS.length; i += 1) {
    if (!new RegExp(`\\b${WEEKDAYS[i]}\\b`).test(lower)) continue;
    const date = new Date(now);
    if (new RegExp(`\\blast\\s+${WEEKDAYS[i]}\\b`).test(lower)) {
      const diff = (date.getDay() - i + 7) % 7 || 7; // most recent past one
      date.setDate(date.getDate() - diff);
      return resolve(date);
    }
    const diff = (i - date.getDay() + 7) % 7 || 7; // next occurrence, never today
    date.setDate(date.getDate() + (new RegExp(`\\bnext\\s+${WEEKDAYS[i]}\\b`).test(lower) ? diff + 7 : diff));
    return resolve(date);
  }

  // A bare clock time with no day ("gym at 6pm") means today, or tomorrow
  // if that hour has already passed. Only explicit clock times qualify —
  // "morning"/"evening" alone are too weak to invent a deadline from.
  if (time && EXPLICIT_TIME_PATTERN.test(lower)) {
    const today = resolve(new Date(now));
    if (today && new Date(today).getTime() >= now.getTime()) return today;
    return resolve(byDays(1));
  }

  return undefined;
}
