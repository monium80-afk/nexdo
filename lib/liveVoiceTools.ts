import type { InboxAction, InboxActionType, InboxFilter, InboxRecurrence } from "@/app/api/inbox+api";
import { toStructuredAction, toTaskFilter } from "@/lib/ai/classifyIntent";
import { guessDuration } from "@/lib/ai/extractTasks";
import type { ExtractedTaskDraft, StructuredAction } from "@/lib/ai/types";
import type { RecurrenceScope, RuleInput } from "@/lib/recurrence";
import { matchesFilter } from "@/lib/taskOperations";
import { useTaskStore } from "@/store/useTaskStore";
import type { RecurrenceKind, RecurrenceRule, StepDraft, Task } from "@/types/task";

// Live voice's hands: Gemini Live calls the tools declared in
// app/api/live-session+api.ts, and each call is carried out here, on the
// phone, the moment it arrives. The arguments are /api/inbox's action fields,
// so a call goes through the same resolution as a typed message (dates read
// in the user's time zone, repeating tasks, "no such task") via
// toStructuredAction — only the confirmations are gone: live voice acts at
// once, and everything it does can be undone.

export type LiveToolCall = { id: string; name: string; args: Record<string, unknown> };

/** What the model hears back: whether it worked, and the id to use for "that" next time. */
export type LiveToolResult = { ok: boolean; taskId?: string; note?: string; error?: string; count?: number };

type Snapshot = { taskId: string; before: Task | null };

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const FREQUENCIES = ["daily", "weekly", "monthly", "yearly", "none"] as const;
const PRIORITIES = ["critical", "high", "medium", "low"];
const SHIFT_UNITS = ["minutes", "hours", "days", "weeks", "months"] as const;
const SCOPES = ["this", "future", "series"] as const;
const KINDS = ["routine", "task"] as const;
const BULK_TYPES = { complete: "COMPLETE_TASKS", reopen: "REOPEN_TASKS", delete: "DELETE_TASKS", update: "UPDATE_TASKS" } as const;
const FILTER_STATUSES = ["pending", "completed", "overdue", "all"] as const;
const FILTER_PRIORITIES = ["high", "medium", "low"] as const;

// Gemini Live sometimes repeats a call it has just made (seen in testing:
// the same add_task twice, a quarter of a second apart). The same call again
// this soon is that echo, not a second instruction — unless something has
// changed that task since (it was reopened, deleted, or the change undone):
// then asking again is new, and is carried out.
const ECHO_WINDOW_MS = 10_000;

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/** "Call Mom!" and "call mom" are the same task. */
function titleKey(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function recurrenceOf(value: unknown): InboxRecurrence | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const frequency = oneOf(raw.frequency, FREQUENCIES);
  if (!frequency) return undefined;
  const weekdays = Array.isArray(raw.weekdays)
    ? raw.weekdays.map((day) => (typeof day === "string" ? WEEKDAYS.indexOf(day.toLowerCase().slice(0, 3)) : -1)).filter((day) => day >= 0)
    : [];
  return {
    frequency,
    interval: number(raw.interval),
    weekdays: weekdays.length > 0 ? weekdays : undefined,
    monthDay: number(raw.monthDay),
    endDatePhrase: text(raw.endDatePhrase),
  };
}

function dueShiftOf(value: unknown): InboxAction["fields"]["dueDateShift"] {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const amount = number(raw.amount);
  const unit = oneOf(raw.unit, SHIFT_UNITS);
  return amount && unit ? { amount, unit } : undefined;
}

function filterOf(value: unknown): InboxFilter | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const keywords = Array.isArray(raw.titleKeywords) ? raw.titleKeywords.map(text).filter((word): word is string => !!word) : [];
  const filter: InboxFilter = {
    status: oneOf(raw.status, FILTER_STATUSES),
    titleKeywords: keywords.length > 0 ? keywords : undefined,
    dueWithin: text(raw.dueWithin),
    completedWithin: text(raw.completedWithin),
    recurring: typeof raw.recurring === "boolean" ? raw.recurring : undefined,
    hasDeadline: typeof raw.hasDeadline === "boolean" ? raw.hasDeadline : undefined,
    priority: oneOf(raw.priority, FILTER_PRIORITIES),
  };
  return Object.values(filter).some((entry) => entry !== undefined) ? filter : null;
}

function inboxAction(
  type: InboxActionType,
  taskId: string | null,
  fields: InboxAction["fields"],
  bulk: { taskIds?: string[]; filter?: InboxFilter | null } = {},
): InboxAction {
  return { type, taskId, taskIds: bulk.taskIds ?? null, filter: bulk.filter ?? null, fields, confirmationRequired: false };
}

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * An add_task call as the task it would create, without touching the list —
 * onboarding's brain dump (app/onboarding/dump.tsx) keeps these as drafts
 * until an account exists. Null when the call has no title. Same resolution
 * as a real add (dates in the user's time zone, repeats, a guessed length).
 */
export function draftFromAddTask(args: Record<string, unknown>, now: Date = new Date()): ExtractedTaskDraft | null {
  const title = text(args.title);
  if (!title) return null;
  const recurrence = recurrenceOf(args.repeat);
  const estimatedMinutes = number(args.estimatedMinutes);
  const action = inboxAction("CREATE_TASK", null, {
    dueDatePhrase: text(args.dueDatePhrase),
    estimatedMinutes: estimatedMinutes ?? guessDuration(title),
    priority: oneOf(args.priority, PRIORITIES),
    recurrence,
    title,
  });
  const structured = toStructuredAction(action, { now, realId: () => null });
  if (!structured || structured.type !== "CREATE_TASK") return null;
  const draft = structured.drafts[0];
  const kind = recurrence && args.repeat && typeof args.repeat === "object" ? oneOf((args.repeat as Record<string, unknown>).kind, KINDS) : undefined;
  if (draft?.recurrence && kind) draft.recurrence = { ...draft.recurrence, kind };
  return draft ?? null;
}

/** Whether two titles name the same thing, ignoring case, accents and punctuation. */
export function sameTitle(a: string, b: string): boolean {
  return titleKey(a) === titleKey(b);
}

/** The most cards one show_task puts up ("all my tasks" on a long list). */
const MAX_SHOWN = 50;

/** A series' rule as the repeat picker would hand it back — to change just its kind. */
function ruleInputOf(rule: RecurrenceRule, kind: RecurrenceKind): RuleInput {
  return {
    frequency: rule.frequency,
    interval: rule.interval,
    weekdays: rule.weekdays,
    monthDay: rule.monthDay,
    endDate: rule.endDate,
    missed: rule.missed,
    time: rule.allDay ? null : `${pad(rule.hour)}:${pad(rule.minute)}`,
    kind,
  };
}

/**
 * Runs a change made straight on the store (steps) and returns what undo
 * needs: every task it added, changed or removed, as it was before. A task
 * counts as changed when its updatedAt, status or steps moved — scores are
 * recomputed for every task on each change, so the object itself always
 * differs, and two changes can land in the same millisecond.
 */
function capture(run: () => void): Snapshot[] {
  const before = new Map(useTaskStore.getState().tasks.map((task) => [task.id, task]));
  run();
  const after = useTaskStore.getState().tasks;
  const changed: Snapshot[] = [];
  for (const task of after) {
    const old = before.get(task.id);
    if (!old) changed.push({ taskId: task.id, before: null });
    else if (old.updatedAt !== task.updatedAt || old.status !== task.status || old.subtasks !== task.subtasks) {
      changed.push({ taskId: task.id, before: old });
    }
    before.delete(task.id);
  }
  for (const [taskId, old] of before) changed.push({ taskId, before: old });
  return changed;
}

/** The task's steps, in order, as AI Breakdown's sheet edits them. */
function stepDrafts(task: Task): StepDraft[] {
  return (task.subtasks ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((step) => ({ id: step.id, label: step.label, estimatedMinutes: step.estimatedMinutes, completed: step.status === "completed" }));
}

function newStepId(index: number): string {
  return `subtask-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 6)}`;
}

/** The same call with its arguments in another order is still the same call. */
function callKey(call: LiveToolCall): string {
  const args = Object.keys(call.args)
    .sort()
    .map((key) => [key, call.args[key]]);
  return `${call.name}:${JSON.stringify(args)}`;
}

/**
 * One session's tool runner. `aliases` maps the ids the model was given
 * ("t1", "t2", …) to real task ids; tasks it adds get the next numbers.
 */
export function createLiveToolRunner(aliases: Map<string, string>) {
  const toReal = new Map(aliases);
  const toAlias = new Map([...aliases].map(([alias, id]) => [id, alias]));
  let nextNumber = aliases.size + 1;
  const undoStack: Snapshot[][] = [];
  // Every task a change from this session added, changed or removed — kept
  // after an undo too (the overlay compares those against how they started).
  const touched = new Set<string>();
  // Tasks the user only named (show_task): id → when, latest naming wins.
  const shown = new Map<string, number>();
  const remember = (snapshots: Snapshot[]) => {
    for (const snapshot of snapshots) touched.add(snapshot.taskId);
    undoStack.push(snapshots);
  };
  // Recent calls, with the task each was about (the model's id for it).
  let recent: { key: string; at: number; taskId?: string; result: LiveToolResult }[] = [];

  const aliasFor = (taskId: string): string => {
    let alias = toAlias.get(taskId);
    if (!alias) {
      alias = `t${nextNumber++}`;
      toAlias.set(taskId, alias);
      toReal.set(alias, taskId);
    }
    return alias;
  };

  const realId = (alias: string | null) => (alias ? (toReal.get(alias) ?? null) : null);

  const undo = (): boolean => {
    const entry = undoStack.pop();
    if (!entry) return false;
    useTaskStore.getState().restoreSnapshots(entry);
    // Whatever was undone can be asked for again, and be done again.
    recent = [];
    return true;
  };

  /** The task the model means by its id, if it's still there. */
  const taskFor = (alias: string | null): Task | undefined => {
    const id = realId(alias);
    return id ? useTaskStore.getState().tasks.find((task) => task.id === id) : undefined;
  };

  /**
   * Carries out one action. `adjust` adds what /api/inbox's shape can't say
   * (no deadline any more, routine or repeating task) to the operation it
   * resolved to, before anything changes.
   */
  const perform = (action: InboxAction, adjust?: (structured: StructuredAction) => void): LiveToolResult => {
    const structured = toStructuredAction(action, { now: new Date(), realId });
    if (!structured || structured.type === "UNKNOWN") {
      return { ok: false, error: "No task with that id — nothing changed." };
    }
    if (structured.type === "CLARIFY") {
      return { ok: false, error: "Couldn't tell which tasks or which date that means — nothing changed." };
    }
    adjust?.(structured);
    const store = useTaskStore.getState();
    // Adding a note is the one change that doesn't report its own undo.
    const noteTarget = structured.type === "ADD_TASK_CONTEXT" ? store.tasks.find((task) => task.id === structured.taskId) : undefined;
    const result = store.applyStructuredAction(structured);
    const touched = result.taskIds?.length ?? 0;
    if (structured.type === "OPERATE" && touched === 0) {
      // Already done, already open, nothing to change: say why, keep no undo.
      return { ok: false, taskId: action.taskId ?? undefined, error: result.message };
    }
    const undo = result.undo ?? (noteTarget ? [{ taskId: noteTarget.id, before: noteTarget }] : []);
    if (undo.length > 0) remember(undo);
    if (action.type.endsWith("_TASKS")) return { ok: true, count: touched };
    return { ok: true, taskId: result.taskId ? aliasFor(result.taskId) : (action.taskId ?? undefined) };
  };

  /** A change made straight on the store, kept for undo like the others. */
  const performDirect = (alias: string, run: () => void): LiveToolResult => {
    const undo = capture(run);
    if (undo.length === 0) return { ok: false, taskId: alias, error: "Nothing changed." };
    remember(undo);
    return { ok: true, taskId: alias };
  };

  const dispatch = (call: LiveToolCall): LiveToolResult => {
    const { args } = call;
    const taskId = text(args.taskId) ?? null;
    const recurrence = recurrenceOf(args.repeat);
    const details = {
      dueDatePhrase: text(args.dueDatePhrase),
      estimatedMinutes: number(args.estimatedMinutes),
      priority: oneOf(args.priority, PRIORITIES),
      recurrence,
    };
    // "Every day — it's a routine": the kind rides along with a new rule.
    const repeatKind = recurrence && args.repeat && typeof args.repeat === "object"
      ? oneOf((args.repeat as Record<string, unknown>).kind, KINDS)
      : undefined;
    const withKind = (structured: StructuredAction) => {
      if (!repeatKind) return;
      if (structured.type === "CREATE_TASK") {
        for (const draft of structured.drafts) if (draft.recurrence) draft.recurrence = { ...draft.recurrence, kind: repeatKind };
      } else if (structured.type === "OPERATE" && structured.operation.kind === "update" && structured.operation.changes.recurrence) {
        structured.operation.changes.recurrence = { ...structured.operation.changes.recurrence, kind: repeatKind };
      }
    };

    switch (call.name) {
      case "add_task": {
        const title = text(args.title);
        if (!title) return { ok: false, error: "A task needs a title." };
        // Never a second copy of something already on the list — whether the
        // model misheard, repeated itself, or the user said it twice. What was
        // said about it still counts, though: a deadline, length, priority or
        // repeat goes onto the task already there ("update it instead", as the
        // live prompt puts it), rather than being dropped.
        const existing = useTaskStore.getState().tasks.find((task) => task.status === "pending" && titleKey(task.title) === titleKey(title));
        if (existing) {
          const alias = aliasFor(existing.id);
          if (Object.values(details).every((value) => value === undefined)) {
            return { ok: true, taskId: alias, note: "Already on the list — nothing added." };
          }
          // Not ok when it changed nothing (it already looked like that) or
          // couldn't be applied: the model hears why, and nothing is counted.
          const updated = perform(inboxAction("UPDATE_TASK", alias, details), withKind);
          return updated.ok
            ? { ...updated, note: "Already on the list — updated it instead of adding a copy." }
            : { ...updated, taskId: alias };
        }
        return perform(
          inboxAction("CREATE_TASK", null, { ...details, title, estimatedMinutes: details.estimatedMinutes ?? guessDuration(title) }),
          withKind,
        );
      }
      case "update_task": {
        const task = taskFor(taskId);
        const removeDeadline = args.removeDeadline === true;
        // Routine ↔ repeating task, keeping how often it repeats.
        const kindOnly = !recurrence ? oneOf(args.repeatType, KINDS) : undefined;
        return perform(
          inboxAction("UPDATE_TASK", taskId, {
            ...details,
            dueDatePhrase: removeDeadline ? undefined : details.dueDatePhrase,
            title: text(args.title),
            dueDateShift: removeDeadline ? undefined : dueShiftOf(args.dueDateShift),
            estimatedMinutesDelta: number(args.estimatedMinutesDelta),
            recurrenceScope: oneOf(args.scope, SCOPES),
          }),
          (structured) => {
            withKind(structured);
            if (structured.type !== "OPERATE" || structured.operation.kind !== "update") return;
            const changes = structured.operation.changes;
            if (removeDeadline) {
              changes.deadline = null;
              delete changes.keepTimeOfDay;
            }
            if (kindOnly && task?.recurrence) changes.recurrence = ruleInputOf(task.recurrence.rule, kindOnly);
          },
        );
      }
      case "complete_task":
        return perform(inboxAction("COMPLETE_TASK", taskId, {}));
      case "reopen_task":
        return perform(inboxAction("REOPEN_TASK", taskId, {}));
      case "delete_task": {
        // "Delete the gym" means the gym, every repeat of it — skipping just
        // today's is skip_occurrence. Before 2026-10-31 a delete without a
        // scope only skipped this occurrence, so the task came straight back
        // for the next day and looked as if it had been ticked off. A finished
        // occurrence named on its own is just that one, though.
        const task = taskFor(taskId);
        const scope = oneOf(args.scope, SCOPES) ?? (task?.status === "completed" ? undefined : "series");
        return perform(inboxAction("DELETE_TASK", taskId, { recurrenceScope: scope }));
      }
      case "skip_occurrence": {
        const task = taskFor(taskId);
        if (task && !task.recurrence) {
          return { ok: false, taskId: taskId ?? undefined, error: "That task doesn't repeat — nothing to skip. To move it, use update_task." };
        }
        return perform(inboxAction("DELETE_TASK", taskId, { recurrenceScope: "this" }));
      }
      case "change_tasks": {
        const kind = oneOf(args.action, Object.keys(BULK_TYPES) as (keyof typeof BULK_TYPES)[]);
        if (!kind) return { ok: false, error: "action must be complete, reopen, delete or update." };
        const taskIds = Array.isArray(args.taskIds) ? args.taskIds.map(text).filter((id): id is string => !!id) : [];
        const filter = filterOf(args.filter);
        if (taskIds.length === 0 && !filter) return { ok: false, error: "Say which tasks: taskIds or a filter." };
        // Deleting finished tasks clears just those; deleting open ones that
        // repeat stops them repeating but keeps what was already done.
        const deleteScope: RecurrenceScope | undefined = filter?.status === "completed" || filter?.completedWithin ? undefined : "future";
        return perform(
          inboxAction(
            BULK_TYPES[kind],
            null,
            kind === "update"
              ? {
                  dueDatePhrase: text(args.dueDatePhrase),
                  dueDateShift: dueShiftOf(args.dueDateShift),
                  priority: oneOf(args.priority, PRIORITIES),
                  estimatedMinutesDelta: number(args.estimatedMinutesDelta),
                }
              : kind === "delete"
                ? { recurrenceScope: deleteScope }
                : {},
            { taskIds, filter },
          ),
        );
      }
      case "set_steps": {
        const task = taskFor(taskId);
        if (!task || !taskId) return { ok: false, error: "No task with that id — nothing changed." };
        if (task.status !== "pending") return { ok: false, taskId, error: "That task is already done — reopen it first." };
        const said = Array.isArray(args.steps) ? args.steps : [];
        const steps: StepDraft[] = said
          .map((entry, index) => {
            const raw = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
            const label = text(raw.title);
            return label
              ? { id: newStepId(index), label, estimatedMinutes: Math.max(1, Math.round(number(raw.estimatedMinutes) ?? 10)), completed: false }
              : null;
          })
          .filter((step): step is StepDraft => !!step);
        if (steps.length === 0) return { ok: false, taskId, error: "No steps were given." };
        const kept = args.mode === "add" ? stepDrafts(task) : [];
        return performDirect(taskId, () => useTaskStore.getState().setSteps(task.id, [...kept, ...steps]));
      }
      case "check_step": {
        const task = taskFor(taskId);
        if (!task || !taskId) return { ok: false, error: "No task with that id — nothing changed." };
        if (task.status !== "pending") return { ok: false, taskId, error: "That task is already done." };
        const steps = stepDrafts(task);
        const index = Math.round(number(args.step) ?? 0) - 1;
        if (index < 0 || index >= steps.length) return { ok: false, taskId, error: `It has ${steps.length} steps — no step ${index + 1}.` };
        const done = args.done !== false;
        if (steps[index].completed === done) return { ok: false, taskId, error: done ? "That step is already done." : "That step is already open." };
        steps[index] = { ...steps[index], completed: done };
        return performDirect(taskId, () => useTaskStore.getState().setSteps(task.id, steps));
      }
      case "add_note": {
        const note = text(args.note);
        if (!note) return { ok: false, error: "The note was empty." };
        return perform(inboxAction("ADD_CONTEXT", taskId, { note }));
      }
      case "show_task": {
        // Changes nothing: the overlay puts these tasks' cards up, so a task
        // can be seen before it's changed (the list is behind the blur).
        const said = Array.isArray(args.taskIds) ? args.taskIds.map(text) : [taskId];
        const ids = said
          .filter((alias): alias is string => !!taskFor(alias ?? null))
          .map((alias) => realId(alias)!);
        // A group ("all my tasks", "what's due today"): the open tasks that
        // match, unless the filter says which status.
        const filter = filterOf(args.filter);
        if (filter) {
          const now = new Date();
          const taskFilter = toTaskFilter(filter, { now });
          if (!taskFilter) return { ok: false, error: "Couldn't tell which dates that means — nothing shown." };
          const matching = { ...taskFilter, status: taskFilter.status ?? "pending" };
          for (const task of useTaskStore.getState().tasks) {
            if (matchesFilter(task, matching, now) && !ids.includes(task.id)) ids.push(task.id);
          }
        }
        if (ids.length === 0) {
          return { ok: false, error: filter ? "No task matches that — nothing shown." : "No task with that id — nothing shown." };
        }
        const at = Date.now();
        for (const id of ids.slice(0, MAX_SHOWN)) {
          shown.delete(id);
          shown.set(id, at);
        }
        return { ok: true, count: Math.min(ids.length, MAX_SHOWN) };
      }
      case "undo_last_change":
        return undo() ? { ok: true } : { ok: false, error: "Nothing to undo." };
      default:
        return { ok: false, error: `There's no tool called ${call.name}.` };
    }
  };

  return {
    run: (call: LiveToolCall): LiveToolResult => {
      const now = Date.now();
      const key = callKey(call);
      recent = recent.filter((entry) => now - entry.at <= ECHO_WINDOW_MS);
      // "Undo, undo" really is twice.
      if (call.name === "undo_last_change") return dispatch(call);
      const echo = recent.find((entry) => entry.key === key);
      if (echo) return echo.result;
      const result = dispatch(call);
      const taskId = text(call.args.taskId) ?? result.taskId;
      // A change to a task makes the earlier calls about it history: the
      // same call again is a new instruction now, not their echo.
      if (result.ok && taskId) recent = recent.filter((entry) => entry.taskId !== taskId);
      recent.push({ key, at: now, taskId, result });
      return result;
    },
    /** The Undo button: reverses the latest change, as "undo" said out loud does. */
    undo,
    undoCount: () => undoStack.length,
    /** The ids of the tasks this session's changes have touched. */
    touchedIds: (): string[] => [...touched],
    /** The tasks the user only named (show_task), with when, oldest first. */
    shownTasks: (): { taskId: string; at: number }[] => [...shown].map(([taskId, at]) => ({ taskId, at })),
  };
}
