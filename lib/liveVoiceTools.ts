import type { InboxAction, InboxActionType, InboxRecurrence } from "@/app/api/inbox+api";
import { toStructuredAction } from "@/lib/ai/classifyIntent";
import { guessDuration } from "@/lib/ai/extractTasks";
import { useTaskStore } from "@/store/useTaskStore";
import type { Task } from "@/types/task";

// Live voice's hands: Gemini Live calls the tools declared in
// app/api/live-session+api.ts, and each call is carried out here, on the
// phone, the moment it arrives. The arguments are /api/inbox's action fields,
// so a call goes through the same resolution as a typed message (dates read
// in the user's time zone, repeating tasks, "no such task") via
// toStructuredAction — only the confirmations are gone: live voice acts at
// once, and everything it does can be undone.

export type LiveToolCall = { id: string; name: string; args: Record<string, unknown> };

/** What the model hears back: whether it worked, and the id to use for "that" next time. */
export type LiveToolResult = { ok: boolean; taskId?: string; note?: string; error?: string };

type Snapshot = { taskId: string; before: Task | null };

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const FREQUENCIES = ["daily", "weekly", "monthly", "yearly", "none"] as const;
const PRIORITIES = ["critical", "high", "medium", "low"];
const SHIFT_UNITS = ["minutes", "hours", "days", "weeks", "months"] as const;
const SCOPES = ["this", "future", "series"] as const;

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

function inboxAction(type: InboxActionType, taskId: string | null, fields: InboxAction["fields"]): InboxAction {
  return { type, taskId, taskIds: null, filter: null, fields, confirmationRequired: false };
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

  const perform = (action: InboxAction): LiveToolResult => {
    const structured = toStructuredAction(action, { now: new Date(), realId });
    if (!structured || structured.type === "UNKNOWN" || structured.type === "CLARIFY") {
      return { ok: false, error: "No task with that id — nothing changed." };
    }
    const store = useTaskStore.getState();
    // Adding a note is the one change that doesn't report its own undo.
    const noteTarget = structured.type === "ADD_TASK_CONTEXT" ? store.tasks.find((task) => task.id === structured.taskId) : undefined;
    const result = store.applyStructuredAction(structured);
    if (structured.type === "OPERATE" && (result.taskIds?.length ?? 0) === 0) {
      // Already done, already open, nothing to change: say why, keep no undo.
      return { ok: false, taskId: action.taskId ?? undefined, error: result.message };
    }
    const undo = result.undo ?? (noteTarget ? [{ taskId: noteTarget.id, before: noteTarget }] : []);
    if (undo.length > 0) undoStack.push(undo);
    return { ok: true, taskId: result.taskId ? aliasFor(result.taskId) : (action.taskId ?? undefined) };
  };

  const dispatch = (call: LiveToolCall): LiveToolResult => {
    const { args } = call;
    const taskId = text(args.taskId) ?? null;
    const details = {
      dueDatePhrase: text(args.dueDatePhrase),
      estimatedMinutes: number(args.estimatedMinutes),
      priority: oneOf(args.priority, PRIORITIES),
      recurrence: recurrenceOf(args.repeat),
    };

    switch (call.name) {
      case "add_task": {
        const title = text(args.title);
        if (!title) return { ok: false, error: "A task needs a title." };
        // Never a second copy of something already on the list — whether the
        // model misheard, repeated itself, or the user said it twice.
        const existing = useTaskStore.getState().tasks.find((task) => task.status === "pending" && titleKey(task.title) === titleKey(title));
        if (existing) return { ok: true, taskId: aliasFor(existing.id), note: "Already on the list — nothing added." };
        return perform(
          inboxAction("CREATE_TASK", null, { ...details, title, estimatedMinutes: details.estimatedMinutes ?? guessDuration(title) }),
        );
      }
      case "update_task":
        return perform(
          inboxAction("UPDATE_TASK", taskId, {
            ...details,
            title: text(args.title),
            dueDateShift: dueShiftOf(args.dueDateShift),
            recurrenceScope: oneOf(args.scope, SCOPES),
          }),
        );
      case "complete_task":
        return perform(inboxAction("COMPLETE_TASK", taskId, {}));
      case "reopen_task":
        return perform(inboxAction("REOPEN_TASK", taskId, {}));
      case "delete_task":
        return perform(inboxAction("DELETE_TASK", taskId, { recurrenceScope: oneOf(args.scope, SCOPES) }));
      case "add_note": {
        const note = text(args.note);
        if (!note) return { ok: false, error: "The note was empty." };
        return perform(inboxAction("ADD_CONTEXT", taskId, { note }));
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
  };
}
