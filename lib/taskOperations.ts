import {
  buildNextOccurrence,
  buildRule,
  openOccurrence,
  retimeRule,
  seriesOccurrences,
  slotDueDate,
  startSeries,
  templateFromTask,
  toLocalDateKey,
  type RecurrenceScope,
  type RuleInput,
} from "@/lib/recurrence";
import { PRIORITY_LEVEL_IMPORTANCE } from "@/lib/scoring";
import type { Subtask, Task, TaskPriorityLevel } from "@/types/task";

// The structured task-operation system. Every change the AI asks for — and the
// store's own complete / reopen / edit / delete — is planned here as pure data
// first: which rows change, which appear, which go, and what each task's
// outcome was. useTaskStore.applyPlan then commits a plan in one state update
// and one sync round-trip, and the chat reports the outcomes, so what the user
// is told is always what was actually written.

export type { RecurrenceScope } from "@/lib/recurrence";

export type DateShift = { amount: number; unit: "minutes" | "hours" | "days" | "weeks" | "months" };

export type TaskChanges = {
  title?: string;
  notes?: string | null;
  /** An absolute deadline (ISO), or null to remove it. */
  dueDate?: string | null;
  /** With `dueDate` from a phrase that named no clock time: keep each task's own time of day. */
  keepTimeOfDay?: boolean;
  /** Moves each deadline by this much, keeping its time of day. */
  dueShift?: DateShift;
  estimatedMinutes?: number;
  estimatedMinutesDelta?: number;
  priority?: TaskPriorityLevel;
  /** Start or change repeating; null stops it. */
  recurrence?: RuleInput | null;
};

export type TaskStatusFilter = "pending" | "completed" | "overdue" | "all";

export type TaskFilter = {
  status?: TaskStatusFilter;
  /** Any of these, case- and accent-insensitive, in the title. */
  keywords?: string[];
  /** Deadline inside [dueFrom, dueTo] (ISO, inclusive). */
  dueFrom?: string;
  dueTo?: string;
  completedFrom?: string;
  completedTo?: string;
  hasDeadline?: boolean;
  recurring?: boolean;
  priority?: TaskPriorityLevel;
};

/**
 * Which tasks an operation reaches: explicit ids, a filter over the whole
 * list, or both (the tasks the model could see by id, plus keyword matches it
 * couldn't). Neither means every task, with the operation's default status.
 */
export type TaskTarget = { taskIds?: string[]; filter?: TaskFilter };

export type TaskOperation =
  | { kind: "update"; target: TaskTarget; changes: TaskChanges; scope?: RecurrenceScope }
  | { kind: "complete"; target: TaskTarget }
  | { kind: "reopen"; target: TaskTarget }
  | { kind: "delete"; target: TaskTarget; scope?: RecurrenceScope };

export type OutcomeKind = "updated" | "completed" | "reopened" | "deleted" | "skipped" | "unchanged";

export type UnchangedReason =
  | "already-completed"
  | "already-open"
  | "no-deadline"
  | "nothing-to-change"
  | "invalid-change";

export type TaskOutcome = {
  taskId: string;
  title: string;
  outcome: OutcomeKind;
  reason?: UnchangedReason;
  /** The task was (and stays) completed when it was edited. */
  wasCompleted?: boolean;
  recurring?: boolean;
  /** For a completed or skipped occurrence: the one that replaced it. */
  next?: { id: string; dueDate?: string };
  /** How many occurrences a series-wide delete removed. */
  removedCount?: number;
  newDueDate?: string;
};

export type OperationPlan = {
  /** Final versions of every task that changes or appears. Scores are recomputed by the store. */
  upserts: Task[];
  deletes: string[];
  /** The version before this plan, for undo; null for a task the plan creates. */
  before: { taskId: string; before: Task | null }[];
  outcomes: TaskOutcome[];
  /** Ids asked for that no longer exist. */
  missingIds: string[];
};

const LEVEL_THRESHOLDS: { level: TaskPriorityLevel; min: number }[] = [
  { level: "high", min: 63 },
  { level: "medium", min: 38 },
  { level: "low", min: 0 },
];

/** The picker level an importance value belongs to (75 / 50 / 25, or anything in between). */
export function priorityLevelOf(importance: number): TaskPriorityLevel {
  return LEVEL_THRESHOLDS.find((entry) => importance >= entry.min)?.level ?? "low";
}

export function isOverdue(task: Task, now: Date): boolean {
  return task.status === "pending" && !!task.dueDate && Date.parse(task.dueDate) < now.getTime();
}

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function inRange(iso: string | undefined, from?: string, to?: string): boolean {
  if (!iso) return false;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return false;
  if (from && time < Date.parse(from)) return false;
  if (to && time > Date.parse(to)) return false;
  return true;
}

/** What "all my tasks" means when the request doesn't say: open tasks, except when reopening or deleting. */
export function defaultStatusFor(kind: TaskOperation["kind"]): TaskStatusFilter {
  if (kind === "reopen") return "completed";
  if (kind === "delete") return "all";
  return "pending";
}

export function matchesFilter(task: Task, filter: TaskFilter, now: Date): boolean {
  const status = filter.status ?? "all";
  if (status === "pending" && task.status !== "pending") return false;
  if (status === "completed" && task.status !== "completed") return false;
  if (status === "overdue" && !isOverdue(task, now)) return false;

  if (filter.keywords?.length) {
    const title = fold(task.title);
    if (!filter.keywords.some((keyword) => keyword.trim() && title.includes(fold(keyword.trim())))) return false;
  }
  if ((filter.dueFrom || filter.dueTo) && !inRange(task.dueDate, filter.dueFrom, filter.dueTo)) return false;
  if ((filter.completedFrom || filter.completedTo) && !inRange(task.completedAt, filter.completedFrom, filter.completedTo)) {
    return false;
  }
  if (filter.hasDeadline !== undefined && Boolean(task.dueDate) !== filter.hasDeadline) return false;
  if (filter.recurring !== undefined && Boolean(task.recurrence) !== filter.recurring) return false;
  if (filter.priority && priorityLevelOf(task.importance) !== filter.priority) return false;
  return true;
}

/** The tasks an operation applies to, in list order, plus any ids that no longer exist. */
export function resolveTarget(
  tasks: Task[],
  target: TaskTarget,
  kind: TaskOperation["kind"],
  now: Date,
): { tasks: Task[]; missingIds: string[] } {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const ids = [...new Set(target.taskIds ?? [])];
  const picked = ids.map((id) => byId.get(id)).filter((task): task is Task => !!task);
  const missingIds = ids.filter((id) => !byId.has(id));
  if (ids.length > 0 && !target.filter) return { tasks: picked, missingIds };

  const filter = { ...target.filter, status: target.filter?.status ?? defaultStatusFor(kind) };
  const pickedIds = new Set(picked.map((task) => task.id));
  const matched = tasks.filter((task) => !pickedIds.has(task.id) && matchesFilter(task, filter, now));
  return { tasks: [...picked, ...matched], missingIds };
}

// ---------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------

/** Adds months on the local calendar, landing on the last day of a shorter month rather than spilling over. */
function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
}

/**
 * Days, weeks and months move on the local calendar (setDate/setMonth), so a
 * task due at 9:00 is still due at 9:00 after the shift, daylight saving or
 * not. Minutes and hours are exact elapsed time.
 */
export function shiftDate(iso: string, shift: DateShift): string {
  const date = new Date(iso);
  switch (shift.unit) {
    case "minutes":
      return new Date(date.getTime() + shift.amount * 60_000).toISOString();
    case "hours":
      return new Date(date.getTime() + shift.amount * 3_600_000).toISOString();
    case "days":
      date.setDate(date.getDate() + shift.amount);
      return date.toISOString();
    case "weeks":
      date.setDate(date.getDate() + shift.amount * 7);
      return date.toISOString();
    case "months":
      return addMonths(date, shift.amount).toISOString();
  }
}

/** `target`'s calendar day with `timeSource`'s time of day. */
function withTimeOf(target: string, timeSource: string): string {
  const date = new Date(target);
  const time = new Date(timeSource);
  date.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return date.toISOString();
}

// ---------------------------------------------------------------------
// Single-task transforms, shared by the store's UI actions and the AI
// ---------------------------------------------------------------------

type TaskDelta = { upserts: Task[]; deletes: string[]; outcome: TaskOutcome };

function outcomeFor(task: Task, outcome: OutcomeKind, extra: Partial<TaskOutcome> = {}): TaskOutcome {
  return { taskId: task.id, title: task.title, outcome, recurring: Boolean(task.recurrence), ...extra };
}

function remainingMinutes(subtasks: Subtask[]): number {
  return subtasks.filter((subtask) => subtask.status !== "completed").reduce((sum, s) => sum + s.estimatedMinutes, 0);
}

/**
 * Marks a task done. A repeating task's completion also brings in its next
 * occurrence, unless that occurrence already exists (another device, or an
 * earlier completion that was reopened and redone) or the series has ended.
 */
export function completeTaskDelta(task: Task, now: Date, allTasks: Task[], patch: Partial<Task> = {}): TaskDelta {
  if (task.status === "completed") {
    return { upserts: [], deletes: [], outcome: outcomeFor(task, "unchanged", { reason: "already-completed" }) };
  }
  const nowIso = now.toISOString();
  const completed: Task = { ...task, ...patch, status: "completed", completedAt: nowIso, updatedAt: nowIso };
  const next = buildNextOccurrence(completed, now);
  if (!next) {
    return { upserts: [completed], deletes: [], outcome: outcomeFor(task, "completed") };
  }
  const existing = allTasks.find((candidate) => candidate.id === next.id);
  if (existing) {
    return {
      upserts: [completed],
      deletes: [],
      outcome: outcomeFor(task, "completed", { next: { id: existing.id, dueDate: existing.dueDate } }),
    };
  }
  completed.recurrence = { ...completed.recurrence!, nextOccurrenceId: next.id };
  return {
    upserts: [completed, next],
    deletes: [],
    outcome: outcomeFor(task, "completed", { next: { id: next.id, dueDate: next.dueDate } }),
  };
}

/**
 * Reopens a finished task: every step back to pending, the first one current.
 * If completing it had created the series' next occurrence and nobody has
 * touched that one since, it goes again — otherwise an accidental tick would
 * leave two open occurrences behind.
 */
export function reopenTaskDelta(task: Task, now: Date, allTasks: Task[]): TaskDelta {
  if (task.status !== "completed") {
    return { upserts: [], deletes: [], outcome: outcomeFor(task, "unchanged", { reason: "already-open" }) };
  }
  const reopenedSubtasks = task.subtasks?.length
    ? task.subtasks
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((subtask, index) => ({
          ...subtask,
          status: index === 0 ? ("current" as const) : ("pending" as const),
        }))
    : undefined;
  const nowIso = now.toISOString();
  const reopened: Task = {
    ...task,
    status: "pending",
    subtasks: reopenedSubtasks,
    currentStepId: reopenedSubtasks?.[0]?.id,
    estimatedMinutes: reopenedSubtasks?.length ? remainingMinutes(reopenedSubtasks) : Math.max(task.estimatedMinutes, 1),
    completedAt: undefined,
    updatedAt: nowIso,
  };
  const deletes: string[] = [];
  if (task.recurrence) {
    const { nextOccurrenceId, ...recurrence } = task.recurrence;
    reopened.recurrence = recurrence;
    const next = nextOccurrenceId ? allTasks.find((candidate) => candidate.id === nextOccurrenceId) : undefined;
    if (next && next.status === "pending" && next.createdAt === next.updatedAt) deletes.push(next.id);
  }
  return { upserts: [reopened], deletes, outcome: outcomeFor(task, "reopened") };
}

/** Removes one occurrence and brings in the one after it — "skip this week's". */
export function skipOccurrenceDelta(task: Task, now: Date, allTasks: Task[]): TaskDelta {
  if (!task.recurrence || task.status === "completed") {
    return { upserts: [], deletes: [task.id], outcome: outcomeFor(task, "deleted") };
  }
  const next = buildNextOccurrence(task, now);
  if (!next) return { upserts: [], deletes: [task.id], outcome: outcomeFor(task, "deleted") };
  const existing = allTasks.find((candidate) => candidate.id === next.id);
  return {
    upserts: existing ? [] : [next],
    deletes: [task.id],
    outcome: outcomeFor(task, "skipped", {
      next: { id: next.id, dueDate: (existing ?? next).dueDate },
    }),
  };
}

function validTitle(title: string | undefined): string | undefined {
  const trimmed = title?.trim();
  return trimmed && trimmed.length <= 200 ? trimmed : undefined;
}

function clampMinutes(minutes: number): number {
  return Math.min(10_000, Math.max(1, Math.round(minutes)));
}

/**
 * Applies `changes` to one task. On a repeating task the scope decides how far
 * they reach: "this" edits only this occurrence; "future" also rewrites the
 * template (and re-times the rule for a new day/time) so later occurrences
 * follow; "series" additionally renames/re-rates the completed history.
 */
export function editTaskDelta(
  task: Task,
  changes: TaskChanges,
  scope: RecurrenceScope | undefined,
  now: Date,
  allTasks: Task[],
): TaskDelta {
  const nowIso = now.toISOString();
  let next: Task = { ...task };
  let changed = false;
  let dueChanged = false;
  let skippedForNoDeadline = false;

  const title = changes.title === undefined ? undefined : validTitle(changes.title);
  if (title && title !== task.title) {
    next.title = title;
    changed = true;
  }
  if (changes.notes !== undefined) {
    const notes = changes.notes?.trim() || undefined;
    if (notes !== task.notes) {
      next.notes = notes;
      changed = true;
    }
  }

  if (changes.dueDate !== undefined) {
    if (changes.dueDate === null) {
      // A repeating occurrence always has a day; removing it would orphan the series.
      if (!task.recurrence && task.dueDate) {
        next.dueDate = undefined;
        changed = dueChanged = true;
      }
    } else if (!Number.isNaN(Date.parse(changes.dueDate))) {
      const due = changes.keepTimeOfDay && task.dueDate ? withTimeOf(changes.dueDate, task.dueDate) : changes.dueDate;
      if (due !== task.dueDate) {
        next.dueDate = due;
        changed = dueChanged = true;
      }
    }
  } else if (changes.dueShift && Number.isFinite(changes.dueShift.amount) && changes.dueShift.amount !== 0) {
    if (task.dueDate) {
      next.dueDate = shiftDate(task.dueDate, changes.dueShift);
      changed = dueChanged = true;
    } else {
      skippedForNoDeadline = true;
    }
  }

  let templateMinutes: number | undefined;
  if (changes.estimatedMinutes !== undefined && Number.isFinite(changes.estimatedMinutes)) {
    const minutes = clampMinutes(changes.estimatedMinutes);
    if (minutes !== task.estimatedMinutes) {
      next.estimatedMinutes = minutes;
      changed = true;
    }
    templateMinutes = minutes;
  } else if (changes.estimatedMinutesDelta !== undefined && Number.isFinite(changes.estimatedMinutesDelta) && changes.estimatedMinutesDelta !== 0) {
    next.estimatedMinutes = clampMinutes(task.estimatedMinutes + changes.estimatedMinutesDelta);
    changed = true;
    if (task.recurrence) {
      templateMinutes = clampMinutes(task.recurrence.template.estimatedMinutes + changes.estimatedMinutesDelta);
    }
  }

  if (changes.priority && PRIORITY_LEVEL_IMPORTANCE[changes.priority] !== undefined) {
    const importance = PRIORITY_LEVEL_IMPORTANCE[changes.priority];
    if (importance !== task.importance) {
      next.importance = importance;
      changed = true;
    }
  }

  // Repeating: start, change or stop it. The rule is the series', so this
  // always reaches future occurrences whatever the scope.
  if (changes.recurrence !== undefined) {
    if (changes.recurrence === null) {
      if (task.recurrence) {
        next.recurrence = undefined;
        changed = true;
      }
    } else {
      const rule = buildRule(changes.recurrence, next.dueDate, now);
      if (rule) {
        const seriesId = task.recurrence?.seriesId;
        const started = startSeries({ ...next, recurrence: undefined }, rule, seriesId);
        // An existing series keeps its template, apart from what this edit changed.
        if (task.recurrence && started.recurrence) {
          started.recurrence.template = { ...task.recurrence.template, ...pickTemplateChanges(next, task) };
        }
        next = started;
        changed = dueChanged = true;
      } else {
        return { upserts: [], deletes: [], outcome: outcomeFor(task, "unchanged", { reason: "invalid-change" }) };
      }
    }
  } else if (task.recurrence && next.recurrence && (scope === "future" || scope === "series")) {
    // The template follows so later occurrences look like this one.
    const template = { ...task.recurrence.template, ...pickTemplateChanges(next, task) };
    if (templateMinutes !== undefined) template.estimatedMinutes = templateMinutes;
    let recurrence = { ...next.recurrence, template };
    if (dueChanged && next.dueDate) {
      const rule = retimeRule(recurrence.rule, recurrence.occurrenceDate, new Date(next.dueDate));
      recurrence = { ...recurrence, rule, occurrenceDate: toLocalDateKey(new Date(next.dueDate)) };
      next.dueDate = slotDueDate(rule, recurrence.occurrenceDate);
    }
    next.recurrence = recurrence;
  }

  if (!changed) {
    return {
      upserts: [],
      deletes: [],
      outcome: outcomeFor(task, "unchanged", {
        reason: skippedForNoDeadline ? "no-deadline" : "nothing-to-change",
        wasCompleted: task.status === "completed",
      }),
    };
  }

  next.updatedAt = nowIso;
  const upserts = [next];

  // "series": the completed history takes the new title / length / importance / notes too.
  if (scope === "series" && task.recurrence) {
    const historyPatch = pickTemplateChanges(next, task);
    if (Object.keys(historyPatch).length > 0) {
      for (const other of seriesOccurrences(allTasks, task.recurrence.seriesId)) {
        if (other.id === task.id) continue;
        const patched: Task = { ...other, updatedAt: nowIso };
        if (historyPatch.title) patched.title = historyPatch.title;
        if (historyPatch.notes !== undefined) patched.notes = historyPatch.notes;
        if (historyPatch.importance !== undefined) patched.importance = historyPatch.importance;
        upserts.push(patched);
      }
    }
  }

  return {
    upserts,
    deletes: [],
    outcome: outcomeFor(task, "updated", {
      wasCompleted: task.status === "completed",
      newDueDate: dueChanged ? next.dueDate : undefined,
    }),
  };
}

/** The template fields this edit changed, compared with the task before it. */
function pickTemplateChanges(next: Task, before: Task): Partial<ReturnType<typeof templateFromTask>> {
  const patch: Partial<ReturnType<typeof templateFromTask>> = {};
  if (next.title !== before.title) patch.title = next.title;
  if (next.notes !== before.notes) patch.notes = next.notes;
  if (next.importance !== before.importance) patch.importance = next.importance;
  if (next.estimatedMinutes !== before.estimatedMinutes) patch.estimatedMinutes = next.estimatedMinutes;
  return patch;
}

/**
 * Deletes one task. For a repeating one the scope decides: "this" skips just
 * this occurrence (the next one takes its place), "future" ends the series but
 * keeps what's already been done, "series" removes every occurrence.
 */
export function deleteTaskDelta(task: Task, scope: RecurrenceScope | undefined, now: Date, allTasks: Task[]): TaskDelta {
  if (!task.recurrence) return { upserts: [], deletes: [task.id], outcome: outcomeFor(task, "deleted") };
  const occurrences = seriesOccurrences(allTasks, task.recurrence.seriesId);
  if (scope === "series") {
    return {
      upserts: [],
      deletes: occurrences.map((occurrence) => occurrence.id),
      outcome: outcomeFor(task, "deleted", { removedCount: occurrences.length }),
    };
  }
  if (scope === "future") {
    // The open occurrence goes (so nothing new is generated), the history
    // stays — apart from the task itself when that's what was named.
    const ids = [
      ...new Set([task.id, ...occurrences.filter((occurrence) => occurrence.status === "pending").map((occurrence) => occurrence.id)]),
    ];
    return { upserts: [], deletes: ids, outcome: outcomeFor(task, "deleted", { removedCount: ids.length }) };
  }
  return skipOccurrenceDelta(task, now, allTasks);
}

// ---------------------------------------------------------------------
// Whole operations
// ---------------------------------------------------------------------

/**
 * Plans an operation against the current list without changing anything.
 * Tasks are processed in turn against the list as the plan has changed it so
 * far, so two occurrences of one series in the same bulk request can't both
 * create the same next occurrence.
 */
export function planOperation(tasks: Task[], operation: TaskOperation, now: Date): OperationPlan {
  const { tasks: targets, missingIds } = resolveTarget(tasks, operation.target, operation.kind, now);
  const original = new Map(tasks.map((task) => [task.id, task]));
  const working = new Map(tasks.map((task) => [task.id, task]));
  const upserts = new Map<string, Task>();
  const deletes = new Set<string>();
  const outcomes: TaskOutcome[] = [];

  for (const target of targets) {
    const current = working.get(target.id);
    if (!current) continue; // already removed by an earlier series-wide delete in this plan
    const list = [...working.values()];
    let delta: TaskDelta;
    switch (operation.kind) {
      case "complete":
        delta = completeTaskDelta(current, now, list);
        break;
      case "reopen":
        delta = reopenTaskDelta(current, now, list);
        break;
      case "delete":
        delta = deleteTaskDelta(current, operation.scope, now, list);
        break;
      case "update": {
        // A rule change on a finished occurrence belongs to the series' open one.
        const recurrenceTarget =
          operation.changes.recurrence !== undefined && current.status === "completed" && current.recurrence
            ? openOccurrence(list, current.recurrence.seriesId) ?? current
            : current;
        delta = editTaskDelta(recurrenceTarget, operation.changes, operation.scope, now, list);
        break;
      }
    }
    for (const task of delta.upserts) {
      upserts.set(task.id, task);
      working.set(task.id, task);
      deletes.delete(task.id);
    }
    for (const id of delta.deletes) {
      deletes.add(id);
      upserts.delete(id);
      working.delete(id);
    }
    outcomes.push(delta.outcome);
  }

  const touched = new Set([...upserts.keys(), ...deletes]);
  return {
    upserts: [...upserts.values()],
    deletes: [...deletes].filter((id) => original.has(id)),
    before: [...touched].map((taskId) => ({ taskId, before: original.get(taskId) ?? null })),
    outcomes,
    missingIds,
  };
}

/**
 * Whether an edit or delete of one repeating task needs to be asked about:
 * just this occurrence, or the series? Completing and reopening never do (they
 * are always this occurrence), starting or stopping the repeat never does (it
 * is always the series), and neither does a request about several tasks at
 * once — see bulkRecurrenceScope.
 */
export function needsRecurrenceScope(operation: TaskOperation, targets: Task[]): boolean {
  if (operation.kind === "complete" || operation.kind === "reopen" || operation.scope) return false;
  if (targets.length !== 1 || !targets.some((task) => task.recurrence && task.status === "pending")) return false;
  if (operation.kind === "delete") return true;
  // Starting/stopping repeating is inherently about the series; anything
  // else that actually changes something needs the question.
  const { recurrence: _ruleChange, ...fieldChanges } = effectiveChanges(targets[0], operation.changes);
  return Object.values(fieldChanges).some((value) => value !== undefined);
}

/**
 * The changes that would actually alter `task`. The model has to fill in
 * title, duration and priority on every edit (the schema makes them required
 * so it doesn't skip them when they matter), and often repeats the task's
 * current values — which aren't changes and mustn't trigger questions.
 */
export function effectiveChanges(task: Task, changes: TaskChanges): TaskChanges {
  const result: TaskChanges = { ...changes };
  if (result.title !== undefined && result.title.trim() === task.title) delete result.title;
  if (result.estimatedMinutes !== undefined && Math.round(result.estimatedMinutes) === task.estimatedMinutes) {
    delete result.estimatedMinutes;
  }
  if (result.priority !== undefined && result.priority === priorityLevelOf(task.importance)) delete result.priority;
  if (result.notes !== undefined && (result.notes?.trim() || undefined) === task.notes) delete result.notes;
  if (result.dueDate !== undefined && result.dueDate === task.dueDate) {
    delete result.dueDate;
    delete result.keepTimeOfDay;
  }
  return result;
}

/**
 * How a request about several tasks at once treats the repeating ones among
 * them, when it didn't say: "postpone everything" moves each one's current
 * occurrence (the series carries on from its next slot), and "delete
 * everything for the Smith project" ends the series rather than skipping to a
 * next occurrence nobody asked for. Asking about every repeating task in a
 * bulk request would stall it on any daily habit, so the confirmation says
 * which of these applies instead (describeConfirmation).
 */
export function bulkRecurrenceScope(operation: TaskOperation, targets: Task[]): RecurrenceScope | undefined {
  if (operation.kind === "complete" || operation.kind === "reopen") return undefined;
  if (operation.scope || targets.length < 2) return operation.scope;
  if (!targets.some((task) => task.recurrence && task.status === "pending")) return undefined;
  return operation.kind === "delete" ? "future" : "this";
}
