// The quick-add line on Add Task: one typed line — "Dentist Friday 3pm every
// month p1" — read into a task's fields with plain rules on the phone. No AI,
// so it costs nothing and is on every plan; Pro can hand a line the rules
// can't read to the AI instead (app/add.tsx).
//
// The words each rule reads are taken out of the title, so "Call mom tomorrow
// at 6 for 20 min" is a task called "Call mom", due tomorrow at 18:00, 20
// minutes long. Which words those are is found by asking the rules
// themselves: a word belongs to the deadline if taking it out changes the
// deadline read. That works the same in every language the rules know,
// without a second list of date words to keep in step.

import { isAmbiguousDate, parseDeadlinePhrase, type ParsedDeadline } from "@/lib/ai/parseDate";
import { guessDuration, guessPriorityLevel, parseDurationMinutes, stripTitleScaffolding } from "@/lib/ai/extractTasks";
import type { DeadlineInput } from "@/lib/deadline";
import { toLocalDateKey } from "@/lib/localDate";
import type { RuleInput } from "@/lib/recurrence";
import { findRepeat, mentionsWeekday } from "@/lib/repeatPhrase";
import type { ImportanceLevel } from "@/lib/scoring";
import type { AppLanguage } from "@/types/settings";

export type QuickAddResult = {
  /** What's left once the rules have taken their words out. Empty if nothing is. */
  title: string;
  /** Today when no day was typed, none when "no deadline" was. */
  deadline?: DeadlineInput;
  /** A day or time was read from the line (rather than today by default). */
  deadlineTyped: boolean;
  estimatedMinutes: number;
  /** A length was typed ("for 20 min") rather than guessed from the words. */
  durationTyped: boolean;
  priorityLevel: ImportanceLevel;
  recurrence?: RuleInput;
  /**
   * The line is likely to be read better by the AI: a date the rules couldn't
   * read ("3/4", a weekday left in the title) or a long, rambling line.
   */
  unclear: boolean;
  /** It reads like a change to a task that already exists ("move the dentist to Friday"). */
  looksLikeChange: boolean;
  /**
   * Where the words the rules read sit in the line as typed — the day and
   * time, the length, the repeat, a p1–p3 — so Add Task can mark them as
   * they're typed. Ordered, never overlapping. Reading only: nothing above
   * depends on it.
   */
  highlights: { start: number; end: number }[];
};

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, (char) => `\\${char}`);
}

/** Each phrase's place in the line as typed, the first free match for each. */
function locatePhrases(line: string, phrases: string[]): { start: number; end: number }[] {
  const found: { start: number; end: number }[] = [];
  for (const phrase of phrases) {
    const words = phrase.split(" ").filter(Boolean);
    if (words.length === 0) continue;
    const pattern = new RegExp(words.map(escapeForRegExp).join("\\s+"), "gi");
    for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
      const start = match.index;
      const end = start + match[0].length;
      if (match[0].length === 0) break;
      if (found.every((range) => end <= range.start || start >= range.end)) {
        found.push({ start, end });
        break;
      }
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

/** Runs of neighbouring marked words, as phrases. */
function markedPhrases(words: string[], marked: Set<number>): string[] {
  const phrases: string[] = [];
  let run: string[] = [];
  words.forEach((word, index) => {
    if (marked.has(index)) {
      run.push(word);
    } else if (run.length > 0) {
      phrases.push(run.join(" "));
      run = [];
    }
  });
  if (run.length > 0) phrases.push(run.join(" "));
  return phrases;
}

// Todoist's p1–p3, for people who type them out of habit.
const PRIORITY_TOKENS: Record<string, ImportanceLevel> = { "1": "high", "2": "medium", "3": "low" };
const PRIORITY_TOKEN = /(^|\s)p([1-3])(?=\s|$)/gi;

const LETTER = "a-zß-ÿœæ";
const NO_DEADLINE = new RegExp(
  `(^|[^${LETTER}])(?:no deadline|no due date|no date|sans (?:date|échéance)|pas de date|sin fecha(?: l[íi]mite)?|ohne (?:datum|frist|termin))(?![${LETTER}])`,
  "i",
);

// Importance said at the start ("urgent:") or the end ("…, not urgent") is
// read by guessPriorityLevel and then dropped from the title. In the middle
// it may be part of the task's name ("important meeting"), so it stays.
const PRIORITY_WORDS =
  "not urgent|no rush|urgent|asap|important|high priority|top priority|low priority|pas urgente?|urgente?|importante?|prioritaire|sin prisa|no urgente|nicht dringend|dringend|wichtig|eilig";
const PRIORITY_AT_END = new RegExp(`[\\s,;:–-]+(?:${PRIORITY_WORDS})[!.]*$`, "i");
const PRIORITY_AT_START = new RegExp(`^(?:${PRIORITY_WORDS})(?:!+|\\s*[,;:–-])\\s*`, "i");

// Small words that tie a deadline or a length to the rest of the line ("on
// Friday", "le vendredi", "am Freitag", "for 20 min"). They go with the words
// next to them, never on their own.
const DATE_CONNECTORS = new Set([
  "on", "by", "at", "before", "due", "until", "till", "the", "of", "in", "next", "this", "last", "for", "from", "starting", "around", "@",
  "le", "la", "les", "l'", "au", "à", "a", "avant", "pour", "d'ici", "dès", "ce", "cette", "prochain", "prochaine", "vers", "en", "de", "du", "dans", "partir",
  "el", "los", "las", "antes", "del", "para", "hasta", "este", "esta", "próximo", "próxima", "desde", "sobre", "hacia",
  "am", "um", "bis", "vor", "zum", "zur", "ab", "den", "dem", "der", "diesen", "diese", "dieser", "nächsten", "nächste", "kommenden", "gegen", "im", "an", "spätestens",
]);
// Ones that come after the day or hour instead: "vendredi prochain", "15 Uhr", "7 o'clock".
const DATE_TRAILERS = new Set(["prochain", "prochaine", "dernier", "dernière", "próximo", "próxima", "pasado", "pasada", "uhr", "h", "o'clock"]);
const DURATION_CONNECTORS = new Set([
  "for", "takes", "take", "lasting", "about", "around", "approx", "~",
  "pendant", "durant", "environ", "durante", "unos", "unas", "für", "ca", "ca.", "etwa", "dauert",
]);

// Verbs that open a change to an existing task. With a day in the line, or
// "my"/"all"/"tasks", the line is most likely about tasks already there.
const CHANGE_VERB =
  /^(?:please\s+)?(?:move|push|postpone|reschedule|delete|remove|rename|mark|d[ée]place[rz]?|repousse[rz]?|reporte[rz]?|supprime[rz]?|mueve|p[oó]sp[oó]n|posponer|aplaza|borra|elimina|verschieb\w*|l[öo]sch\w*|entfern\w*)\b/i;
const EXISTING_TASKS =
  /\b(?:my|all|everything|tasks?|mes|toutes?|t[âa]ches?|mis|todas?|tareas?|meine|alle|aufgaben?)\b/i;

/** Past this many words, a line is more of a ramble than a task — the AI reads those better. */
const LONG_LINE_WORDS = 12;

function sameDeadline(a: ParsedDeadline | undefined, b: ParsedDeadline | undefined): boolean {
  return !!a && !!b && a.date === b.date && a.time === b.time;
}

function bare(word: string): string {
  return word.toLowerCase().replace(/^[("'«]+|[)"'».,;:!?]+$/g, "");
}

/**
 * Which words a rule reads: each word whose removal changes what `read`
 * returns, plus the small connecting words right before them (and, for dates,
 * the few that come after).
 */
function wordsReadBy<T>(
  words: string[],
  read: (text: string) => T | undefined,
  same: (a: T | undefined, b: T | undefined) => boolean,
  connectors: Set<string>,
  trailers: Set<string> = new Set(),
): Set<number> {
  const marked = new Set<number>();
  const whole = read(words.join(" "));
  if (whole === undefined) return marked;
  words.forEach((_, index) => {
    const without = words.filter((__, other) => other !== index).join(" ");
    if (!same(read(without), whole)) marked.add(index);
  });
  if (marked.size === 0) return marked;
  for (const index of [...marked].sort((a, b) => a - b)) {
    for (let left = index - 1; left >= 0 && !marked.has(left) && connectors.has(bare(words[left])); left -= 1) marked.add(left);
    for (let right = index + 1; right < words.length && !marked.has(right) && trailers.has(bare(words[right])); right += 1) marked.add(right);
  }
  return marked;
}

function cleanUpTitle(text: string): string {
  const trimmed = stripTitleScaffolding(
    text
      .replace(PRIORITY_AT_START, "")
      .replace(PRIORITY_AT_END, "")
      .replace(/\s{2,}/g, " ")
      .trim(),
    { keepPriorityWords: true },
  )
    .replace(/^[\s,;:.–-]+|[\s,;:–-]+$/g, "")
    .trim();
  return trimmed.charAt(0).toLocaleUpperCase() + trimmed.slice(1);
}

export function parseQuickAdd(line: string, now: Date = new Date(), language?: AppLanguage): QuickAddResult {
  let text = line.replace(/\s+/g, " ").trim();

  // The phrases the rules read, to be found again in the line (highlights).
  const readPhrases: string[] = [];

  let tokenPriority: ImportanceLevel | undefined;
  text = text.replace(PRIORITY_TOKEN, (whole: string, lead: string, level: string) => {
    tokenPriority ??= PRIORITY_TOKENS[level];
    readPhrases.push(whole.slice(lead.length));
    return lead;
  });

  let noDeadline = false;
  text = text.replace(NO_DEADLINE, (whole: string, lead: string) => {
    noDeadline = true;
    readPhrases.push(whole.slice(lead.length));
    return `${lead} `;
  });

  // The repeat first: "every Monday" would otherwise also be read as next Monday's deadline.
  const repeat = findRepeat(text, now, language);
  if (repeat) {
    readPhrases.push(text.slice(repeat.start, repeat.end).trim());
    text = `${text.slice(0, repeat.start)} ${text.slice(repeat.end)}`;
  }

  let words = text.split(" ").filter(Boolean);

  // The deadline, and the words it was read from.
  const readDeadline = (phrase: string) => parseDeadlinePhrase(phrase, now, language);
  const typedDeadline = noDeadline ? undefined : readDeadline(words.join(" "));
  const ambiguous = !typedDeadline && isAmbiguousDate(words.join(" "), language);
  if (typedDeadline) {
    const dateWords = wordsReadBy(words, readDeadline, sameDeadline, DATE_CONNECTORS, DATE_TRAILERS);
    readPhrases.push(...markedPhrases(words, dateWords));
    words = words.filter((_, index) => !dateWords.has(index));
  }

  // A stated length ("for 20 min"), and its words. "In 2 hours" is a deadline
  // and has already gone with it.
  const typedMinutes = parseDurationMinutes(words.join(" "));
  if (typedMinutes !== undefined) {
    const lengthWords = wordsReadBy(words, parseDurationMinutes, (a, b) => a === b, DURATION_CONNECTORS);
    readPhrases.push(...markedPhrases(words, lengthWords));
    words = words.filter((_, index) => !lengthWords.has(index));
  }

  const title = cleanUpTitle(words.join(" "));
  const deadline: DeadlineInput | undefined = noDeadline
    ? undefined
    : typedDeadline
      ? { date: typedDeadline.date, ...(typedDeadline.time ? { time: typedDeadline.time } : {}) }
      : { date: toLocalDateKey(now) };

  // A time said with the repeat ("every Monday at 9") is every occurrence's time.
  const recurrence: RuleInput | undefined = repeat
    ? { ...repeat.rule, ...(typedDeadline?.time ? { time: typedDeadline.time } : {}) }
    : undefined;

  const wordCount = line.trim().split(/\s+/).filter(Boolean).length;
  // "buy milk, call mom; email Sam": several tasks in one line. The rules keep
  // it as one (splitting on commas would break "Dinner with Ann, Bob and
  // Carl"); the AI can tell them apart.
  const severalTasks = line.split(/[,;\n]/).filter((part) => part.trim().split(/\s+/).length >= 2).length >= 2;
  const looksLikeChange = CHANGE_VERB.test(line.trim()) && (!!typedDeadline || EXISTING_TASKS.test(line));

  return {
    title,
    deadline,
    deadlineTyped: !!typedDeadline,
    estimatedMinutes: typedMinutes ?? guessDuration(title || line),
    durationTyped: typedMinutes !== undefined,
    priorityLevel: tokenPriority ?? guessPriorityLevel(line),
    recurrence,
    unclear:
      ambiguous ||
      severalTasks ||
      wordCount > LONG_LINE_WORDS ||
      (!typedDeadline && !repeat && mentionsWeekday(title, language)),
    looksLikeChange,
    highlights: locatePhrases(line, readPhrases),
  };
}
