import { TASK_REASSESSMENT_SYSTEM_PROMPT } from "@/data/aiPrompts";
import type { TaskContext } from "@/lib/ai/context";
import { generateStructuredJson, type GeminiJsonSchema } from "@/lib/ai/gemini";
import { languageInstruction } from "@/lib/ai/language";
import type { PlanStep } from "@/lib/ai/types";
import { authenticate, unauthorized } from "@/lib/serverAuth";
import {
  asObject,
  badRequest,
  BadRequestError,
  clampArray,
  clampNumber,
  clampString,
  LANGUAGES,
  MAX_ID_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_TITLE_LENGTH,
  oneOf,
  parsePlanSteps,
  parseTaskContext,
  readJsonBody,
} from "@/lib/serverRequest";
import type { DateShift } from "@/lib/taskOperations";
import type { AppLanguage } from "@/types/settings";
import type { TaskPriorityLevel } from "@/types/task";

/** An unfinished subtask as the model sees it — `id` is a short alias ("s1"), mapped back on the device. */
export type ReassessStep = { id: string; title: string; estimatedMinutes: number };

export type ReassessRequestBody = {
  task: TaskContext;
  /** Finished subtasks — read-only context, they stay finished. */
  doneSteps: PlanStep[];
  /** Unfinished subtasks, in order. */
  steps: ReassessStep[];
  /** Nexdo's current advice for the task, if it has any. */
  advice: string | null;
  /** What the user just told Nexdo about the task. */
  newContext: string;
  /** Set when newContext is an edit of an earlier note: the text it replaces. */
  replacesNote?: string;
  /** Set when newContext answers a question Nexdo asked about an earlier note. */
  clarification?: { note: string; question: string };
  /** "Wednesday, October 7, 2026, 10:00 (UTC+02:00)" — the user's own now. */
  today: string;
  language?: AppLanguage;
};

export type ReassessOutcome = "update" | "no_change" | "clarify";

/**
 * The model's decision, checked field by field. Every property is "no change"
 * when null — the app diffs this against the saved task before touching it,
 * and recomputes the score itself.
 */
export type ReassessResponseBody = {
  outcome: ReassessOutcome;
  /** Set only for "clarify". */
  question: string | null;
  title: string | null;
  description: string | null;
  /** English deadline words — resolved to a date on the device, in the user's time zone. */
  dueDatePhrase: string | null;
  dueDateShift: DateShift | null;
  removeDeadline: boolean;
  /** Aliases of unfinished steps the user says are now done. */
  stepsDone: string[];
  /** The whole new list of unfinished steps (alias to keep one, null for a new one), or null to keep them as they are. */
  steps: { id: string | null; title: string; estimatedMinutes: number }[] | null;
  estimatedMinutes: number | null;
  priority: TaskPriorityLevel | null;
  advice: string | null;
  summary: string;
};

const SHIFT_UNITS = ["minutes", "hours", "days", "weeks", "months"] as const;
const PRIORITIES = ["high", "medium", "low"] as const;
const OUTCOMES = ["update", "no_change", "clarify"] as const;

// Required-but-nullable, like the inbox schema: optional keys were routinely
// skipped by this model, while a required null makes it decide each field.
// estimatedMinutes comes after the steps, so the total is written once the
// steps it has to add up to already exist; "summary" last, so it describes
// fields that are already chosen.
const RESPONSE_SCHEMA: GeminiJsonSchema = {
  type: "OBJECT",
  properties: {
    outcome: { type: "STRING", enum: [...OUTCOMES] },
    question: { type: "STRING", nullable: true },
    title: { type: "STRING", nullable: true },
    description: { type: "STRING", nullable: true },
    dueDatePhrase: { type: "STRING", nullable: true },
    dueDateShift: {
      type: "OBJECT",
      nullable: true,
      properties: {
        amount: { type: "NUMBER" },
        unit: { type: "STRING", enum: [...SHIFT_UNITS] },
      },
      required: ["amount", "unit"],
    },
    removeDeadline: { type: "BOOLEAN", nullable: true },
    stepsDone: { type: "ARRAY", nullable: true, items: { type: "STRING" } },
    steps: {
      type: "ARRAY",
      nullable: true,
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING", nullable: true },
          title: { type: "STRING" },
          estimatedMinutes: { type: "NUMBER" },
        },
        required: ["id", "title", "estimatedMinutes"],
        propertyOrdering: ["id", "title", "estimatedMinutes"],
      },
    },
    estimatedMinutes: { type: "NUMBER", nullable: true },
    priority: { type: "STRING", enum: [...PRIORITIES], nullable: true },
    advice: { type: "STRING", nullable: true },
    summary: { type: "STRING" },
  },
  required: [
    "outcome",
    "question",
    "title",
    "description",
    "dueDatePhrase",
    "dueDateShift",
    "removeDeadline",
    "stepsDone",
    "steps",
    "estimatedMinutes",
    "priority",
    "advice",
    "summary",
  ],
  propertyOrdering: [
    "outcome",
    "question",
    "title",
    "description",
    "dueDatePhrase",
    "dueDateShift",
    "removeDeadline",
    "stepsDone",
    "steps",
    "estimatedMinutes",
    "priority",
    "advice",
    "summary",
  ],
};

// The model occasionally "thinks out loud" inside a string field. A real
// title is short prose; leaked reasoning is littered with the schema's names.
const LEAKED_REASONING_PATTERN = /\b(estimatedMinutes|dueDate\w*|stepsDone|outcome|priority|schema)\s*[:=]|\blet me reconsider\b/i;

const MAX_OUT_STEPS = 12;
const MAX_STEP_TITLE_LENGTH = 90;
const MAX_STEP_MINUTES = 24 * 60;
const MAX_TASK_MINUTES = 10_000;
const MAX_ADVICE_LENGTH = 400;
const MAX_SENTENCE_LENGTH = 300;
const MAX_PHRASE_LENGTH = 80;
/** Ten years either way — anything bigger is a garbled number, not a deadline move. */
const MAX_SHIFT_DAYS = 3_650;

function cleanText(value: unknown, max: number): string | null {
  const text = clampString(value, max);
  if (!text || LEAKED_REASONING_PATTERN.test(text)) return null;
  return text;
}

function normalizeShift(raw: unknown): DateShift | null {
  if (!raw || typeof raw !== "object") return null;
  const shift = asObject(raw);
  const unit = oneOf(shift.unit, SHIFT_UNITS);
  const amount = typeof shift.amount === "number" && Number.isFinite(shift.amount) ? Math.round(shift.amount) : 0;
  if (!unit || amount === 0) return null;
  const perDay = { minutes: 1 / 1440, hours: 1 / 24, days: 1, weeks: 7, months: 30 }[unit];
  return Math.abs(amount * perDay) <= MAX_SHIFT_DAYS ? { amount, unit } : null;
}

function normalizeSteps(raw: unknown): ReassessResponseBody["steps"] {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  return clampArray(raw, MAX_OUT_STEPS)
    .map((entry) => {
      const step = asObject(entry);
      const title = cleanText(step.title, MAX_STEP_TITLE_LENGTH);
      if (!title) return null;
      // A second use of one id would put the same subtask in two places.
      let id = clampString(step.id, MAX_ID_LENGTH) ?? null;
      if (id && seen.has(id)) id = null;
      if (id) seen.add(id);
      const minutes = clampNumber(step.estimatedMinutes, 5, MAX_STEP_MINUTES) ?? 15;
      return { id, title, estimatedMinutes: Math.round(minutes) };
    })
    .filter((step): step is NonNullable<typeof step> => step !== null);
}

const EMPTY_CHANGES = {
  question: null,
  title: null,
  description: null,
  dueDatePhrase: null,
  dueDateShift: null,
  removeDeadline: false,
  stepsDone: [],
  steps: null,
  estimatedMinutes: null,
  priority: null,
  advice: null,
} satisfies Omit<ReassessResponseBody, "outcome" | "summary">;

/** Thrown for an answer that can't be used at all — the route answers 502 and the app offers a retry. */
class UnusableAnswerError extends Error {}

/**
 * The model's answer, checked. Exported so the live eval (tests/ai-eval-reassess.ts)
 * holds the model to exactly what the app will accept.
 */
export function normalizeReassessment(raw: unknown): ReassessResponseBody {
  const result = asObject(raw);
  const outcome = oneOf(result.outcome, OUTCOMES);
  if (!outcome) throw new UnusableAnswerError("no outcome");
  const summary = clampString(result.summary, MAX_SENTENCE_LENGTH) ?? "";

  if (outcome === "clarify") {
    const question = cleanText(result.question, MAX_SENTENCE_LENGTH);
    if (!question) throw new UnusableAnswerError("clarify without a question");
    return { outcome, ...EMPTY_CHANGES, question, summary: "" };
  }
  // "Nothing changes" means nothing: stray fields alongside it are ignored.
  if (outcome === "no_change") return { outcome, ...EMPTY_CHANGES, summary };

  // Zero or less is a garbled number, not a task with no time left: no change.
  const minutes =
    typeof result.estimatedMinutes === "number" && result.estimatedMinutes > 0
      ? clampNumber(result.estimatedMinutes, 1, MAX_TASK_MINUTES)
      : undefined;
  return {
    outcome,
    question: null,
    title: cleanText(result.title, MAX_TITLE_LENGTH),
    description: cleanText(result.description, MAX_NOTE_LENGTH),
    dueDatePhrase: cleanText(result.dueDatePhrase, MAX_PHRASE_LENGTH),
    dueDateShift: normalizeShift(result.dueDateShift),
    removeDeadline: result.removeDeadline === true,
    stepsDone: clampArray(result.stepsDone, 30)
      .map((id) => clampString(id, MAX_ID_LENGTH))
      .filter((id): id is string => !!id),
    steps: normalizeSteps(result.steps),
    estimatedMinutes: minutes === undefined ? null : Math.round(minutes),
    priority: oneOf(result.priority, PRIORITIES) ?? null,
    advice: cleanText(result.advice, MAX_ADVICE_LENGTH),
    summary,
  };
}

const MAX_BODY_BYTES = 64 * 1024;
const MAX_CONTEXT_LENGTH = 2_000;
const MAX_IN_STEPS = 30;

export function parseReassessBody(raw: unknown): ReassessRequestBody | null {
  const body = asObject(raw);
  const task = parseTaskContext(body.task);
  const newContext = clampString(body.newContext, MAX_CONTEXT_LENGTH);
  if (!task || !newContext) return null;

  const clarification = asObject(body.clarification);
  const clarifiedNote = clampString(clarification.note, MAX_CONTEXT_LENGTH);
  const clarifyingQuestion = clampString(clarification.question, MAX_SENTENCE_LENGTH);

  return {
    task,
    doneSteps: parsePlanSteps(body.doneSteps, MAX_IN_STEPS),
    steps: clampArray(body.steps, MAX_IN_STEPS)
      .map((entry) => {
        const step = asObject(entry);
        const id = clampString(step.id, MAX_ID_LENGTH);
        const title = clampString(step.title, MAX_TITLE_LENGTH);
        return id && title ? { id, title, estimatedMinutes: clampNumber(step.estimatedMinutes, 0, MAX_TASK_MINUTES) ?? 15 } : null;
      })
      .filter((step): step is ReassessStep => step !== null),
    advice: clampString(body.advice, MAX_ADVICE_LENGTH) ?? null,
    newContext,
    replacesNote: clampString(body.replacesNote, MAX_CONTEXT_LENGTH),
    clarification: clarifiedNote && clarifyingQuestion ? { note: clarifiedNote, question: clarifyingQuestion } : undefined,
    today: clampString(body.today, 80) ?? new Date().toUTCString(),
    language: oneOf(body.language, LANGUAGES),
  };
}

/** The deadline field is read by the app's English date parser, whatever the app language. */
function deadlineLanguageNote(language: AppLanguage | undefined): string {
  if (!language || language === "en") return "";
  return `
Exception: "dueDatePhrase" is always written in English — translate only the user's deadline words ("vendredi" → "friday", "dans trois jours" → "in 3 days"). Everything else a person reads stays in the language above.`;
}

/**
 * The model side of the route, after authentication and the request caps.
 * Exported so the live eval can run it against the real model without a server.
 */
export async function reassessTask(body: ReassessRequestBody): Promise<ReassessResponseBody> {
  const { language, ...userContent } = body;
  const result = await generateStructuredJson({
    label: "reassess",
    systemPrompt: `${TASK_REASSESSMENT_SYSTEM_PROMPT}${languageInstruction(language)}${deadlineLanguageNote(language)}`,
    userContent: JSON.stringify(userContent),
    responseSchema: RESPONSE_SCHEMA,
  });
  return normalizeReassessment(result);
}

// Signed-in only, like the breakdown route: it changes a saved task, and there
// is no saved task before an account exists.
export async function POST(request: Request) {
  const auth = await authenticate(request);
  if ("failed" in auth) return auth.failed;
  if (!auth.userId) return unauthorized();

  let raw: unknown;
  try {
    raw = await readJsonBody(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof BadRequestError) return badRequest();
    throw error;
  }

  const body = parseReassessBody(raw);
  if (!body) return badRequest();

  try {
    return Response.json(await reassessTask(body));
  } catch (error) {
    // Unlike the advice route there is no stand-in answer worth giving: a
    // made-up reassessment would change the task on a guess. The app keeps
    // the task as it is, keeps the note in the box, and offers a retry.
    console.error("[api/reassess]", error);
    return Response.json({ error: "Reassessment unavailable" }, { status: 502 });
  }
}
