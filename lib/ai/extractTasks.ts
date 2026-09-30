import { parseDeadlinePhrase } from "@/lib/ai/parseDate";
import type { ExtractedTaskDraft } from "@/lib/ai/types";
import { deadlineInstant, makeDeadline } from "@/lib/deadline";
import type { ImportanceLevel } from "@/lib/scoring";
import type { AppLanguage } from "@/types/settings";

const LONG_TASK_KEYWORDS = /\b(write|study|prepare|build|plan|research|essay|report|presentation|thesis|revise|design)\b/i;
const QUICK_TASK_KEYWORDS = /\b(call|email|text|book|order|pay|send|reply|buy|pick up|drop off|check|confirm)\b/i;

// English, French, Spanish and German — the inbox route reads stated
// importance straight off the user's own words, whichever language they typed in.

// Importance stressed outright — "critical" (importance 100), a step above High.
const CRITICAL_PRIORITY_KEYWORDS =
  /\b((?:really|very|super|extremely|incredibly|highly|hugely|vitally|so) important|most important|top priority|highest priority|number one priority|critical|crucial|life or death|(?:tr[eè]s|vraiment|super|extr[eê]mement|hyper) importante?|priorit[eé] absolue|primordiale?|cruciale?|(?:muy|super|realmente|extremadamente) importante|important[ií]sim[oa]|m[aá]xima prioridad|prioridad (?:m[aá]xima|absoluta)|lo m[aá]s importante|(?:sehr|extrem|super|wirklich|echt|total) wichtig(?:e[nrs]?)?|h[öo]chste priorit[äa]t|oberste priorit[äa]t|am wichtigsten|entscheidend)\b/i;

const HIGH_PRIORITY_KEYWORDS =
  /\b(urgent|urgently|asap|immediately|critical|important|importance|high priority|top priority|emergency|overdue|exam|midterm|finals?|interview|deadline|urgente?|prioritaire|critique|examen|entretien|importante|prioritari[oa]|cr[íi]tic[oa]|emergencia|entrevista|cuanto antes|dringend(?:e[nrs]?)?|wichtig(?:e[nrs]?)?|eilig(?:e[nrs]?)?|kritisch(?:e[nrs]?)?|sofort|notfall|pr[üu]fung|klausur|vorstellungsgespr[äa]ch|hohe priorit[äa]t)\b/i;

// An explicit length the user stated ("for two hours", "takes 45 min",
// "1.5h", "pendant deux heures", "media hora", "eine halbe Stunde"). "in 2
// hours" / "2 hours ago" are deadlines, not durations, so the word before and
// after the match is captured and checked.
const DURATION_PATTERN =
  /(?:\b(\w+)\s+)?\b(?:(\d+(?:\.\d+)?)\s*(h|hrs?|hours?|heures?|horas?|stunden?|std|m|mins?|minutes?|minutos?|minuten)|(an?|one|two|three|four|five|six|seven|eight|nine|ten|une|deux|trois|quatre|cinq|sept|huit|neuf|dix|un|una|media|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|eine?|einer?|halbe|anderthalb|eineinhalb|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn)\s+(hrs?|hours?|heures?|horas?|stunden?|mins?|minutes?|minutos?|minuten))\b(\s+ago\b)?/gi;
const DURATION_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  une: 1,
  un: 1,
  una: 1,
  ein: 1,
  eine: 1,
  einer: 1,
  media: 0.5,
  halbe: 0.5,
  anderthalb: 1.5,
  eineinhalb: 1.5,
  two: 2,
  deux: 2,
  dos: 2,
  zwei: 2,
  three: 3,
  trois: 3,
  tres: 3,
  drei: 3,
  four: 4,
  quatre: 4,
  cuatro: 4,
  vier: 4,
  five: 5,
  cinq: 5,
  cinco: 5,
  fünf: 5,
  six: 6,
  seis: 6,
  sechs: 6,
  seven: 7,
  sept: 7,
  siete: 7,
  sieben: 7,
  eight: 8,
  huit: 8,
  ocho: 8,
  acht: 8,
  nine: 9,
  neuf: 9,
  nueve: 9,
  neun: 9,
  ten: 10,
  dix: 10,
  diez: 10,
  zehn: 10,
};
// Checked before the high-priority words — "pas urgent", "no es urgente" and
// "nicht dringend" all contain a high-priority word.
const LOW_PRIORITY_KEYWORDS =
  /\b(someday|eventually|whenever|sometime|no rush|not (?:really |that |very |so |too )?urgent|not (?:really |that |very |so |too )?important|low priority|low importance|if i have time|maybe|at some point|pas urgente?|pas (?:tr[eè]s |si |vraiment |super )?importante?|pas press|rien ne presse|un jour|quand j'ai le temps|si j'ai le temps|peut-[eê]tre|priorit[ée] basse|no (?:es )?urgente|no es (?:muy |tan |realmente )?importante|sin prisa|no (?:hay|corre) prisa|alg[úu]n d[íi]a|cuando (?:pueda|tenga tiempo)|si tengo tiempo|tal vez|quiz[áa]s|a lo mejor|prioridad baja|baja prioridad|nicht (?:so |sehr |wirklich |besonders )?(?:dringend|wichtig|eilig)|unwichtig|keine eile|eilt nicht|hat zeit|irgendwann|(?:wenn|falls) ich zeit habe|vielleicht|niedrige priorit[äa]t)\b/i;

/** Identifies one preview card for its whole life — see ExtractedTaskDraft.candidateId. */
export function createCandidateId(): string {
  return `cand-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const DEFAULT_MINUTES = 30;
const LONG_TASK_MINUTES = 60;
const QUICK_TASK_MINUTES = 15;

// Scaffolding people put in front of the actual task. Stripped so the title
// is what they need to do, never the instruction that introduced it —
// "add work tomorrow" is a task called "Work", not "Add work tomorrow".
const COMMAND_PREFIX_PATTERN =
  /^\s*(?:(?:hey|ok|okay|please|pls)\s+)?(?:can you\s+|could you\s+|would you\s+)?(?:add|create|make|set up|new task|task|remind me|remember)\b[:,\s]*(?:an?\s+|the\s+)?(?:task\s+)?(?:to\s+|for\s+|about\s+|that\s+)?/i;
const OBLIGATION_PREFIX_PATTERN = /^\s*(?:i\s+)?(?:need to|needs to|have to|has to|want to|gotta|got to|must|should)\s+/i;
// Urgency markers belong in priorityLevel (read off the raw fragment), not
// in the title — "urgent: send the proposal" is a task called "Send the
// proposal".
const PRIORITY_PREFIX_PATTERN = /^\s*(?:urgent|urgently|important|asap|high priority|priority)\b[:,\-\s]*/i;

// Deadline wording, removed from the title once parseDatePhrase has already
// read it off the original text — it belongs in dueDate, not in the name.
const RELATIVE_DAY = String.raw`day after tom+or+ow|tom+or+ow|yesterday|today|tonight|this (?:morning|afternoon|evening|weekend)|next (?:week|month|weekend)|last (?:week|month)|this week|end of (?:the )?(?:week|month)|in (?:the next )?\w+ (?:day|week|month|hour|minute)s?|\w+ (?:day|week|month|hour)s? ago|(?:next |last |this )?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|asap`;
const CLOCK = String.raw`\d{1,2}(?::\d{2})?\s*(?:am|pm)|at\s+\d{1,2}(?::\d{2})?|noon|midnight`;
const VAGUE_TIMING = String.raw`sometime|someday|eventually|whenever|at some point|no rush`;
const DATE_PHRASE_PATTERN = new RegExp(
  String.raw`\s*\b(?:by|on|before|due|until|till|for|at)?\s*(?:${RELATIVE_DAY}|${CLOCK}|${VAGUE_TIMING})\b`,
  "gi",
);

// A clause continuing the previous one ("..., it was due last week") is not
// a second task — splitting on commas turns it into one otherwise.
const CONTINUATION_PATTERN = /^\s*(?:it|its|it's|that|this|they|these|those|he|she|which|who|but|so)\b/i;

// A question is a query about existing tasks, not a new one — unless it
// also carries an explicit add verb ("can you add milk to my list").
const QUESTION_PATTERN =
  /^\s*(what|when|where|why|how|who|which|is|are|am|do|does|did|can|could|should|would|will|has|have)\b/i;
const EXPLICIT_ADD_PATTERN = /\b(add|create|remind me|new task|put)\b/i;
const CHITCHAT_PATTERN = /^\s*(hi|hey|hello|yo|thanks|thank you|ok|okay|cool|nice|sure|yes|no|nope|yep|help)\b[\s!.?]*$/i;

// Exported so app/api/inbox+api.ts can fill the same gaps when the model
// leaves a field out.
export function parseDurationMinutes(text: string): number | undefined {
  for (const match of text.matchAll(DURATION_PATTERN)) {
    const [, before, digits, digitUnit, words, wordUnit, ago] = match;
    if (ago || /^(in|within|dans|en|hace|vor)$/i.test(before ?? "")) continue;
    const amountText = (digits ?? words).toLowerCase();
    // "half an hour" — "half" lands in the word-before capture.
    const amount = /^half$/i.test(before ?? "") ? 0.5 : (DURATION_WORDS[amountText] ?? Number.parseFloat(amountText));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    return Math.round(/^(h|st)/i.test(digitUnit ?? wordUnit) ? amount * 60 : amount);
  }
  return undefined;
}

export function guessDuration(text: string): number {
  const stated = parseDurationMinutes(text);
  if (stated) return stated;
  if (LONG_TASK_KEYWORDS.test(text)) return LONG_TASK_MINUTES;
  if (QUICK_TASK_KEYWORDS.test(text)) return QUICK_TASK_MINUTES;
  return DEFAULT_MINUTES;
}

// Importance only — the deadline is scored separately as urgency in
// lib/priority.ts, so it must not leak in here too.
export function guessPriorityLevel(text: string): ImportanceLevel {
  // Low first — "not urgent" and "not really important" contain the words
  // above them.
  if (LOW_PRIORITY_KEYWORDS.test(text)) return "low";
  if (CRITICAL_PRIORITY_KEYWORDS.test(text)) return "critical";
  if (HIGH_PRIORITY_KEYWORDS.test(text)) return "high";
  return "medium";
}

function cleanTitle(fragment: string): string {
  const stripped = fragment
    .replace(PRIORITY_PREFIX_PATTERN, "")
    .replace(COMMAND_PREFIX_PATTERN, "")
    .replace(OBLIGATION_PREFIX_PATTERN, "")
    .replace(/^(and|then|also|plus)\s+/i, "")
    .trim();

  const withoutDates = stripped.replace(DATE_PHRASE_PATTERN, " ").replace(/\s{2,}/g, " ").trim();
  // Removing the deadline can consume the whole fragment ("tomorrow") — in
  // that case the wording itself is all the user gave us, so keep it.
  const base = withoutDates.length >= 2 ? withoutDates : stripped;

  return base
    .replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, "")
    .replace(/^./, (char) => char.toUpperCase());
}

function looksLikeTask(fragment: string): boolean {
  if (fragment.trim().length < 2) return false;
  if (!/[a-z]/i.test(fragment)) return false;
  if (CHITCHAT_PATTERN.test(fragment)) return false;
  if (CONTINUATION_PATTERN.test(fragment)) return false;
  if ((QUESTION_PATTERN.test(fragment) || /\?\s*$/.test(fragment)) && !EXPLICIT_ADD_PATTERN.test(fragment)) {
    return false;
  }
  return true;
}

// Splits a brain-dump message into individual task drafts. Deliberately
// simple sentence/keyword splitting, not general NLU — this is the offline
// fallback for when /api/inbox can't be reached.
export function extractTasks(text: string, now: Date = new Date(), language?: AppLanguage): ExtractedTaskDraft[] {
  const fragments = text
    .split(/\n|,| and then | and |;/i)
    .map((fragment) => fragment.trim())
    .filter(looksLikeTask);

  return fragments
    .map((fragment) => {
      // With a single task in the message, a deadline anywhere in it belongs
      // to that task — including in a clause dropped as a continuation
      // ("pay the electricity bill, it was due last week").
      const parsed =
        parseDeadlinePhrase(fragment, now, language) ??
        (fragments.length === 1 ? parseDeadlinePhrase(text, now, language) : undefined);
      // A day with no clock time stays date-only (lib/deadline.ts).
      const deadline = parsed ? makeDeadline(parsed) : undefined;
      const title = cleanTitle(fragment);
      return {
        candidateId: createCandidateId(),
        title,
        estimatedMinutes: guessDuration(fragment),
        dueDate: deadline ? deadlineInstant(deadline).toISOString() : undefined,
        dueHasTime: deadline ? !!deadline.time : undefined,
        priorityLevel: guessPriorityLevel(fragment),
      };
    })
    .filter((draft) => draft.title.length > 0);
}
