import { hasExplicitTime, parseDatePhrase } from "@/lib/ai/parseDate";
import type { ExtractedTaskDraft } from "@/lib/ai/types";
import type { TaskPriorityLevel } from "@/types/task";

const LONG_TASK_KEYWORDS = /\b(write|study|prepare|build|plan|research|essay|report|presentation|thesis|revise|design)\b/i;
const QUICK_TASK_KEYWORDS = /\b(call|email|text|book|order|pay|send|reply|buy|pick up|drop off|check|confirm)\b/i;

// English and French — the inbox route reads stated importance straight off
// the user's own words, whichever language they typed in.
const HIGH_PRIORITY_KEYWORDS =
  /\b(urgent|urgently|asap|immediately|critical|important|importance|high priority|top priority|emergency|overdue|exam|midterm|finals?|interview|deadline|urgente?|prioritaire|critique|examen|entretien)\b/i;

// An explicit length the user stated ("for two hours", "takes 45 min",
// "1.5h", "pendant deux heures"). "in 2 hours" / "2 hours ago" are deadlines,
// not durations, so the word before and after the match is captured and checked.
const DURATION_PATTERN =
  /(?:\b(\w+)\s+)?\b(?:(\d+(?:\.\d+)?)\s*(h|hrs?|hours?|heures?|m|mins?|minutes?)|(an?|one|two|three|four|five|six|seven|eight|nine|ten|une|deux|trois|quatre|cinq|sept|huit|neuf|dix)\s+(hrs?|hours?|heures?|mins?|minutes?))\b(\s+ago\b)?/gi;
const DURATION_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  une: 1,
  two: 2,
  deux: 2,
  three: 3,
  trois: 3,
  four: 4,
  quatre: 4,
  five: 5,
  cinq: 5,
  six: 6,
  seven: 7,
  sept: 7,
  eight: 8,
  huit: 8,
  nine: 9,
  neuf: 9,
  ten: 10,
  dix: 10,
};
// Checked before the high-priority words — "pas urgent" contains "urgent".
const LOW_PRIORITY_KEYWORDS =
  /\b(someday|eventually|whenever|sometime|no rush|not urgent|not important|low priority|low importance|if i have time|maybe|at some point|pas urgente?|pas important|pas press|rien ne presse|un jour|quand j'ai le temps|si j'ai le temps|peut-[eê]tre|priorit[ée] basse)\b/i;

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
    if (ago || /^(in|within|dans)$/i.test(before ?? "")) continue;
    const amountText = (digits ?? words).toLowerCase();
    // "half an hour" — "half" lands in the word-before capture.
    const amount = /^half$/i.test(before ?? "") ? 0.5 : (DURATION_WORDS[amountText] ?? Number.parseFloat(amountText));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    return Math.round(/^h/i.test(digitUnit ?? wordUnit) ? amount * 60 : amount);
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
// lib/scoring.ts, so it must not leak in here too.
export function guessPriorityLevel(text: string): TaskPriorityLevel {
  // Low first — "not urgent" and "low priority" contain high-priority words.
  if (LOW_PRIORITY_KEYWORDS.test(text)) return "low";
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
export function extractTasks(text: string, now: Date = new Date()): ExtractedTaskDraft[] {
  const fragments = text
    .split(/\n|,| and then | and |;/i)
    .map((fragment) => fragment.trim())
    .filter(looksLikeTask);

  return fragments
    .map((fragment) => {
      // With a single task in the message, a deadline anywhere in it belongs
      // to that task — including in a clause dropped as a continuation
      // ("pay the electricity bill, it was due last week").
      const ownDueDate = parseDatePhrase(fragment, now);
      const dueDate = ownDueDate ?? (fragments.length === 1 ? parseDatePhrase(text, now) : undefined);
      const dueHasTime = dueDate ? hasExplicitTime(ownDueDate ? fragment : text) : undefined;
      const title = cleanTitle(fragment);
      return {
        title,
        estimatedMinutes: guessDuration(fragment),
        dueDate,
        dueHasTime,
        priorityLevel: guessPriorityLevel(fragment),
      };
    })
    .filter((draft) => draft.title.length > 0);
}
