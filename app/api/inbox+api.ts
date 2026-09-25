import { TASK_MANAGER_INTEGRATION_NOTES, TASK_MANAGER_SYSTEM_PROMPT } from "@/data/aiPrompts";
import type { TaskContext } from "@/lib/ai/context";
import { guessDuration, guessPriorityLevel, parseDurationMinutes } from "@/lib/ai/extractTasks";
import { generateStructuredJson, type GeminiJsonSchema } from "@/lib/ai/gemini";
import { aiUnavailableMessage, datePhraseInstruction, languageInstruction } from "@/lib/ai/language";
import { hasExplicitTime, parseDatePhrase } from "@/lib/ai/parseDate";
import { anonymousRateLimit } from "@/lib/anonymousRateLimit";
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
  | "COMPLETE_TASK"
  | "COMPLETE_TASKS"
  | "DELETE_TASK"
  | "DELETE_TASKS"
  | "ADD_CONTEXT"
  | "BREAKDOWN_TASK"
  | "REDIRECT_NEXT"
  | "NONE";

export type InboxAction = {
  type: InboxActionType;
  taskId: string | null;
  fields: {
    title?: string;
    estimatedMinutes?: number;
    dueDate?: string;
    /** CREATE_TASK only: whether the user gave a clock time for dueDate. */
    dueHasTime?: boolean;
    priority?: string;
    note?: string;
    steps?: { title: string; estimatedMinutes: number }[];
    availableMinutes?: number;
    /** DELETE_TASKS only: "all" | "completed" | "pending". */
    scope?: string;
  };
  confirmationRequired: boolean;
};

// Public contract (unchanged): the client always gets back one or more
// actions plus one combined reply, regardless of how many model calls it
// took to assemble that server-side.
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

const ACTION_TYPE_ENUM = [
  "CREATE_TASK",
  "UPDATE_TASK",
  "COMPLETE_TASK",
  "COMPLETE_TASKS",
  "DELETE_TASK",
  "DELETE_TASKS",
  "ADD_CONTEXT",
  "BREAKDOWN_TASK",
  "REDIRECT_NEXT",
  "NONE",
];

const ACTION_SCHEMA: GeminiJsonSchema = {
  type: "OBJECT",
  properties: {
    type: { type: "STRING", enum: ACTION_TYPE_ENUM },
    taskId: { type: "STRING", nullable: true },
    fields: {
      type: "OBJECT",
      properties: {
        title: { type: "STRING", nullable: true },
        estimatedMinutes: { type: "NUMBER", nullable: true },
        // Deliberately a free-text phrase, not a date type — see
        // APP INTEGRATION NOTES: the model must never compute the actual
        // calendar date itself (that's what broke it), just copy the
        // deadline phrase verbatim; normalizeAction() resolves it.
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
        scope: { type: "STRING", enum: ["all", "completed", "pending"], nullable: true },
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
        "scope",
      ],
    },
    confirmationRequired: { type: "BOOLEAN" },
  },
  required: ["type", "fields", "confirmationRequired"],
  propertyOrdering: ["type", "taskId", "fields", "confirmationRequired"],
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

function fallbackResponse(language: AppLanguage | undefined): InboxResponseBody {
  return {
    intent: "UNRELATED",
    actions: [{ type: "NONE", taskId: null, fields: {}, confirmationRequired: false }],
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

// now: resolves the model's raw dueDatePhrase ("Thursday", "tomorrow") into
// an actual ISO date deterministically — see the schema comment on
// dueDatePhrase for why the model never computes this itself.
function normalizeAction(raw: unknown, now: Date): InboxAction | null {
  if (!raw || typeof raw !== "object") return null;
  const action = raw as Partial<InboxAction>;
  const fields = action.fields;
  const rawFields = fields && typeof fields === "object" && !Array.isArray(fields) ? (fields as Record<string, unknown>) : {};

  const steps = Array.isArray(rawFields.steps)
    ? rawFields.steps
        .filter((step): step is { title: unknown; estimatedMinutes: unknown } => !!step && typeof step === "object")
        .map((step) => ({
          title: typeof step.title === "string" ? step.title : "",
          estimatedMinutes: typeof step.estimatedMinutes === "number" && Number.isFinite(step.estimatedMinutes) ? step.estimatedMinutes : 15,
        }))
        .filter((step) => step.title.length > 0)
    : undefined;

  const dueDatePhrase = typeof rawFields.dueDatePhrase === "string" ? rawFields.dueDatePhrase : undefined;

  return {
    type: (action.type as InboxActionType) ?? "NONE",
    taskId: typeof action.taskId === "string" ? action.taskId : null,
    fields: {
      title: sanitizeTitle(typeof rawFields.title === "string" ? rawFields.title : undefined),
      estimatedMinutes:
        typeof rawFields.estimatedMinutes === "number" && Number.isFinite(rawFields.estimatedMinutes) ? rawFields.estimatedMinutes : undefined,
      dueDate: dueDatePhrase ? parseDatePhrase(dueDatePhrase, now) : undefined,
      dueHasTime: dueDatePhrase ? hasExplicitTime(dueDatePhrase) : undefined,
      priority: typeof rawFields.priority === "string" ? rawFields.priority : undefined,
      note: typeof rawFields.note === "string" ? rawFields.note : undefined,
      steps: steps && steps.length > 0 ? steps : undefined,
      availableMinutes:
        typeof rawFields.availableMinutes === "number" && Number.isFinite(rawFields.availableMinutes) ? rawFields.availableMinutes : undefined,
      scope: typeof rawFields.scope === "string" ? rawFields.scope : undefined,
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
  // drops the time the user said ("at 7 p.m.") — re-read both off the text.
  if (hasExplicitTime(text, language) && !action.fields.dueHasTime) {
    const withTime = parseDatePhrase(text, now, language);
    if (withTime) {
      action.fields.dueDate = withTime;
      action.fields.dueHasTime = true;
    }
  }
  if (!action.fields.dueDate) {
    action.fields.dueDate = parseDatePhrase(text, now, language);
    action.fields.dueHasTime = action.fields.dueDate ? hasExplicitTime(text, language) : undefined;
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
  currentTaskId?: string;
  recentTaskIds: string[];
  tasks: TaskContext[];
  history: { role: "user" | "ai"; text: string }[];
  language?: AppLanguage;
}): Promise<SingleTurnResult> {
  const { language, ...userContent } = params;
  const result = await generateStructuredJson({
    systemPrompt: `${TASK_MANAGER_SYSTEM_PROMPT}\n\n${TASK_MANAGER_INTEGRATION_NOTES}${languageInstruction(language)}${datePhraseInstruction(language)}`,
    userContent: JSON.stringify(userContent),
    responseSchema: SINGLE_TURN_SCHEMA,
  });
  const raw = result as Partial<SingleTurnResult>;
  const action = normalizeAction(raw.action, new Date(params.now)) ?? { type: "NONE", taskId: null, fields: {}, confirmationRequired: false };
  const remainingMessage =
    typeof raw.remainingMessage === "string" && raw.remainingMessage.trim().length > 0 ? raw.remainingMessage.trim() : null;

  if (action.type === "CREATE_TASK") {
    fillMissingTaskFields(action, instructionText(params.message, remainingMessage), new Date(params.now), language);
  }

  return {
    intent: typeof raw.intent === "string" ? raw.intent : "UNKNOWN",
    action,
    remainingMessage,
    reply: typeof raw.reply === "string" ? raw.reply : "",
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

async function classifyFragmentsIndependently(
  fragments: string[],
  context: Omit<InboxRequestBody, "message">,
): Promise<{ actions: InboxAction[]; replies: string[]; intent: string | null }> {
  const settled = await Promise.allSettled(
    fragments.map((fragment) =>
      classifyOneInstruction({
        message: fragment,
        now: context.now,
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
const MAX_TASKS = 20;
const MAX_HISTORY = 20;
const MAX_HISTORY_TEXT = 2_000;

function parseBody(raw: unknown): InboxRequestBody | null {
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

// TODO(security): this route is deliberately still open to signed-out callers.
// The onboarding brain-dump (app/onboarding-analyzing.tsx) classifies the
// user's dump BEFORE they sign up, so requiring a Clerk token here would drop
// that step to the offline heuristic (lib/ai/extractTasks.ts).
//
// Until that flow is resolved, this route is an unauthenticated entry point to
// the project's Gemini quota, and one request can drive up to MAX_TURNS calls
// plus the recovery fan-out. The caps below bound a single request, while the
// shared anonymous limiter bounds repeated requests per IP.
//
// To close it, restore these two lines — lib/serverAuth.ts and the token
// plumbing in lib/api.ts are already in place and working:
//     const userId = await getUserId(request);
//     if (!userId) return unauthorized();
// and move onboarding's extraction to after sign-up.
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

  const actions: InboxAction[] = [];
  const replies: string[] = [];
  let intent = "UNRELATED";
  let message = body.message;
  let firstTurnFailed = false;
  let laterTurnFailed = false;
  // True only when the loop used up every turn and the model *still* handed
  // back unresolved text — the one exit worth falling back to fragment
  // recovery for. Every other way out (nothing left, the model echoing the
  // same text back, an error) has already produced all it is going to.
  let ranOutOfTurns = false;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let result: SingleTurnResult;
    try {
      result = await classifyOneInstruction({
        message,
        now: body.now,
        currentTaskId: body.currentTaskId,
        recentTaskIds: body.recentTaskIds,
        tasks: body.tasks,
        history: body.history,
        language: body.language,
      });
    } catch (error) {
      console.error("[api/inbox]", error);
      if (turn === 0) firstTurnFailed = true;
      else laterTurnFailed = true;
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

  if ((ranOutOfTurns || laterTurnFailed) && message) {
    const recovered = await classifyFragmentsIndependently(splitIntoFragments(message), body);
    actions.push(...recovered.actions);
    replies.push(...recovered.replies);
    if (recovered.intent) intent = recovered.intent;
  }

  if (firstTurnFailed) {
    const fragments = splitIntoFragments(body.message);
    if (fragments.length > 1) {
      const recovered = await classifyFragmentsIndependently(fragments, body);
      actions.push(...recovered.actions);
      replies.push(...recovered.replies);
      if (recovered.intent) intent = recovered.intent;
    }
  }

  if (actions.length === 0) {
    return Response.json(fallbackResponse(body.language));
  }

  return Response.json({
    intent,
    actions,
    reply: replies.join(" ").trim() || aiUnavailableMessage(body.language),
  } satisfies InboxResponseBody);
}
