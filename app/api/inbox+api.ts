import { TASK_MANAGER_INTEGRATION_NOTES, TASK_MANAGER_SYSTEM_PROMPT } from "@/data/aiPrompts";
import type { TaskContext } from "@/lib/ai/context";
import { guessDuration, guessPriorityLevel, parseDurationMinutes } from "@/lib/ai/extractTasks";
import { GeminiHttpError, generateStructuredJson, type GeminiJsonSchema } from "@/lib/ai/gemini";
import { aiUnavailableMessage, datePhraseInstruction, languageInstruction } from "@/lib/ai/language";
import { hasExplicitTime, isAmbiguousDate, parseDatePhrase } from "@/lib/ai/parseDate";
import { anonymousRateLimit } from "@/lib/anonymousRateLimit";
import { claimTrialCall } from "@/lib/anonymousTrial";
import { authenticate } from "@/lib/serverAuth";
import {
    asObject,
    badRequest,
    BadRequestError,
    clampArray,
    clampString,
    LANGUAGES,
    MAX_ID_LENGTH,
    oneOf,
    parseTaskContext,
    readJsonBody,
} from "@/lib/serverRequest";
import type { AppLanguage } from "@/types/settings";

export type InboxRequestBody = {
  message: string;
  now: string;
  /** "now" in the user's own words and time zone ("Wednesday, October 7, 2026, 10:00 (GMT+2)"). */
  today?: string;
  currentTaskId?: string;
  recentTaskIds: string[];
  tasks: TaskContext[];
  history: { role: "user" | "ai"; text: string }[];
  /** The app language — "reply" and task titles come back in it. */
  language?: AppLanguage;
};

export type InboxActionType =
  | "CREATE_TASK"
  | "UPDATE_TASK"
  | "UPDATE_TASKS"
  | "COMPLETE_TASK"
  | "COMPLETE_TASKS"
  | "REOPEN_TASK"
  | "REOPEN_TASKS"
  | "DELETE_TASK"
  | "DELETE_TASKS"
  | "ADD_CONTEXT"
  | "BREAKDOWN_TASK"
  | "REDIRECT_NEXT"
  | "LIST_TASKS"
  | "NONE";

/** Which tasks a bulk action means, as criteria the app applies to the whole list. */
export type InboxFilter = {
  status?: "pending" | "completed" | "overdue" | "all";
  titleKeywords?: string[];
  /** An English range phrase — "today", "this week", "before friday" — resolved on the device. */
  dueWithin?: string;
  completedWithin?: string;
  recurring?: boolean;
  hasDeadline?: boolean;
  priority?: "high" | "medium" | "low";
};

export type InboxRecurrence = {
  frequency: "daily" | "weekly" | "monthly" | "yearly" | "none";
  interval?: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekdays?: number[];
  monthDay?: number;
  endDatePhrase?: string;
};

export type InboxAction = {
  type: InboxActionType;
  taskId: string | null;
  taskIds: string[] | null;
  filter: InboxFilter | null;
  fields: {
    title?: string;
    estimatedMinutes?: number;
    /**
     * Deadline wording, never a date. The device turns it into one in the
     * user's own time zone (lib/ai/classifyIntent.ts) — this server runs in
     * UTC, where "tomorrow" late in the evening is already the wrong day.
     */
    dueDatePhrase?: string;
    /** The user's own words, when the model's phrase missed the deadline or its time; read in the app language. */
    dueDateText?: string;
    /** The user's own words hold a date that reads two ways ("3/4") — the app asks rather than using the model's guess. */
    dueDateAmbiguous?: boolean;
    dueDateShift?: { amount: number; unit: "minutes" | "hours" | "days" | "weeks" | "months" };
    estimatedMinutesDelta?: number;
    priority?: string;
    note?: string;
    steps?: { title: string; estimatedMinutes: number }[];
    availableMinutes?: number;
    recurrence?: InboxRecurrence;
    recurrenceScope?: "this" | "future" | "series";
  };
  confirmationRequired: boolean;
  /** What the model said about this action alone. */
  reply?: string;
};

// The client always gets back one or more actions plus one combined reply,
// regardless of how many model calls it took to assemble that server-side.
// Each action also carries its own part of the reply, so the app can replace
// the part about a change with what the change actually did.
export type InboxResponseBody = {
  intent: string;
  actions: InboxAction[];
  reply: string;
};

// Internal per-call contract. Asking the model to fully resolve a compound
// message ("actions": [...]) in one completion turned out to be unreliable
// for this model — it would occasionally run away narrating itself instead
// of answering. Asking it to resolve exactly ONE instruction and hand back
// whatever's left is a much easier task, and is what it's proven reliable
// at (see data/aiPrompts.ts EXAMPLES) — so a compound message is handled by
// looping this single-instruction call rather than by a bigger one-shot ask.
type SingleTurnResult = {
  intent: string;
  action: InboxAction;
  remainingMessage: string | null;
  reply: string;
};

const ACTION_TYPE_ENUM: InboxActionType[] = [
  "CREATE_TASK",
  "UPDATE_TASK",
  "UPDATE_TASKS",
  "COMPLETE_TASK",
  "COMPLETE_TASKS",
  "REOPEN_TASK",
  "REOPEN_TASKS",
  "DELETE_TASK",
  "DELETE_TASKS",
  "ADD_CONTEXT",
  "BREAKDOWN_TASK",
  "REDIRECT_NEXT",
  "LIST_TASKS",
  "NONE",
];

const WEEKDAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const SHIFT_UNITS = ["minutes", "hours", "days", "weeks", "months"] as const;

const FILTER_SCHEMA: GeminiJsonSchema = {
  type: "OBJECT",
  nullable: true,
  properties: {
    status: { type: "STRING", enum: ["pending", "completed", "overdue", "all"], nullable: true },
    titleKeywords: { type: "ARRAY", nullable: true, items: { type: "STRING" } },
    // Phrases, like dueDatePhrase — the app works out the actual range.
    dueWithin: { type: "STRING", nullable: true },
    completedWithin: { type: "STRING", nullable: true },
    recurring: { type: "BOOLEAN", nullable: true },
    hasDeadline: { type: "BOOLEAN", nullable: true },
    priority: { type: "STRING", enum: ["high", "medium", "low"], nullable: true },
  },
};

const ACTION_SCHEMA: GeminiJsonSchema = {
  type: "OBJECT",
  properties: {
    type: { type: "STRING", enum: ACTION_TYPE_ENUM },
    taskId: { type: "STRING", nullable: true },
    taskIds: { type: "ARRAY", nullable: true, items: { type: "STRING" } },
    filter: FILTER_SCHEMA,
    fields: {
      type: "OBJECT",
      properties: {
        title: { type: "STRING", nullable: true },
        estimatedMinutes: { type: "NUMBER", nullable: true },
        // Deliberately a free-text phrase, not a date type — see
        // APP INTEGRATION NOTES: the model must never compute the actual
        // calendar date itself (that's what broke it), just copy the
        // deadline phrase verbatim; the device resolves it.
        dueDatePhrase: { type: "STRING", nullable: true },
        priority: { type: "STRING", enum: ["high", "medium", "low"], nullable: true },
        note: { type: "STRING", nullable: true },
        steps: {
          type: "ARRAY",
          nullable: true,
          items: {
            type: "OBJECT",
            properties: {
              title: { type: "STRING" },
              estimatedMinutes: { type: "NUMBER" },
            },
            required: ["title", "estimatedMinutes"],
          },
        },
        availableMinutes: { type: "NUMBER", nullable: true },
        // "Push everything back two weeks": a signed amount, not a date.
        dueDateShift: {
          type: "OBJECT",
          nullable: true,
          properties: {
            amount: { type: "NUMBER" },
            unit: { type: "STRING", enum: [...SHIFT_UNITS] },
          },
          required: ["amount", "unit"],
        },
        estimatedMinutesDelta: { type: "NUMBER", nullable: true },
        recurrence: {
          type: "OBJECT",
          nullable: true,
          properties: {
            frequency: { type: "STRING", enum: ["daily", "weekly", "monthly", "yearly", "none"] },
            interval: { type: "NUMBER", nullable: true },
            weekdays: { type: "ARRAY", nullable: true, items: { type: "STRING", enum: [...WEEKDAY_NAMES] } },
            monthDay: { type: "NUMBER", nullable: true },
            endDatePhrase: { type: "STRING", nullable: true },
          },
          required: ["frequency"],
        },
        recurrenceScope: { type: "STRING", enum: ["this", "future", "series"], nullable: true },
      },
      // Optional keys were routinely skipped: "study chemistry in six days
      // for two hours" came back with only a title, even though "reply"
      // narrated 2h. Required-but-nullable forces the model to decide each
      // task field (null is still allowed for actions that don't use it),
      // and the ordering has it fill them in before anything else.
      required: ["title", "estimatedMinutes", "priority", "dueDatePhrase"],
      propertyOrdering: [
        "title",
        "estimatedMinutes",
        "priority",
        "dueDatePhrase",
        "note",
        "steps",
        "availableMinutes",
        "dueDateShift",
        "estimatedMinutesDelta",
        "recurrence",
        "recurrenceScope",
      ],
    },
    confirmationRequired: { type: "BOOLEAN" },
  },
  required: ["type", "fields", "confirmationRequired"],
  propertyOrdering: ["type", "taskId", "taskIds", "filter", "fields", "confirmationRequired"],
};

const SINGLE_TURN_SCHEMA: GeminiJsonSchema = {
  type: "OBJECT",
  properties: {
    intent: { type: "STRING" },
    action: ACTION_SCHEMA,
    remainingMessage: { type: "STRING", nullable: true },
    reply: { type: "STRING" },
  },
  required: ["intent", "action", "reply"],
  // "reply" last, so it narrates the fields already chosen rather than the
  // fields being filled in to match (or not match) a reply written first.
  propertyOrdering: ["intent", "action", "remainingMessage", "reply"],
};

const INBOX_SYSTEM_PROMPT = `${TASK_MANAGER_SYSTEM_PROMPT}\n\n${TASK_MANAGER_INTEGRATION_NOTES}`;

const NO_ACTION: InboxAction = { type: "NONE", taskId: null, taskIds: null, filter: null, fields: {}, confirmationRequired: false };

function fallbackResponse(language: AppLanguage | undefined): InboxResponseBody {
  return {
    intent: "UNRELATED",
    actions: [{ ...NO_ACTION, reply: aiUnavailableMessage(language) }],
    reply: aiUnavailableMessage(language),
  };
}

// A compound message resolves over at most this many single-instruction
// turns — comfortably more than any realistic message describes, while
// bounding worst-case latency/cost if the model ever stalls on progress.
// A photo of an assignment sheet is the case that needs the headroom: each
// row on it is one more turn.
const MAX_TURNS = 6;

// Defensive boundary check: this model occasionally "thinks out loud"
// inside a string field instead of a title (e.g. "Pick up dry cleaning
// estimatedMinutes: 15, priority: medium..."), which reads as a garbled
// task title if it slips through. A real title is short prose; reasoning
// leakage is long and littered with the schema's own field/enum names.
const LEAKED_REASONING_PATTERN = /\b(estimatedMinutes|dueDate|priority|confirmationRequired|schema)\s*[:=]/i;

function sanitizeTitle(title: string | undefined): string | undefined {
  if (!title) return undefined;
  if (title.length > 80 || LEAKED_REASONING_PATTERN.test(title)) return undefined;
  return title;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function shortString(value: unknown, max = 120): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

const MAX_TARGET_IDS = 100;

function normalizeFilter(raw: unknown): InboxFilter | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const filter: InboxFilter = {
    status: oneOf(value.status, ["pending", "completed", "overdue", "all"] as const),
    titleKeywords: Array.isArray(value.titleKeywords)
      ? value.titleKeywords
          .map((keyword) => shortString(keyword, 60))
          .filter((keyword): keyword is string => !!keyword)
          .slice(0, 10)
      : undefined,
    dueWithin: shortString(value.dueWithin),
    completedWithin: shortString(value.completedWithin),
    recurring: typeof value.recurring === "boolean" ? value.recurring : undefined,
    hasDeadline: typeof value.hasDeadline === "boolean" ? value.hasDeadline : undefined,
    priority: oneOf(value.priority, ["high", "medium", "low"] as const),
  };
  if (!filter.titleKeywords?.length) delete filter.titleKeywords;
  return Object.values(filter).some((entry) => entry !== undefined) ? filter : {};
}

function normalizeRecurrence(raw: unknown): InboxRecurrence | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const frequency = oneOf(value.frequency, ["daily", "weekly", "monthly", "yearly", "none"] as const);
  if (!frequency) return undefined;
  const weekdays = Array.isArray(value.weekdays)
    ? value.weekdays
        .map((day) => (typeof day === "string" ? WEEKDAY_NAMES.indexOf(day.toLowerCase().slice(0, 3) as never) : -1))
        .filter((day) => day >= 0)
    : [];
  return {
    frequency,
    interval: finiteNumber(value.interval),
    weekdays: weekdays.length > 0 ? weekdays : undefined,
    monthDay: finiteNumber(value.monthDay),
    endDatePhrase: shortString(value.endDatePhrase),
  };
}

// Dates stay as phrases here — see the dueDatePhrase comment on InboxAction.
function normalizeAction(raw: unknown): InboxAction | null {
  if (!raw || typeof raw !== "object") return null;
  const action = raw as Record<string, unknown>;
  const fields = action.fields;
  const rawFields = fields && typeof fields === "object" && !Array.isArray(fields) ? (fields as Record<string, unknown>) : {};

  const steps = Array.isArray(rawFields.steps)
    ? rawFields.steps
        .filter((step): step is { title: unknown; estimatedMinutes: unknown } => !!step && typeof step === "object")
        .map((step) => ({
          title: typeof step.title === "string" ? step.title : "",
          estimatedMinutes: finiteNumber(step.estimatedMinutes) ?? 15,
        }))
        .filter((step) => step.title.length > 0)
    : undefined;

  const shift = rawFields.dueDateShift && typeof rawFields.dueDateShift === "object" ? (rawFields.dueDateShift as Record<string, unknown>) : null;
  const shiftAmount = finiteNumber(shift?.amount);
  const shiftUnit = oneOf(shift?.unit, SHIFT_UNITS);

  return {
    type: oneOf(action.type, ACTION_TYPE_ENUM) ?? "NONE",
    taskId: typeof action.taskId === "string" && action.taskId ? action.taskId : null,
    taskIds: Array.isArray(action.taskIds)
      ? [...new Set(action.taskIds.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, MAX_TARGET_IDS)
      : null,
    filter: normalizeFilter(action.filter),
    fields: {
      title: sanitizeTitle(typeof rawFields.title === "string" ? rawFields.title : undefined),
      estimatedMinutes: finiteNumber(rawFields.estimatedMinutes),
      dueDatePhrase: shortString(rawFields.dueDatePhrase),
      dueDateShift: shiftAmount !== undefined && shiftUnit && shiftAmount !== 0 ? { amount: shiftAmount, unit: shiftUnit } : undefined,
      estimatedMinutesDelta: finiteNumber(rawFields.estimatedMinutesDelta),
      priority: typeof rawFields.priority === "string" ? rawFields.priority : undefined,
      note: typeof rawFields.note === "string" ? rawFields.note : undefined,
      steps: steps && steps.length > 0 ? steps : undefined,
      availableMinutes: finiteNumber(rawFields.availableMinutes),
      recurrence: normalizeRecurrence(rawFields.recurrence),
      recurrenceScope: oneOf(rawFields.recurrenceScope, ["this", "future", "series"] as const),
    },
    confirmationRequired: action.confirmationRequired === true,
  };
}

// The part of the message this turn's action is about — the remainder the
// model handed back belongs to a later turn (and its deadline, if any).
function instructionText(message: string, remainingMessage: string | null): string {
  if (!remainingMessage) return message;
  const index = message.lastIndexOf(remainingMessage);
  return index > 0 ? message.slice(0, index) : message;
}

const ATTACHMENT_MARKER_PATTERN = /^\[Attached (?:image|voice note|document)(?: \d+)?\]$/;
const USER_INSTRUCTION_MARKER = "[User's instruction]";

function withoutUserInstruction(text: string): string {
  const lines = text.split("\n");
  const kept: string[] = [];
  let inUserInstruction = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === USER_INSTRUCTION_MARKER) {
      inUserInstruction = true;
      continue;
    }
    if (ATTACHMENT_MARKER_PATTERN.test(trimmed)) inUserInstruction = false;
    if (!inUserInstruction) kept.push(line);
  }
  return kept.join("\n");
}

// Every re-read below assumes `text` describes ONE task. Text the app read
// out of a photo or document usually lists several — three assignments, each
// with its own date, time and length — and a typed brain-dump can too. There,
// reading a date/duration/priority "off the text" would hand this task the
// NEXT item's deadline, so the model's own per-task fields are left alone and
// only genuinely absent values are filled in.
function looksMultiItem(text: string): boolean {
  return withoutUserInstruction(text)
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !ATTACHMENT_MARKER_PATTERN.test(trimmed);
    }).length > 1;
}

// The model often omits optional schema fields even when told to set them
// ("take my daughter to the doctor tomorrow" came back with no
// dueDatePhrase), which saved every task with no deadline, medium priority
// and 30 minutes — and therefore the same score. Read whatever it left out
// straight off the user's own words instead.
function fillMissingTaskFields(action: InboxAction, text: string, now: Date, language: AppLanguage | undefined) {
  if (looksMultiItem(text)) {
    if (!["high", "medium", "low"].includes(action.fields.priority ?? "")) action.fields.priority = "medium";
    // No deadline is deliberate here: the model saw which line this task came
    // from and this code can't, so an invented date is worse than none.
    action.fields.estimatedMinutes ??= guessDuration(action.fields.title ?? "");
    return;
  }

  // The model sometimes copies only the date part ("25th September") and
  // drops the time the user said ("at 7 p.m."), or leaves the deadline out
  // altogether — then the user's own words are what the device reads. Only
  // whether a phrase *has* a date or a time is checked here: the date itself
  // is worked out on the device, in the user's time zone.
  // "Due 3/4" is March 4th or April 3rd depending on who wrote it. Whatever
  // the model made of it is a guess, so the app asks instead (classifyIntent).
  if (isAmbiguousDate(text, language)) action.fields.dueDateAmbiguous = true;

  const phrase = action.fields.dueDatePhrase;
  const phraseHasTime = phrase ? hasExplicitTime(phrase) : false;
  const phraseParses = phrase ? parseDatePhrase(phrase, now) !== undefined : false;
  const textParses = parseDatePhrase(text, now, language) !== undefined;
  if (textParses && ((hasExplicitTime(text, language) && !phraseHasTime) || !phraseParses)) {
    action.fields.dueDateText = text;
  }
  // Importance the user stated outright ("it's really important", "no
  // rush") beats the model's own judgement.
  const statedPriority = guessPriorityLevel(text);
  if (statedPriority !== "medium" || !["high", "medium", "low"].includes(action.fields.priority ?? "")) {
    action.fields.priority = statedPriority;
  }
  // A length the user actually said ("for two hours") beats any estimate.
  action.fields.estimatedMinutes = parseDurationMinutes(text) ?? action.fields.estimatedMinutes ?? guessDuration(text);
}

async function classifyOneInstruction(params: {
  message: string;
  now: string;
  today?: string;
  currentTaskId?: string;
  recentTaskIds: string[];
  tasks: TaskContext[];
  history: { role: "user" | "ai"; text: string }[];
  language?: AppLanguage;
}): Promise<SingleTurnResult> {
  const { language, ...userContent } = params;
  // The language notes ride at the top of the message rather than at the end
  // of the system prompt. That keeps the system prompt identical for every
  // user, which is what lets it be read from one cache (lib/ai/gemini.ts).
  const languageNotes = `${languageInstruction(language)}${datePhraseInstruction(language)}`.trim();
  const result = await generateStructuredJson({
    label: "inbox",
    systemPrompt: INBOX_SYSTEM_PROMPT,
    cacheSystemPrompt: true,
    userContent: languageNotes ? `${languageNotes}\n\n${JSON.stringify(userContent)}` : JSON.stringify(userContent),
    responseSchema: SINGLE_TURN_SCHEMA,
  });
  const raw = result as Partial<SingleTurnResult>;
  const action = normalizeAction(raw.action) ?? { ...NO_ACTION };
  const remainingMessage =
    typeof raw.remainingMessage === "string" && raw.remainingMessage.trim().length > 0 ? raw.remainingMessage.trim() : null;

  if (action.type === "CREATE_TASK") {
    fillMissingTaskFields(action, instructionText(params.message, remainingMessage), new Date(params.now), language);
  }
  const reply = typeof raw.reply === "string" ? raw.reply : "";
  action.reply = reply;

  return {
    intent: typeof raw.intent === "string" ? raw.intent : "UNKNOWN",
    action,
    remainingMessage,
    reply,
  };
}

// Last-resort recovery when the model chokes outright (a compound message
// occasionally makes it run away instead of answering, even framed as a
// single instruction — see the loop in POST). Splits the ORIGINAL message
// into naive clause fragments and classifies each independently, since
// single-clause messages are what this model is actually reliable at.
// Deliberately simple sentence/keyword splitting, not general NLU — the
// same approach as lib/ai/extractTasks.ts's offline heuristic.
function splitIntoFragments(text: string): string[] {
  return withoutUserInstruction(text)
    .split(/\n|,| and then | and |;/i)
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length > 2)
    // "[Attached image]" and friends label the blocks a message with files is
    // built from (lib/ai/attachmentMessage.ts) — they aren't instructions.
    .filter((fragment) => !ATTACHMENT_MARKER_PATTERN.test(fragment) && fragment !== USER_INSTRUCTION_MARKER);
}

// Every fragment is its own Gemini call carrying the whole ~6k-token system
// prompt, all fired at once. Uncapped, a 4,000-character message split on
// every comma and "and" could fan out into a couple of hundred calls from one
// request — about fifty cents, from a route signed-out callers can reach. Ten
// on top of MAX_TURNS still covers a full assignment sheet.
const MAX_RECOVERY_FRAGMENTS = 10;

async function classifyFragmentsIndependently(
  fragments: string[],
  context: Omit<InboxRequestBody, "message">,
): Promise<{ actions: InboxAction[]; replies: string[]; intent: string | null }> {
  if (fragments.length > MAX_RECOVERY_FRAGMENTS) {
    console.warn(`[api/inbox] recovery capped: ${fragments.length} fragments, classifying the first ${MAX_RECOVERY_FRAGMENTS}`);
  }
  const settled = await Promise.allSettled(
    fragments.slice(0, MAX_RECOVERY_FRAGMENTS).map((fragment) =>
      classifyOneInstruction({
        message: fragment,
        now: context.now,
        today: context.today,
        currentTaskId: context.currentTaskId,
        recentTaskIds: context.recentTaskIds,
        tasks: context.tasks,
        history: context.history,
        language: context.language,
      }),
    ),
  );

  const actions: InboxAction[] = [];
  const replies: string[] = [];
  let intent: string | null = null;
  for (const outcome of settled) {
    if (outcome.status !== "fulfilled") continue;
    actions.push(outcome.value.action);
    if (outcome.value.reply) replies.push(outcome.value.reply);
    intent ??= outcome.value.intent;
  }
  return { actions, replies, intent };
}

// This route is the most expensive one in the app: a single request can drive
// up to MAX_TURNS sequential Gemini calls, plus a parallel fan-out over the
// recovery fragments. These caps bound that from the outside, so the cost of
// one request stays proportional to what a person can actually type.
const MAX_BODY_BYTES = 256 * 1024;
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_RECENT_IDS = 20;
// lib/ai/classifyIntent.ts picks this many by relevance before sending —
// keep the two in step, or the client's choice gets truncated here. Bulk
// actions don't depend on it: their filters are applied to the whole list on
// the device.
const MAX_TASKS = 30;
const MAX_HISTORY = 20;
const MAX_HISTORY_TEXT = 2_000;

/** The request caps above, applied. Exported so the AI eval validates requests the same way. */
export function parseBody(raw: unknown): InboxRequestBody | null {
  const body = asObject(raw);
  const message = clampString(body.message, MAX_MESSAGE_LENGTH);
  if (!message) return null;

  // "now" drives every date the model resolves, so a garbage value would
  // silently date every task wrong — fall back to real now instead.
  const nowCandidate = clampString(body.now, 40);
  const now = nowCandidate && !Number.isNaN(Date.parse(nowCandidate)) ? nowCandidate : new Date().toISOString();

  return {
    message,
    now,
    today: clampString(body.today, 80),
    currentTaskId: clampString(body.currentTaskId, MAX_ID_LENGTH),
    recentTaskIds: clampArray(body.recentTaskIds, MAX_RECENT_IDS)
      .map((id) => clampString(id, MAX_ID_LENGTH))
      .filter((id): id is string => !!id),
    tasks: clampArray(body.tasks, MAX_TASKS)
      .map(parseTaskContext)
      .filter((task): task is TaskContext => task !== null),
    history: clampArray(body.history, MAX_HISTORY)
      .map((entry) => {
        const item = asObject(entry);
        const text = clampString(item.text, MAX_HISTORY_TEXT);
        const role = oneOf(item.role, ["user", "ai"] as const);
        return text && role ? { role, text } : null;
      })
      .filter((entry): entry is { role: "user" | "ai"; text: string } => entry !== null),
    language: oneOf(body.language, LANGUAGES),
  };
}

// Open to signed-out callers for exactly one use: the onboarding brain dump
// (app/onboarding-analyzing.tsx) is read BEFORE the user signs up, as their
// free look at the AI. lib/anonymousTrial.ts allows one request per install,
// with per-IP and per-day ceilings behind it; the caps above bound what that
// one request can cost.
export async function POST(request: Request) {
  // A 503 rather than quietly treating the caller as anonymous: being waved
  // through as anonymous here would only mean tighter rate limiting, but it
  // would also hide a missing CLERK_SECRET_KEY behind mysterious 429s.
  const auth = await authenticate(request);
  if ("failed" in auth) return auth.failed;
  if (!auth.userId) {
    const rateLimitResponse = anonymousRateLimit(request, "inbox");
    if (rateLimitResponse) return rateLimitResponse;
  }

  let raw: unknown;
  try {
    raw = await readJsonBody(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof BadRequestError) return badRequest();
    throw error;
  }

  const body = parseBody(raw);
  if (!body) return badRequest();

  if (!auth.userId) {
    const trialResponse = await claimTrialCall(request, "inbox");
    if (trialResponse) return trialResponse;
  }

  return Response.json(await resolveInboxMessage(body));
}

/**
 * The model side of the route, after authentication and the request caps:
 * resolves a message one instruction at a time. Exported so the AI eval
 * (tests/ai-eval) can run it against the real model without a server.
 */
export async function resolveInboxMessage(body: InboxRequestBody): Promise<InboxResponseBody> {
  const actions: InboxAction[] = [];
  const replies: string[] = [];
  let intent = "UNRELATED";
  let message = body.message;
  let firstTurnFailed = false;
  let laterTurnFailed = false;
  // Google itself turned the call away (a used-up quota, a bad key, an outage
  // that outlasted the retries). Fragment recovery exists for the model
  // choking on a long message; re-sending every fragment here would only hit
  // the same wall several more times at once.
  let googleRefused = false;
  // True only when the loop used up every turn and the model *still* handed
  // back unresolved text — the one exit worth falling back to fragment
  // recovery for. Every other way out (nothing left, the model echoing the
  // same text back, an error) has already produced all it is going to.
  let ranOutOfTurns = false;
  // The model occasionally stops mid-answer (seen in the eval: JSON cut off
  // after ~200 characters). The same request usually comes back whole, so the
  // first turn gets one more try before the user sees an apology.
  let retriedFirstTurn = false;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let result: SingleTurnResult;
    try {
      result = await classifyOneInstruction({
        message,
        now: body.now,
        today: body.today,
        currentTaskId: body.currentTaskId,
        recentTaskIds: body.recentTaskIds,
        tasks: body.tasks,
        history: body.history,
        language: body.language,
      });
    } catch (error) {
      console.error("[api/inbox]", error);
      if (turn === 0 && !retriedFirstTurn && error instanceof SyntaxError) {
        retriedFirstTurn = true;
        turn -= 1;
        continue;
      }
      if (turn === 0) firstTurnFailed = true;
      else laterTurnFailed = true;
      googleRefused = error instanceof GeminiHttpError;
      break; // keep whatever earlier turns already produced
    }

    if (turn === 0) intent = result.intent;
    actions.push(result.action);
    if (result.reply) replies.push(result.reply);

    // No leftover, or the model just echoed the same text back (no real
    // progress) — either way, stop rather than loop pointlessly.
    if (!result.remainingMessage || result.remainingMessage === message) break;
    message = result.remainingMessage;
    ranOutOfTurns = turn === MAX_TURNS - 1;
  }

  if ((ranOutOfTurns || (laterTurnFailed && !googleRefused)) && message) {
    const recovered = await classifyFragmentsIndependently(splitIntoFragments(message), body);
    actions.push(...recovered.actions);
    replies.push(...recovered.replies);
    if (recovered.intent) intent = recovered.intent;
  }

  if (firstTurnFailed && !googleRefused) {
    const fragments = splitIntoFragments(body.message);
    if (fragments.length > 1) {
      const recovered = await classifyFragmentsIndependently(fragments, body);
      actions.push(...recovered.actions);
      replies.push(...recovered.replies);
      if (recovered.intent) intent = recovered.intent;
    }
  }

  if (actions.length === 0) return fallbackResponse(body.language);

  return {
    intent,
    actions,
    reply: replies.join(" ").trim() || aiUnavailableMessage(body.language),
  };
}
