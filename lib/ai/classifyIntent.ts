import type { InboxAction, InboxFilter, InboxRecurrence, InboxRequestBody, InboxResponseBody } from "@/app/api/inbox+api";
import { stripAttachmentBlocks } from "@/lib/ai/attachmentMessage";
import { describeNow, selectRelevantTasks, taskToContext } from "@/lib/ai/context";
import { createCandidateId, extractTasks } from "@/lib/ai/extractTasks";
import {
  isAmbiguousDate,
  looksLikeDate,
  parseDateRange,
  parseDeadlinePhrase,
  type ParsedDeadline,
} from "@/lib/ai/parseDate";
import { resolveTaskReference } from "@/lib/ai/resolveTaskReference";
import type { StructuredAction } from "@/lib/ai/types";
import { apiPost } from "@/lib/api";
import { deadlineInstant, makeDeadline } from "@/lib/deadline";
import { getLanguage, translate } from "@/lib/i18n";
import type { RecurrenceScope, RuleInput } from "@/lib/recurrence";
import { IMPORTANCE_LEVELS, rankTasksForNext, type ImportanceLevel } from "@/lib/scoring";
import type { TaskChanges, TaskFilter, TaskOperation, TaskStatusFilter, TaskTarget } from "@/lib/taskOperations";
import type { AppLanguage } from "@/types/settings";
import type { Task, Weekday } from "@/types/task";

export type ClassifyIntentInput = {
  text: string;
  now: Date;
  currentTaskId?: string;
  recentTaskIds: string[];
  tasks: Task[];
  history?: { role: "user" | "ai"; text: string }[];
};

// A turn can produce several actions (compound messages, taxonomy 6.1).
// `replies` lines up with `actions`: what the model said about each one, or
// null from the offline heuristic, which has no narration of its own — the
// chat then uses the app's own message for it. `reply` is all of them joined.
export type ClassifiedTurn = { actions: StructuredAction[]; replies: (string | null)[]; reply: string | null };

const VALID_PRIORITIES: readonly ImportanceLevel[] = IMPORTANCE_LEVELS;

// Must match MAX_TASKS in app/api/inbox+api.ts, which keeps only the first
// that-many tasks it receives. Up to that many go in full (duplicate
// detection, "what's overdue" and "I'm overwhelmed" — taxonomy 1.1, 4.3, 5.4
// — want the whole list); past that, the ones this message is most likely
// about go first: the task in view, the ones just discussed, any named in the
// message (completed ones included), then the highest priority, then the most
// recently finished. Bulk actions reach tasks beyond this through their
// filters, which the app applies to the whole list.
const MAX_TASKS_SENT = 30;

/**
 * The model sees short ids ("t1", "t2", …) instead of the real ones: fewer
 * tokens per task, and an id it made up can't accidentally match a real task —
 * anything not in this map is simply "not found".
 */
function buildAliases(tasks: Task[]) {
  const toAlias = new Map<string, string>();
  const fromAlias = new Map<string, string>();
  tasks.forEach((task, index) => {
    const alias = `t${index + 1}`;
    toAlias.set(task.id, alias);
    fromAlias.set(alias, task.id);
  });
  return { toAlias, fromAlias };
}

type MapContext = {
  now: Date;
  language: AppLanguage;
  fallbackNote: string;
  /** The real id for an alias, or null for one the model invented. */
  realId: (alias: string | null) => string | null;
};

type ResolvedDeadline = {
  deadline?: ParsedDeadline;
  /** A deadline was named but can't be pinned down ("3/4", "the 3rd week of term") — ask, don't guess. */
  unclear?: string;
};

/**
 * The deadline an action names, worked out here on the device — in the
 * user's time zone, which the server doesn't know. The model's English phrase
 * is read with every language's rules (as it always was); the user's own
 * words, when the server fell back to them, in the app language. A day
 * without a clock time stays a date-only deadline: "October 15" is never
 * saved as October 15 at some hour nobody said.
 */
function resolveDeadline(fields: InboxAction["fields"], ctx: MapContext): ResolvedDeadline {
  if (fields.dueDateAmbiguous) return { unclear: fields.dueDatePhrase ?? fields.dueDateText ?? "" };
  if (fields.dueDateText) {
    const deadline = parseDeadlinePhrase(fields.dueDateText, ctx.now, ctx.language);
    if (deadline) return { deadline };
  }
  if (fields.dueDatePhrase) {
    const deadline = parseDeadlinePhrase(fields.dueDatePhrase, ctx.now);
    if (deadline) return { deadline };
    if (isAmbiguousDate(fields.dueDatePhrase) || looksLikeDate(fields.dueDatePhrase)) return { unclear: fields.dueDatePhrase };
  }
  return {};
}

/** A clarifying question about a deadline that couldn't be read — the tasks wait for the answer. */
function askAboutDate(unclear: string): StructuredAction {
  const t = translate();
  return { type: "CLARIFY", question: unclear ? t.ops.dateUnclear(unclear) : t.ops.whichDates, candidates: [], confirmationTier: "safe" };
}

function toRuleInput(recurrence: InboxRecurrence | undefined, ctx: MapContext): RuleInput | null | undefined {
  if (!recurrence) return undefined;
  if (recurrence.frequency === "none") return null;
  const end = recurrence.endDatePhrase ? parseDeadlinePhrase(recurrence.endDatePhrase, ctx.now) : undefined;
  return {
    frequency: recurrence.frequency,
    interval: recurrence.interval,
    weekdays: recurrence.weekdays?.filter((day): day is Weekday => day >= 0 && day <= 6),
    monthDay: recurrence.monthDay,
    endDate: end?.date,
  };
}

/** Null when a date phrase in the filter couldn't be read — better to ask than to act on too many tasks. */
function toTaskFilter(filter: InboxFilter | null, ctx: MapContext): TaskFilter | null {
  if (!filter) return {};
  const result: TaskFilter = {
    status: filter.status as TaskStatusFilter | undefined,
    keywords: filter.titleKeywords,
    recurring: filter.recurring,
    hasDeadline: filter.hasDeadline,
    priority: filter.priority,
  };
  if (filter.dueWithin) {
    const range = parseDateRange(filter.dueWithin, ctx.now, "en");
    if (!range) return null;
    result.dueFrom = range.from;
    result.dueTo = range.to;
  }
  if (filter.completedWithin) {
    const range = parseDateRange(filter.completedWithin, ctx.now, "en");
    if (!range) return null;
    result.completedFrom = range.from;
    result.completedTo = range.to;
    result.status ??= "completed";
  }
  return result;
}

function buildChanges(action: InboxAction, ctx: MapContext, bulk: boolean): TaskChanges {
  const { fields } = action;
  const changes: TaskChanges = {};
  // A bulk rename would give every task the same name — never what's meant.
  if (fields.title && !bulk) changes.title = fields.title;
  if (typeof fields.estimatedMinutesDelta === "number" && fields.estimatedMinutesDelta !== 0) {
    changes.estimatedMinutesDelta = fields.estimatedMinutesDelta;
  } else if (typeof fields.estimatedMinutes === "number" && fields.estimatedMinutes > 0) {
    changes.estimatedMinutes = fields.estimatedMinutes;
  }
  if (VALID_PRIORITIES.includes(fields.priority as ImportanceLevel)) changes.priority = fields.priority as ImportanceLevel;
  if (fields.dueDateShift) {
    changes.dueShift = fields.dueDateShift;
  } else {
    const { deadline } = resolveDeadline(fields, ctx);
    if (deadline) {
      changes.deadline = deadline;
      // "Move it to Friday" keeps the time it was due at (none for a
      // date-only task); "Friday at 3" sets one.
      changes.keepTimeOfDay = !deadline.time;
    }
  }
  const recurrence = toRuleInput(fields.recurrence, ctx);
  if (recurrence !== undefined) changes.recurrence = recurrence;
  return changes;
}

/** One task by id, or null when the model pointed at one it wasn't given. */
function singleTarget(action: InboxAction, ctx: MapContext): TaskTarget | null {
  const id = ctx.realId(action.taskId) ?? (action.taskIds?.length === 1 ? ctx.realId(action.taskIds[0]) : null);
  return id ? { taskIds: [id] } : null;
}

type BulkTargetResult = { target: TaskTarget } | { notFound: true };

function bulkTarget(action: InboxAction, ctx: MapContext): BulkTargetResult | null {
  const ids = (action.taskIds ?? []).map((alias) => ctx.realId(alias)).filter((id): id is string => !!id);
  const filter = toTaskFilter(action.filter, ctx);
  if (!filter) return null;
  const hasFilterCriteria = Object.values(filter).some((value) => (Array.isArray(value) ? value.length > 0 : value !== undefined));
  if ((action.taskIds?.length ?? 0) > 0 && ids.length === 0 && !hasFilterCriteria) return { notFound: true };
  // Ids for the tasks it could see, keywords for ones it couldn't: both count.
  if (ids.length > 0 && filter.keywords?.length) return { target: { taskIds: ids, filter } };
  if (ids.length > 0) return { target: { taskIds: ids } };
  return { target: { filter } };
}

const SINGLE_KIND: Partial<Record<InboxAction["type"], TaskOperation["kind"]>> = {
  UPDATE_TASK: "update",
  COMPLETE_TASK: "complete",
  REOPEN_TASK: "reopen",
  DELETE_TASK: "delete",
};

const BULK_KIND: Partial<Record<InboxAction["type"], TaskOperation["kind"]>> = {
  UPDATE_TASKS: "update",
  COMPLETE_TASKS: "complete",
  REOPEN_TASKS: "reopen",
  DELETE_TASKS: "delete",
};

function operationFor(
  kind: TaskOperation["kind"],
  target: TaskTarget,
  action: InboxAction,
  ctx: MapContext,
  bulk: boolean,
): TaskOperation {
  const scope = action.fields.recurrenceScope as RecurrenceScope | undefined;
  switch (kind) {
    case "update":
      return { kind, target, changes: buildChanges(action, ctx, bulk), scope };
    case "delete":
      return { kind, target, scope };
    default:
      return { kind, target };
  }
}

// Which actions need a yes/no first is settled on the device, whatever the
// model set: a create always shows its preview, and useChatStore asks before
// anything that reaches several tasks or a whole series.
function mapSingleAction(action: InboxAction, ctx: MapContext): StructuredAction | null {
  const t = translate();
  if (action.type === "CREATE_TASK" && action.fields.title) {
    const priorityLevel = VALID_PRIORITIES.includes(action.fields.priority as ImportanceLevel)
      ? (action.fields.priority as ImportanceLevel)
      : "medium";
    const { deadline, unclear } = resolveDeadline(action.fields, ctx);
    if (unclear !== undefined) return askAboutDate(unclear);
    const saved = deadline ? makeDeadline(deadline) : undefined;
    return {
      type: "CREATE_TASK",
      drafts: [
        {
          candidateId: createCandidateId(),
          title: action.fields.title,
          estimatedMinutes: action.fields.estimatedMinutes ?? 30,
          dueDate: saved ? deadlineInstant(saved).toISOString() : undefined,
          dueHasTime: saved ? !!saved.time : undefined,
          priorityLevel,
          steps: action.fields.steps,
          recurrence: toRuleInput(action.fields.recurrence, ctx) ?? undefined,
        },
      ],
      confirmationTier: "confirm-required",
    };
  }

  const singleKind = SINGLE_KIND[action.type];
  if (singleKind) {
    const target = singleTarget(action, ctx);
    if (!target) return { type: "UNKNOWN", reply: t.ops.notFound, confirmationTier: "safe" };
    if (singleKind === "update" && !action.fields.dueDateShift) {
      const { unclear } = resolveDeadline(action.fields, ctx);
      if (unclear !== undefined) return askAboutDate(unclear);
    }
    return {
      type: "OPERATE",
      operation: operationFor(singleKind, target, action, ctx, false),
      confirmationTier: singleKind === "update" && action.confirmationRequired ? "confirm-required" : "immediate",
    };
  }

  const bulkKind = BULK_KIND[action.type];
  if (bulkKind) {
    const result = bulkTarget(action, ctx);
    if (!result) return { type: "CLARIFY", question: t.ops.whichDates, candidates: [], confirmationTier: "safe" };
    if ("notFound" in result) return { type: "UNKNOWN", reply: t.ops.notFound, confirmationTier: "safe" };
    return { type: "OPERATE", operation: operationFor(bulkKind, result.target, action, ctx, true), confirmationTier: "confirm-required" };
  }

  if (action.type === "LIST_TASKS") {
    const filter = toTaskFilter(action.filter, ctx);
    if (!filter) return { type: "CLARIFY", question: t.ops.whichDates, candidates: [], confirmationTier: "safe" };
    return { type: "LIST_TASKS", filter, confirmationTier: "safe" };
  }

  const taskId = ctx.realId(action.taskId);

  if (action.type === "ADD_CONTEXT" && taskId) {
    return {
      type: "ADD_TASK_CONTEXT",
      taskId,
      note: action.fields.note ?? ctx.fallbackNote,
      estimatedMinutes: action.fields.estimatedMinutes,
      confirmationTier: "safe",
    };
  }

  if (action.type === "BREAKDOWN_TASK" && taskId && action.fields.steps?.length) {
    return { type: "BREAKDOWN_TASK", taskId, steps: action.fields.steps, confirmationTier: "confirm-required" };
  }

  if (action.type === "REDIRECT_NEXT" && typeof action.fields.availableMinutes === "number") {
    return { type: "REDIRECT_NEXT", availableMinutes: action.fields.availableMinutes, confirmationTier: "safe" };
  }

  // NONE — an answer, a question back, or chit-chat: the reply is the action.
  if (action.reply?.trim()) return { type: "QUERY", answer: action.reply.trim(), confirmationTier: "safe" };
  return null;
}

/**
 * One action in /api/inbox's shape, turned into what the app carries out —
 * for live voice (lib/liveVoiceTools.ts), whose tool calls arrive in that
 * same shape, so a spoken change is resolved exactly like a typed one.
 */
export function toStructuredAction(
  action: InboxAction,
  options: { now: Date; realId: (alias: string | null) => string | null },
): StructuredAction | null {
  return mapSingleAction(action, {
    now: options.now,
    language: getLanguage(),
    fallbackNote: action.fields.note ?? "",
    realId: options.realId,
  });
}

/** Titles compared the way a person would: case, accents and spacing aside. */
function titleKey(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function mapInboxResponse(response: InboxResponseBody, ctx: MapContext): ClassifiedTurn {
  const actions: StructuredAction[] = [];
  const replies: (string | null)[] = [];
  // The same task said twice in one message ("…call mum, and don't forget to
  // call mum") is one task: only its first mention becomes a card.
  const newTitles = new Set<string>();
  for (const action of response.actions) {
    const mapped = mapSingleAction(action, ctx);
    if (!mapped) continue;
    if (mapped.type === "CREATE_TASK") {
      const drafts = mapped.drafts.filter((draft) => {
        const key = titleKey(draft.title);
        if (newTitles.has(key)) return false;
        newTitles.add(key);
        return true;
      });
      if (drafts.length === 0) continue;
      mapped.drafts = drafts;
    }
    actions.push(mapped);
    replies.push(action.reply?.trim() || null);
  }
  const reply = response.reply?.trim() || null;
  if (actions.length === 0) {
    return {
      actions: [{ type: "UNKNOWN", reply: reply ?? translate().common.aiUnreachable, confirmationTier: "safe" }],
      replies: [reply],
      reply,
    };
  }
  return { actions, replies, reply };
}

const DELETE_PATTERN = /\b(delete|remove|cancel)\b/i;
const BULK_PATTERN = /\b(all|every|everything)\b/i;
// Checked before COMPLETED_SCOPE_PATTERN — "uncompleted"/"incomplete" contain "complete".
const PENDING_SCOPE_PATTERN = /\b(pending|uncompleted|incomplete|unfinished|not done|open|active|remaining)\b/i;
const COMPLETED_SCOPE_PATTERN = /\b(completed?|done|finished)\b/i;
const ALREADY_DID_PATTERN = /\balready (did|finished|completed|done|started)\b/i;
const REOPEN_PATTERN = /\b(reopen|re-open|unmark|undo (?:the )?completion|not (?:actually )?(?:done|finished))\b/i;
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

function operate(operation: TaskOperation, bulk = false): StructuredAction {
  return { type: "OPERATE", operation, confirmationTier: bulk ? "confirm-required" : "immediate" };
}

// Ordered keyword/regex rules — used as an offline fallback if the real
// Gemini call below fails (no network, missing API key, malformed output),
// so the inbox degrades gracefully instead of breaking. They produce the same
// operations the AI path does, so everything downstream is shared.
// Order matters — more specific/destructive intents are checked first so a
// message like "delete the essay, it's already done" resolves to delete.
function classifyIntentHeuristic(input: ClassifyIntentInput): StructuredAction {
  const { text, now, currentTaskId, recentTaskIds, tasks } = input;
  const referenceCtx = { currentTaskId, recentTaskIds, tasks };
  const t = translate();

  if (DELETE_PATTERN.test(text) && BULK_PATTERN.test(text)) {
    const status: TaskStatusFilter = PENDING_SCOPE_PATTERN.test(text)
      ? "pending"
      : COMPLETED_SCOPE_PATTERN.test(text)
        ? "completed"
        : "all";
    return operate({ kind: "delete", target: { filter: { status } } }, true);
  }

  if (DELETE_PATTERN.test(text)) {
    const ref = resolveTaskReference(text, referenceCtx, { includeCompleted: true });
    if (ref.status === "resolved") return operate({ kind: "delete", target: { taskIds: [ref.taskId] } });
    if (ref.status === "ambiguous") return askWhich(ref.candidates);
    return { type: "UNKNOWN", reply: t.assistant.whichDelete, confirmationTier: "safe" };
  }

  if (REOPEN_PATTERN.test(text)) {
    const ref = resolveTaskReference(text, referenceCtx, { onlyCompleted: true });
    if (ref.status === "resolved") return operate({ kind: "reopen", target: { taskIds: [ref.taskId] } });
    if (ref.status === "ambiguous") return askWhich(ref.candidates);
  }

  if (ALREADY_DID_PATTERN.test(text) && currentTaskId) {
    return { type: "ADD_TASK_CONTEXT", taskId: currentTaskId, note: text, confirmationTier: "safe" };
  }

  // "mark all my tasks as done" / "I finished everything".
  if (DONE_PATTERN.test(text) && BULK_PATTERN.test(text)) {
    return operate({ kind: "complete", target: { filter: { status: "pending" } } }, true);
  }

  if (DONE_PATTERN.test(text)) {
    const ref = resolveTaskReference(text, referenceCtx);
    if (ref.status === "resolved") return operate({ kind: "complete", target: { taskIds: [ref.taskId] } });
    if (ref.status === "ambiguous") return askWhich(ref.candidates);
  }

  if (RESCHEDULE_PATTERN.test(text)) {
    const ref = resolveTaskReference(text, referenceCtx, { includeCompleted: true });
    const deadline = parseDeadlinePhrase(text, now, getLanguage());
    if (ref.status === "resolved" && deadline) {
      return operate({
        kind: "update",
        target: { taskIds: [ref.taskId] },
        changes: { deadline, keepTimeOfDay: !deadline.time },
      });
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
    const selected = selectRelevantTasks(input.text, input.tasks, input.recentTaskIds, input.currentTaskId, MAX_TASKS_SENT);
    const { toAlias, fromAlias } = buildAliases(selected);
    const request: InboxRequestBody = {
      message: input.text,
      now: input.now.toISOString(),
      today: describeNow(input.now),
      currentTaskId: input.currentTaskId ? toAlias.get(input.currentTaskId) : undefined,
      recentTaskIds: input.recentTaskIds.map((id) => toAlias.get(id)).filter((id): id is string => !!id),
      tasks: selected.map((task) => ({ ...taskToContext(task, input.now), id: toAlias.get(task.id)! })),
      history: input.history ?? [],
      language: getLanguage(),
    };
    const response = await apiPost<InboxResponseBody>("/api/inbox", request);
    return mapInboxResponse(response, {
      now: input.now,
      language: getLanguage(),
      fallbackNote: input.text,
      realId: (alias) => (alias ? (fromAlias.get(alias) ?? null) : null),
    });
  } catch (error) {
    console.warn("[classifyIntent] falling back to heuristic", error);
    // The heuristic reads raw words, so the "[Attached image]" labels a
    // message with files is built from come back out first.
    return {
      actions: [classifyIntentHeuristic({ ...input, text: stripAttachmentBlocks(input.text) })],
      replies: [null],
      reply: null,
    };
  }
}
