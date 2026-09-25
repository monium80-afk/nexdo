import type { InboxAction, InboxRequestBody, InboxResponseBody } from "@/app/api/inbox+api";
import { stripAttachmentBlocks } from "@/lib/ai/attachmentMessage";
import { taskToContext } from "@/lib/ai/context";
import { extractTasks } from "@/lib/ai/extractTasks";
import { parseDatePhrase } from "@/lib/ai/parseDate";
import { resolveTaskReference } from "@/lib/ai/resolveTaskReference";
import type { StructuredAction } from "@/lib/ai/types";
import { apiPost } from "@/lib/api";
import { getLanguage, translate } from "@/lib/i18n";
import { rankTasksForNext } from "@/lib/scoring";
import type { TaskScope } from "@/lib/taskMeta";
import type { Task, TaskPriorityLevel } from "@/types/task";

export type ClassifyIntentInput = {
  text: string;
  now: Date;
  currentTaskId?: string;
  recentTaskIds: string[];
  tasks: Task[];
  history?: { role: "user" | "ai"; text: string }[];
};

// A turn can produce several actions (compound messages, taxonomy 6.1) plus
// one narrated reply covering all of them. "reply" is null only from the
// offline heuristic fallback, which has no narration of its own — the
// caller falls back to each action's own executed-result message instead.
export type ClassifiedTurn = { actions: StructuredAction[]; reply: string | null };

const VALID_PRIORITIES: TaskPriorityLevel[] = ["high", "medium", "low"];
const VALID_SCOPES: TaskScope[] = ["all", "completed", "pending"];

// A pending-task-list cap for pathological cases — a normal user's pending
// list is small enough to send in full, which is what makes duplicate
// detection, "what's overdue", and "I'm overwhelmed" (taxonomy 1.1, 4.3,
// 5.4) work well: the model needs the *whole* list, not a narrowed slice.
const MAX_TASKS_SENT = 60;

function tasksForPrompt(tasks: Task[]): Task[] {
  const pending = tasks.filter((task) => task.status === "pending");
  if (pending.length <= MAX_TASKS_SENT) return pending;
  return [...pending].sort((a, b) => b.priorityScore - a.priorityScore).slice(0, MAX_TASKS_SENT);
}

// Layer A's action.type enum doesn't carry a confirmation tier for every
// case — the destructive/safe ones are fixed here regardless of what the
// model returns, so a wrong model output can never skip a confirmation it
// shouldn't.
function mapSingleAction(action: InboxAction, fallbackNote: string): StructuredAction | null {
  if (action.type === "CREATE_TASK" && action.fields.title) {
    const priorityLevel = VALID_PRIORITIES.includes(action.fields.priority as TaskPriorityLevel)
      ? (action.fields.priority as TaskPriorityLevel)
      : "medium";
    return {
      type: "CREATE_TASK",
      drafts: [
        {
          title: action.fields.title,
          estimatedMinutes: action.fields.estimatedMinutes ?? 30,
          dueDate: action.fields.dueDate,
          dueHasTime: action.fields.dueHasTime,
          priorityLevel,
          steps: action.fields.steps,
        },
      ],
      confirmationTier: "confirm-required",
    };
  }

  if (action.type === "UPDATE_TASK" && action.taskId) {
    const changes: Partial<Pick<Task, "title" | "dueDate" | "estimatedMinutes">> = {};
    if (action.fields.title) changes.title = action.fields.title;
    if (action.fields.dueDate) changes.dueDate = action.fields.dueDate;
    if (typeof action.fields.estimatedMinutes === "number") changes.estimatedMinutes = action.fields.estimatedMinutes;
    return {
      type: "UPDATE_TASK",
      taskId: action.taskId,
      changes,
      confirmationTier: action.confirmationRequired ? "confirm-required" : "immediate",
    };
  }

  if (action.type === "COMPLETE_TASK" && action.taskId) {
    return { type: "COMPLETE_TASK", taskId: action.taskId, confirmationTier: "immediate" };
  }

  if (action.type === "COMPLETE_TASKS") {
    return { type: "COMPLETE_TASKS", confirmationTier: "immediate" };
  }

  // Deletion is direct/unambiguous per the taxonomy — no confirmation tier,
  // regardless of what the model set confirmationRequired to.
  if (action.type === "DELETE_TASK" && action.taskId) {
    return { type: "DELETE_TASK", taskId: action.taskId, confirmationTier: "immediate" };
  }

  // Bulk removal always asks first, whatever the model set.
  if (action.type === "DELETE_TASKS") {
    const scope = VALID_SCOPES.find((value) => value === action.fields.scope) ?? "all";
    return { type: "DELETE_TASKS", scope, confirmationTier: "confirm-required" };
  }

  if (action.type === "ADD_CONTEXT" && action.taskId) {
    return {
      type: "ADD_TASK_CONTEXT",
      taskId: action.taskId,
      note: action.fields.note ?? fallbackNote,
      estimatedMinutes: action.fields.estimatedMinutes,
      confirmationTier: "safe",
    };
  }

  if (action.type === "BREAKDOWN_TASK" && action.taskId && action.fields.steps?.length) {
    return {
      type: "BREAKDOWN_TASK",
      taskId: action.taskId,
      steps: action.fields.steps,
      confirmationTier: "confirm-required",
    };
  }

  if (action.type === "REDIRECT_NEXT" && typeof action.fields.availableMinutes === "number") {
    return { type: "REDIRECT_NEXT", availableMinutes: action.fields.availableMinutes, confirmationTier: "safe" };
  }

  return null;
}

function mapInboxResponse(response: InboxResponseBody, fallbackNote: string): StructuredAction[] {
  const mapped = response.actions
    .map((action) => mapSingleAction(action, fallbackNote))
    .filter((a): a is StructuredAction => a !== null);
  return mapped.length > 0 ? mapped : [{ type: "UNKNOWN", reply: response.reply, confirmationTier: "safe" }];
}

const DELETE_PATTERN = /\b(delete|remove|cancel)\b/i;
const BULK_PATTERN = /\b(all|every|everything)\b/i;
// Checked before COMPLETED_SCOPE_PATTERN — "uncompleted"/"incomplete" contain "complete".
const PENDING_SCOPE_PATTERN = /\b(pending|uncompleted|incomplete|unfinished|not done|open|active|remaining)\b/i;
const COMPLETED_SCOPE_PATTERN = /\b(completed?|done|finished)\b/i;
const ALREADY_DID_PATTERN = /\balready (did|finished|completed|done|started)\b/i;
const DONE_PATTERN = /\b(finished|done|complete[d]?)\b/i;
const RESCHEDULE_PATTERN = /\b(move|reschedule|push|delay|change.*(deadline|due))\b/i;
const SKIP_PATTERN = /\b(skip|not now|something else|show another|can'?t do this now)\b/i;
const TIME_BUDGET_PATTERN = /\b(?:only have|i have|i'?ve got|got)\s+(\d+)\s*(minutes?|mins?|hours?|hrs?)\b/i;
const CONSTRAINT_PATTERN = /\b(only have|can'?t finish|don'?t have|no time|not enough time)\b/i;
const WHAT_NEXT_PATTERN = /\bwhat (should i do|next|now)\b|\bwhat'?s next\b/i;
const OVERDUE_WORKFLOW_PATTERN = /\b(reschedule everything overdue|break down my top task|catch me up on overdue)\b/i;

function askWhich(candidates: Task[]): StructuredAction {
  const titles = candidates.map((task) => task.title).join(", ");
  return {
    type: "CLARIFY",
    question: translate().assistant.whichOne(titles),
    candidates,
    confirmationTier: "safe",
  };
}

// Ordered keyword/regex rules — used as an offline fallback if the real
// Gemini call below fails (no network, missing API key, malformed output),
// so the inbox degrades gracefully instead of breaking.
// Order matters — more specific/destructive intents are checked first so a
// message like "delete the essay, it's already done" resolves to delete.
function classifyIntentHeuristic(input: ClassifyIntentInput): StructuredAction {
  const { text, now, currentTaskId, recentTaskIds, tasks } = input;
  const referenceCtx = { currentTaskId, recentTaskIds, tasks };
  const t = translate();

  if (DELETE_PATTERN.test(text) && BULK_PATTERN.test(text)) {
    const scope: TaskScope = PENDING_SCOPE_PATTERN.test(text)
      ? "pending"
      : COMPLETED_SCOPE_PATTERN.test(text)
        ? "completed"
        : "all";
    return { type: "DELETE_TASKS", scope, confirmationTier: "confirm-required" };
  }

  if (DELETE_PATTERN.test(text)) {
    const ref = resolveTaskReference(text, referenceCtx);
    if (ref.status === "resolved") return { type: "DELETE_TASK", taskId: ref.taskId, confirmationTier: "immediate" };
    if (ref.status === "ambiguous") return askWhich(ref.candidates);
    return { type: "UNKNOWN", reply: t.assistant.whichDelete, confirmationTier: "safe" };
  }

  if (ALREADY_DID_PATTERN.test(text) && currentTaskId) {
    return { type: "ADD_TASK_CONTEXT", taskId: currentTaskId, note: text, confirmationTier: "safe" };
  }

  // "mark all my tasks as done" / "I finished everything".
  if (DONE_PATTERN.test(text) && BULK_PATTERN.test(text)) {
    return { type: "COMPLETE_TASKS", confirmationTier: "immediate" };
  }

  if (DONE_PATTERN.test(text)) {
    const ref = resolveTaskReference(text, referenceCtx);
    if (ref.status === "resolved") return { type: "COMPLETE_TASK", taskId: ref.taskId, confirmationTier: "immediate" };
    if (ref.status === "ambiguous") return askWhich(ref.candidates);
  }

  if (RESCHEDULE_PATTERN.test(text)) {
    const ref = resolveTaskReference(text, referenceCtx);
    const newDueDate = parseDatePhrase(text, now, getLanguage());
    if (ref.status === "resolved") {
      return { type: "RESCHEDULE_TASK", taskId: ref.taskId, newDueDate, confirmationTier: "immediate" };
    }
    if (ref.status === "ambiguous") return askWhich(ref.candidates);
  }

  if (SKIP_PATTERN.test(text)) {
    const ref = currentTaskId
      ? { status: "resolved" as const, taskId: currentTaskId }
      : resolveTaskReference(text, referenceCtx);
    if (ref.status === "resolved") return { type: "SKIP_TASK", taskId: ref.taskId, reason: text, confirmationTier: "safe" };
    if (ref.status === "ambiguous") return askWhich(ref.candidates);
  }

  if (OVERDUE_WORKFLOW_PATTERN.test(text)) {
    return { type: "QUERY", answer: t.assistant.overdueWorkflow(text.trim()), confirmationTier: "safe" };
  }

  // A bare time-budget statement with no task already in view redirects to
  // Next (taxonomy 4.2) rather than logging context against a guessed task.
  if (!currentTaskId) {
    const budgetMatch = text.match(TIME_BUDGET_PATTERN);
    if (budgetMatch) {
      const amount = Number.parseInt(budgetMatch[1], 10);
      const availableMinutes = /hour|hr/i.test(budgetMatch[2]) ? amount * 60 : amount;
      return { type: "REDIRECT_NEXT", availableMinutes, confirmationTier: "safe" };
    }
  }

  if (CONSTRAINT_PATTERN.test(text)) {
    const contextTaskId = currentTaskId ?? rankTasksForNext(tasks, now)[0]?.id;
    if (contextTaskId) {
      return { type: "ADD_TASK_CONTEXT", taskId: contextTaskId, note: text, confirmationTier: "safe" };
    }
  }

  if (WHAT_NEXT_PATTERN.test(text)) {
    const top = rankTasksForNext(tasks, now)[0];
    const answer = top ? t.assistant.bestNext(top.title, top.priorityScore) : t.assistant.allCaughtUp;
    return { type: "QUERY", answer, confirmationTier: "safe" };
  }

  // Capture is the default. Every rule above this point matched an explicit
  // command (delete/done/reschedule/skip/what's-next), so whatever is left
  // that names something doable is someone jotting down a task — including
  // bare fragments like "dentist tomorrow" that carry no command verb at
  // all. Extract it rather than asking what they meant: nothing is written
  // until they accept the preview, so a wrong draft costs one tap while
  // refusing to extract loses the thought entirely. Note this deliberately
  // runs BEFORE resolveTaskReference — a bare statement that merely shares
  // a word with an existing task ("clean the house" vs. "Clean the
  // kitchen") is a new task, not an edit to that one.
  const drafts = extractTasks(text, now, getLanguage());
  if (drafts.length > 0) return { type: "CREATE_TASK", drafts, confirmationTier: "confirm-required" };

  const ref = resolveTaskReference(text, referenceCtx);
  if (ref.status === "ambiguous") return askWhich(ref.candidates);

  return {
    type: "UNKNOWN",
    reply: t.assistant.noTaskFound,
    confirmationTier: "safe",
  };
}

// Layer A (Task Manager) — see data/aiPrompts.ts and app/api/inbox+api.ts.
// Falls back to the heuristic classifier above on any network/parse failure.
export async function classifyIntent(input: ClassifyIntentInput): Promise<ClassifiedTurn> {
  try {
    const request: InboxRequestBody = {
      message: input.text,
      now: input.now.toISOString(),
      currentTaskId: input.currentTaskId,
      recentTaskIds: input.recentTaskIds,
      tasks: tasksForPrompt(input.tasks).map(taskToContext),
      history: input.history ?? [],
      language: getLanguage(),
    };
    const response = await apiPost<InboxResponseBody>("/api/inbox", request);
    const actions = mapInboxResponse(response, input.text);
    // An empty/whitespace reply (this model occasionally emits one on a
    // compound turn) falls back to the per-action executed message instead
    // of showing a blank chat bubble — see handleClassifiedActions. A bulk
    // delete does too: only the app can count exactly how many tasks the
    // confirmation question is about.
    const hasReply = response.reply && response.reply.trim().length > 0;
    const reply = hasReply && !actions.some((action) => action.type === "DELETE_TASKS") ? response.reply : null;
    return { actions, reply };
  } catch (error) {
    console.warn("[classifyIntent] falling back to heuristic", error);
    // The heuristic reads raw words, so the "[Attached image]" labels a
    // message with files is built from come back out first.
    return { actions: [classifyIntentHeuristic({ ...input, text: stripAttachmentBlocks(input.text) })], reply: null };
  }
}
