import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { analyzeTaskComplexity } from "@/lib/ai/analyzeComplexity";
import { generatePlan, isUntouchedTemplatePlan } from "@/lib/ai/generatePlan";
import type { PlanStep, StructuredAction } from "@/lib/ai/types";
import { deadlineFromDate, makeDeadline, reconcileDeadline, withDeadline, type DeadlineInput } from "@/lib/deadline";
import { translate } from "@/lib/i18n";
import { clearAllNotifications } from "@/lib/notifications";
import { describeOperationResult, describeTaskList } from "@/lib/operationMessages";
import { buildRule, startSeries, type RecurrenceScope, type RuleInput } from "@/lib/recurrence";
import { PRIORITY_LEVEL_IMPORTANCE, createSkipRecord, recalcTask } from "@/lib/scoring";
import { deleteTaskRows, fetchTasks, subscribeToTasks, upsertTaskRows } from "@/lib/supabaseSync";
import {
  completeTaskDelta,
  matchesFilter,
  planOperation,
  skipMissedDelta,
  type OperationPlan,
  type TaskChanges,
  type TaskOperation,
} from "@/lib/taskOperations";
import { recalcAll } from "@/lib/taskPipeline";
import type { Subtask, Task, TaskDeadline, TaskPriorityLevel, TaskStep } from "@/types/task";

// Local-first background sync: mutations below stay synchronous against
// local state (UI/lib/ai never awaits anything), and additionally mirror
// the change to Supabase fire-and-forget. Failures are logged, not surfaced
// to the user — but every save is tracked in `unsynced` (and every delete in
// `pendingDeletes`) until Supabase confirms it, so a failed one is retried
// rather than forgotten.
let realtimeChannel: RealtimeChannel | null = null;

function withoutKeys(record: Record<string, string>, keys: string[]): Record<string, string> {
  const copy = { ...record };
  keys.forEach((key) => delete copy[key]);
  return copy;
}

// Returns a promise that never rejects, so callers can fire and forget it or
// (signing out) wait for it. Several tasks go up in one request — one
// statement on the database, so a bulk change lands whole or not at all.
// The save in flight for each task, so a caller about to tell the user "it's
// saved" (confirmSaved) can wait for the database's answer instead of
// assuming it. Resolves to whether that save went through.
const pendingSaves = new Map<string, Promise<boolean>>();

// The last request sent for each task. A save or delete of a task waits for
// the one before it, so Supabase applies them in the order they were made —
// otherwise an edit landing after the task's delete would bring its row back,
// or a delete landing after an undo's save would remove it again.
const lastRequest = new Map<string, Promise<void>>();

function inOrder<T>(taskIds: string[], send: () => Promise<T>): Promise<T> {
  const earlier = taskIds.map((id) => lastRequest.get(id)).filter((request): request is Promise<void> => !!request);
  const request = Promise.all(earlier).then(send);
  const settled = request.then(
    () => undefined,
    () => undefined,
  );
  taskIds.forEach((id) => lastRequest.set(id, settled));
  void settled.then(() =>
    taskIds.forEach((id) => {
      if (lastRequest.get(id) === settled) lastRequest.delete(id);
    }),
  );
  return request;
}

function syncUpsertMany(tasks: Task[], userId: string | null): Promise<void> {
  if (tasks.length === 0) return Promise.resolve();
  const ids = tasks.map((task) => task.id);
  useTaskStore.setState((state) => ({
    unsynced: { ...state.unsynced, ...Object.fromEntries(tasks.map((task) => [task.id, task.updatedAt])) },
    // Back again (an undo, a card added twice): no longer to be deleted.
    pendingDeletes: withoutKeys(state.pendingDeletes, ids),
  }));
  if (!userId) return Promise.resolve();
  const request = inOrder(ids, () => upsertTaskRows(tasks, userId))
    .then(() => {
      // Only if this is still the newest version — an edit made while the
      // request was in flight has its own save to wait for.
      useTaskStore.setState((state) => {
        const saved = tasks.filter((task) => state.unsynced[task.id] === task.updatedAt).map((task) => task.id);
        return saved.length > 0 ? { unsynced: withoutKeys(state.unsynced, saved) } : {};
      });
      return true;
    })
    .catch((error) => {
      console.warn("[useTaskStore] upsert failed", error);
      return false;
    });
  tasks.forEach((task) => pendingSaves.set(task.id, request));
  void request.then(() => {
    tasks.forEach((task) => {
      if (pendingSaves.get(task.id) === request) pendingSaves.delete(task.id);
    });
  });
  return request.then(() => undefined);
}

function syncUpsert(task: Task, userId: string | null): Promise<void> {
  return syncUpsertMany([task], userId);
}

// A delete is remembered in `pendingDeletes` until Supabase confirms it, so
// one made offline (or a request that failed) is sent again rather than the
// row coming back with the next sync. Only a task that belongs to an account
// can have a row; one made signed out never left the phone.
function syncDeleteMany(taskIds: string[], userId: string | null): Promise<void> {
  if (taskIds.length === 0) return Promise.resolve();
  const owned = !!(userId ?? useTaskStore.getState().ownerId);
  const deletedAt = new Date().toISOString();
  useTaskStore.setState((state) => ({
    unsynced: withoutKeys(state.unsynced, taskIds),
    pendingDeletes: owned
      ? { ...state.pendingDeletes, ...Object.fromEntries(taskIds.map((id) => [id, deletedAt])) }
      : state.pendingDeletes,
  }));
  if (!userId) return Promise.resolve();
  return inOrder(taskIds, () => deleteTaskRows(taskIds, userId))
    .then(() => {
      // Only if the task wasn't brought back and deleted again meanwhile —
      // that delete has its own confirmation to wait for.
      useTaskStore.setState((state) => {
        const done = taskIds.filter((id) => state.pendingDeletes[id] === deletedAt);
        return done.length > 0 ? { pendingDeletes: withoutKeys(state.pendingDeletes, done) } : {};
      });
    })
    .catch((error) => console.warn("[useTaskStore] delete failed", error));
}

function syncDelete(taskId: string, userId: string | null) {
  return syncDeleteMany([taskId], userId);
}

// Signing out clears this phone's copy of the list — the account's tasks live
// in Supabase and come back on the next sign-in. The exception is a change
// Supabase never confirmed (offline, the app closed mid-save, a row the
// database rejected): the phone holds the only copy, so it is set aside here
// under the account it belongs to and sent the next time that account signs
// in on this phone — a task's newest version, or its delete. Never shown to,
// or mixed into, another account.
const stashKey = (userId: string) => `nexdo-unsynced-tasks:${userId}`;
const deletesStashKey = (userId: string) => `nexdo-unsynced-deletes:${userId}`;

async function stashUnsynced(userId: string, tasks: Task[], unsynced: Record<string, string>, deletedIds: string[]) {
  const pending = tasks.filter((task) => task.id in unsynced);
  if (pending.length > 0) {
    const earlier = await readStash<Task>(stashKey(userId));
    const ids = new Set(pending.map((task) => task.id));
    await AsyncStorage.setItem(stashKey(userId), JSON.stringify([...pending, ...earlier.filter((task) => !ids.has(task.id))]));
  }
  if (deletedIds.length > 0) {
    const earlier = await readStash<string>(deletesStashKey(userId));
    await AsyncStorage.setItem(deletesStashKey(userId), JSON.stringify([...new Set([...deletedIds, ...earlier])]));
  }
}

async function readStash<T>(key: string): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch (error) {
    console.warn("[useTaskStore] couldn't read unsynced changes", error);
    return [];
  }
}

// Long enough for a slow connection; short enough that signing out offline
// doesn't leave the button spinning.
const SIGN_OUT_SAVE_TIMEOUT_MS = 8_000;

// The demo tasks every install used to start with ("Clean out garage",
// "Submit tax documents", ...). They were meant to drop away when an account
// signed in, but mergeRemoteTasks kept them as local tasks not yet synced, so
// every brand-new account opened with a dozen tasks it never wrote. The list
// now starts empty; these ids are only here to clear them out of installs
// and accounts that already have them (touching one had uploaded it).
const SAMPLE_TASK_IDS = new Set([
  "tax-documents",
  "car-insurance",
  "quarterly-report",
  "chemistry-test",
  "weekly-groceries",
  "email-professor",
  "client-proposal-slides",
  "clean-garage",
  "weekend-trip",
  "reading-chapters",
  "portfolio-website",
  "digital-photos",
  "morning-run",
  "expense-report",
  "reading-assignment",
  "water-plants",
]);

function isSampleTask(task: Task): boolean {
  return SAMPLE_TASK_IDS.has(task.id);
}

// The AsyncStorage snapshot and the Supabase fetch both land asynchronously
// on startup, and whichever finished last used to overwrite the other. The
// local snapshot holds the newest edits, so hydrateFromSupabase waits for it
// (resolved by onRehydrateStorage below, on success *and* on failure, so a
// storage error can't leave this pending forever).
let resolveRehydrated: () => void = () => {};
const rehydrated = new Promise<void>((resolve) => {
  resolveRehydrated = resolve;
});

export type NewTaskInput = {
  /**
   * An id to create the task under — given for a task made from an AI
   * preview card (derived from its candidate id), so adding the same card
   * twice lands on the same task instead of a duplicate.
   */
  id?: string;
  title: string;
  estimatedMinutes: number;
  /** The deadline: a day, plus a time only if the user gave one. Preferred over `dueDate`. */
  deadline?: DeadlineInput;
  /** A deadline as an ISO instant (an AI draft, onboarding) — exact unless `dueHasTime` is false. */
  dueDate?: string;
  /** With `dueDate`: false when no clock time was given, so only its day is kept. */
  dueHasTime?: boolean;
  priorityLevel: TaskPriorityLevel;
  notes?: string;
  steps?: TaskStep[];
  /** Makes the new task the first occurrence of a repeating series. */
  recurrence?: RuleInput;
};

function createTaskId(): string {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The task id an AI preview card creates — the same one however many times it's added. */
export function taskIdForCandidate(candidateId: string): string {
  return `task-${candidateId}`;
}

/** The deadline a new task starts with — never one the user didn't give. */
function initialDeadline(input: NewTaskInput): TaskDeadline | undefined {
  if (input.deadline) return makeDeadline(input.deadline);
  if (!input.dueDate) return undefined;
  const due = new Date(input.dueDate);
  return deadlineFromDate(due, input.dueHasTime ?? true);
}

/** How long a caller waits for the database before saying a new task isn't saved yet. */
const CONFIRM_SAVE_TIMEOUT_MS = 10_000;

function stepsToSubtasks(steps: TaskStep[]): Subtask[] {
  return steps.map((step, index) => ({
    id: step.id,
    label: step.label,
    estimatedMinutes: step.estimatedMinutes,
    order: index,
    status: index === 0 ? "current" : "pending",
  }));
}

/**
 * Exported so onboarding can build a task without saving one: it has drafts to
 * rank and explain before the user has an account to hang them on, and running
 * them through anything other than this would score and rank them differently
 * from how the app actually will.
 */
export function buildTask(input: NewTaskInput, now: Date): Task {
  const complexity = analyzeTaskComplexity({
    title: input.title,
    estimatedMinutes: input.estimatedMinutes,
    subtaskCount: input.steps?.length,
  }).complexity;

  // Only real steps: ones the user or the AI gave this task. A task without any
  // stays without, rather than getting a generic plan, so a session shows a
  // checklist only when there is something real to tick off. AI Breakdown is
  // there for everything else.
  const subtasks = input.steps && input.steps.length > 0 ? stepsToSubtasks(input.steps) : undefined;

  const nowIso = now.toISOString();
  const base: Task = {
    id: input.id ?? createTaskId(),
    title: input.title.trim(),
    status: "pending",
    estimatedMinutes: input.estimatedMinutes,
    createdAt: nowIso,
    updatedAt: nowIso,
    notes: input.notes?.trim() || undefined,
    subtasks,
    currentStepId: subtasks?.find((subtask) => subtask.status === "current")?.id,
    priorityScore: 0,
    suitabilityScore: 0,
    importance: PRIORITY_LEVEL_IMPORTANCE[input.priorityLevel],
    complexity,
    aiContext: { notes: [] },
  };
  const task = withDeadline(base, initialDeadline(input));
  // A repeating task's first occurrence sits on the rule's first day (a task
  // due Wednesday that repeats on Mondays is due next Monday).
  const rule = input.recurrence ? buildRule(input.recurrence, task.deadline, now) : null;
  return recalcTask(rule ? startSeries(task, rule) : task, now);
}

function remainingMinutes(subtasks: Subtask[]): number {
  return subtasks.filter((subtask) => subtask.status !== "completed").reduce((sum, s) => sum + s.estimatedMinutes, 0);
}

function normalizePersistedTasks(tasks: Task[]): Task[] {
  return tasks.map((task) => {
    // Tasks saved before buildTask stopped adding a generic plan still carry
    // one. If nobody has ticked or edited it, it was never the user's plan, so
    // it goes, and the task shows no steps until it gets real ones.
    const ownSubtasks = task.subtasks && !isUntouchedTemplatePlan(task.subtasks) ? task.subtasks : undefined;
    const orderedSubtasks = ownSubtasks?.slice().sort((a, b) => a.order - b.order);
    const currentIndex = orderedSubtasks?.findIndex(
      (subtask) => subtask.id === task.currentStepId && subtask.status !== "completed",
    ) ?? -1;
    const nextIndex = currentIndex >= 0
      ? currentIndex
      : (orderedSubtasks?.findIndex((subtask) => subtask.status !== "completed") ?? -1);
    const subtasks = orderedSubtasks?.map((subtask, index) => ({
        ...subtask,
        status:
          subtask.status === "completed"
            ? ("completed" as const)
            : index === nextIndex
              ? ("current" as const)
              : ("pending" as const),
      }));
    const currentStepId = subtasks?.find((subtask) => subtask.status === "current")?.id;

    const advice = task.aiContext?.advice;
    // `deadline` is the source of truth; a task saved before date-only
    // deadlines existed has only `dueDate`, and keeps it as an exact one.
    return reconcileDeadline({
      ...task,
      status: TASK_STATUSES.includes(task.status) ? task.status : "pending",
      aiContext: {
        notes: Array.isArray(task.aiContext?.notes) ? task.aiContext.notes : [],
        ...(typeof advice === "string" && advice ? { advice } : {}),
      },
      subtasks,
      currentStepId,
    });
  });
}

const TASK_STATUSES: Task["status"][] = ["pending", "completed", "skipped", "archived"];

/**
 * A row read back from a database that doesn't have the newer columns yet
 * (supabase/schema.sql not re-run) comes back without them. What the phone
 * already knows about the same version of the task is kept rather than lost:
 * the deadline's date-only-ness (its dueDate is unchanged, so nothing moved
 * it), and — for the very same version — its reminder, pin and archive details.
 */
function keepLocalOnlyFields(remote: Task, local: Task | undefined): Task {
  if (!local) return remote;
  let merged = remote;
  if (!remote.deadline && local.deadline && remote.dueDate && remote.dueDate === local.dueDate) {
    merged = { ...merged, deadline: local.deadline };
  }
  if (remote.updatedAt === local.updatedAt) {
    if (!remote.reminders && local.reminders) merged = { ...merged, reminders: local.reminders };
    if (!remote.pinnedAt && local.pinnedAt) merged = { ...merged, pinnedAt: local.pinnedAt };
    if (!remote.closedAt && local.closedAt) merged = { ...merged, closedAt: local.closedAt };
  }
  return merged;
}

/**
 * Per-task last-write-wins — the same rule the realtime handler uses. A local
 * edit whose background write never reached Supabase (offline, the app closed
 * mid-request, a row the database rejected) must not be undone by the stale
 * row it left behind. A task only this phone has is kept if it never reached
 * Supabase; one that did and is gone now was deleted on another device, and
 * stays deleted. `toPush` is every local version Supabase is behind on.
 */
function mergeRemoteTasks(
  remote: Task[],
  local: Task[],
  unsynced: Record<string, string>,
): { tasks: Task[]; toPush: Task[] } {
  const localById = new Map(local.map((task) => [task.id, task]));
  const remoteIds = new Set(remote.map((task) => task.id));
  const toPush: Task[] = [];

  const tasks = remote.map((remoteTask) => {
    const localTask = localById.get(remoteTask.id);
    if (localTask && Date.parse(localTask.updatedAt) > Date.parse(remoteTask.updatedAt)) {
      toPush.push(localTask);
      return localTask;
    }
    return keepLocalOnlyFields(remoteTask, localTask);
  });

  const neverSaved = local.filter((task) => !remoteIds.has(task.id) && task.id in unsynced);
  toPush.push(...neverSaved);
  return { tasks: [...neverSaved, ...tasks], toPush };
}

export type SaveTaskResult =
  | { ok: true; task: Task }
  | { ok: false; reason: "missing" | "save-failed" | "conflict" };

// How many times saveTaskNow rebuilds on a newer version before giving up —
// each retry only happens if the task changed during a request that takes a
// fraction of a second, so a third is already very unlikely.
const MAX_SAVE_ATTEMPTS = 3;

type TaskStore = {
  tasks: Task[];
  syncUserId: string | null;
  /** Tasks whose newest local version Supabase hasn't confirmed yet: id → that version's updatedAt. */
  unsynced: Record<string, string>;
  /** Tasks deleted on this phone whose rows Supabase hasn't confirmed deleted yet: id → when. */
  pendingDeletes: Record<string, string>;
  /** The account the local list belongs to — persisted, so it outlives an app restart. */
  ownerId: string | null;
  hydrateFromSupabase: (userId: string) => Promise<void>;
  subscribeToRealtime: (userId: string) => void;
  unsubscribeFromRealtime: () => void;
  /**
   * Call while still signed in, right before signing out: tries once more to
   * save every task (and delete) Supabase hasn't confirmed. Resolves to how
   * many are still unsaved — those stay on this phone (see handleSignOut), not lost.
   */
  saveUnsyncedTasks: () => Promise<number>;
  handleSignOut: (options?: { accountDeleted?: boolean }) => Promise<void>;
  addTask: (input: NewTaskInput) => string;
  /**
   * Waits for the database to confirm these tasks' latest saves. True only
   * when every one is saved to the account — what the user may be told.
   */
  confirmSaved: (taskIds: string[]) => Promise<boolean>;
  archiveTask: (id: string) => void;
  /** Brings back an archived task or a skipped occurrence. */
  restoreTask: (id: string) => void;
  /** Applies the "skip missed" rule of every repeating task; returns how many tasks it changed. */
  applyMissedOccurrences: (now?: Date) => number;
  /**
   * Edits a task. On a repeating task, `scope` decides whether later
   * occurrences follow ("future"/"series") or only this one changes ("this",
   * the default).
   */
  updateTask: (id: string, changes: TaskChanges, scope?: RecurrenceScope) => void;
  /** On a repeating task: "this" skips to the next occurrence (default), "future" ends the series, "series" removes it all. */
  deleteTask: (id: string, scope?: RecurrenceScope) => void;
  /**
   * Plans an operation (lib/taskOperations.ts) and commits it in one state
   * update and one sync request. Returns the plan: what changed, per task.
   */
  executeOperation: (operation: TaskOperation, now?: Date) => OperationPlan;
  /** Commits a plan made by planOperation against the current list. */
  applyPlan: (plan: Pick<OperationPlan, "upserts" | "deletes">, now?: Date) => void;
  /** Undo for a whole operation: every task back to the version given, or removed where that's null. */
  restoreSnapshots: (snapshots: { taskId: string; before: Task | null }[]) => void;
  toggleTaskStatus: (id: string) => void;
  completeTask: (id: string) => void;
  reopenTask: (id: string) => void;
  completeStep: (taskId: string, stepId: string) => void;
  addSubtask: (taskId: string, label: string) => void;
  /** Renames a subtask from Task Details. */
  updateSubtask: (taskId: string, subtaskId: string, label: string) => void;
  /** Removes a subtask and hands "current" to the next unfinished one if needed. */
  deleteSubtask: (taskId: string, subtaskId: string) => void;
  addContext: (taskId: string, note: string, estimatedMinutesOverride?: number) => void;
  /** Replaces the task's AI context notes as-is — removing a note goes through this (adding or editing one reassesses the task, see useReassessStore). */
  setContextNotes: (taskId: string, notes: string[]) => void;
  /**
   * Saves a change the user is about to be told about, and resolves once it
   * really is saved: confirmed by Supabase when signed in, on the phone when
   * not. If the save fails, nothing changes on the phone either.
   *
   * `build` gets the task as it is now and returns the version to save. If
   * the task changes while the request is in flight (a step ticked, another
   * device), `build` runs again on the newer version, so neither change
   * overwrites the other.
   */
  saveTaskNow: (taskId: string, build: (current: Task) => Task) => Promise<SaveTaskResult>;
  skipTask: (taskId: string, reason: string) => void;
  regeneratePlan: (taskId: string) => void;
  applyPlanSteps: (taskId: string, steps: PlanStep[]) => void;
  /** AI Breakdown in a session: swaps the unfinished steps for new ones, keeping the ones already checked off. */
  replaceRemainingSteps: (taskId: string, steps: PlanStep[]) => void;
  applyStructuredAction: (action: StructuredAction) => {
    message: string;
    taskId?: string;
    taskIds?: string[];
    /** Every task the action touched as it was before — what undo restores. */
    undo?: { taskId: string; before: Task | null }[];
  };
};

export const useTaskStore = create<TaskStore>()(
  persist(
    (set, get) => ({
      tasks: [],
      syncUserId: null,
      unsynced: {},
      pendingDeletes: {},
      ownerId: null,

      // Supabase decides which tasks a signed-in user has, but a task the
      // user edited more recently than the stored row keeps its local
      // version. Anything local that Supabase is behind on gets pushed again
      // right here, so the row repairs itself instead of reverting the user's
      // edit on every launch.
      hydrateFromSupabase: async (userId) => {
        set({ syncUserId: userId });
        try {
          await rehydrated;
          if (get().syncUserId !== userId) return;

          // A list another account left behind (its session ended without
          // signing out here) is set aside for that account, never merged in.
          const { ownerId } = get();
          if (ownerId && ownerId !== userId) {
            await stashUnsynced(ownerId, get().tasks, get().unsynced, Object.keys(get().pendingDeletes));
            set({ tasks: [], unsynced: {}, pendingDeletes: {} });
          }
          // Changes this account had set aside when it last signed out here.
          const stashed = (await readStash<Task>(stashKey(userId))).filter((task) => !isSampleTask(task));
          if (stashed.length > 0) {
            set((state) => {
              const present = new Set(state.tasks.map((task) => task.id));
              const added = stashed.filter((task) => !present.has(task.id));
              return {
                tasks: [...normalizePersistedTasks(added), ...state.tasks],
                unsynced: { ...state.unsynced, ...Object.fromEntries(added.map((task) => [task.id, task.updatedAt])) },
              };
            });
          }
          const stashedDeletes = (await readStash<string>(deletesStashKey(userId))).filter((id) => typeof id === "string");
          if (stashedDeletes.length > 0) {
            const deletedAt = new Date().toISOString();
            set((state) => ({
              pendingDeletes: { ...state.pendingDeletes, ...Object.fromEntries(stashedDeletes.map((id) => [id, deletedAt])) },
            }));
          }
          set({ ownerId: userId });
          await AsyncStorage.removeItem(stashKey(userId));
          await AsyncStorage.removeItem(deletesStashKey(userId));

          const fetched = await fetchTasks(userId);
          if (get().syncUserId !== userId) return;
          // A task deleted here whose delete never reached Supabase stays
          // deleted: its row is left out, and the delete goes out again below.
          const { pendingDeletes } = get();
          const remoteTasks = fetched.filter((task) => !isSampleTask(task) && !(task.id in pendingDeletes));
          const { tasks: merged, toPush } = mergeRemoteTasks(remoteTasks, get().tasks, get().unsynced);
          const tasks = normalizePersistedTasks(merged);
          // Everything not being pushed now matches Supabase; syncUpsert marks
          // the rest unsynced again until their saves are confirmed.
          set({ tasks: recalcAll(tasks), unsynced: {} });
          const pushIds = new Set(toPush.map((task) => task.id));
          get()
            .tasks.filter((task) => pushIds.has(task.id))
            .forEach((task) => syncUpsert(task, userId));
          syncDeleteMany(Object.keys(pendingDeletes), userId);
          fetched.filter(isSampleTask).forEach((task) => syncDelete(task.id, userId));
        } catch (error) {
          console.warn("[useTaskStore] hydrate failed", error);
        }
      },

      subscribeToRealtime: (userId) => {
        if (realtimeChannel) return;
        realtimeChannel = subscribeToTasks(userId, (task, event) => {
          if (event === "DELETE") {
            // An edit this phone hasn't saved yet outlives a delete made on
            // another device, as it does in hydrateFromSupabase: the task
            // stays, and goes up again.
            const local = get().tasks.find((t) => t.id === task.id);
            if (local && task.id in get().unsynced) {
              syncUpsert(local, get().syncUserId);
              return;
            }
            set((state) => ({ tasks: state.tasks.filter((t) => t.id !== task.id) }));
            return;
          }
          // Deleted here, and that delete is still on its way: a late echo of
          // an earlier save mustn't bring the task back.
          if (task.id in get().pendingDeletes) return;
          set((state) => {
            const existing = state.tasks.find((t) => t.id === task.id);
            // Last-write-wins, and skips echoes of our own just-applied write.
            if (existing && Date.parse(existing.updatedAt) >= Date.parse(task.updatedAt)) return {};
            const incoming = normalizePersistedTasks([keepLocalOnlyFields(task, existing)])[0];
            const merged = existing
              ? state.tasks.map((t) => (t.id === task.id ? incoming : t))
              : [incoming, ...state.tasks];
            return { tasks: recalcAll(merged) };
          });
        });
      },

      unsubscribeFromRealtime: () => {
        realtimeChannel?.unsubscribe();
        realtimeChannel = null;
      },

      saveUnsyncedTasks: async () => {
        const { syncUserId, tasks, unsynced, pendingDeletes } = get();
        const unsaved = () => Object.keys(get().unsynced).length + Object.keys(get().pendingDeletes).length;
        if (!syncUserId) return unsaved();
        const saves = tasks.filter((task) => task.id in unsynced).map((task) => syncUpsert(task, syncUserId));
        saves.push(syncDeleteMany(Object.keys(pendingDeletes), syncUserId));
        await Promise.race([
          Promise.all(saves),
          new Promise((resolve) => setTimeout(resolve, SIGN_OUT_SAVE_TIMEOUT_MS)),
        ]);
        return unsaved();
      },

      // Clears this phone's copy only — the account's tasks stay in Supabase
      // for the next sign-in, and any this phone never managed to save are set
      // aside for this account (see stashUnsynced) rather than thrown away.
      handleSignOut: async (options) => {
        realtimeChannel?.unsubscribe();
        realtimeChannel = null;
        const { syncUserId, ownerId, tasks, unsynced, pendingDeletes } = get();
        const owner = syncUserId ?? ownerId;
        if (owner) {
          // A deleted account has nothing to come back to.
          if (options?.accountDeleted) {
            await AsyncStorage.removeItem(stashKey(owner));
            await AsyncStorage.removeItem(deletesStashKey(owner));
          } else {
            await stashUnsynced(owner, tasks, unsynced, Object.keys(pendingDeletes));
          }
        }
        set({ tasks: [], syncUserId: null, unsynced: {}, pendingDeletes: {}, ownerId: null });
        // The phone would otherwise keep firing reminders about the departing
        // account's tasks, titles and all.
        await clearAllNotifications();
        await AsyncStorage.removeItem("nexdo-tasks");
      },

      addTask: (input) => {
        // Idempotent for a given id: adding the same preview card twice (a
        // double tap, a retry) finds the task already there.
        if (input.id && get().tasks.some((t) => t.id === input.id)) return input.id;
        const now = new Date();
        const task = buildTask(input, now);
        set((state) => ({ tasks: recalcAll([task, ...state.tasks], now) }));
        syncUpsert(get().tasks.find((t) => t.id === task.id)!, get().syncUserId);
        return task.id;
      },

      confirmSaved: async (taskIds) => {
        if (!get().syncUserId) return false;
        const saves = taskIds.map((id) => pendingSaves.get(id)).filter((save): save is Promise<boolean> => !!save);
        await Promise.race([
          Promise.all(saves),
          new Promise((resolve) => setTimeout(resolve, CONFIRM_SAVE_TIMEOUT_MS)),
        ]);
        const { unsynced } = get();
        return taskIds.every((id) => !(id in unsynced));
      },

      archiveTask: (id) => {
        get().executeOperation({ kind: "archive", target: { taskIds: [id] } });
      },

      restoreTask: (id) => {
        get().executeOperation({ kind: "restore", target: { taskIds: [id] } });
      },

      // "Skip missed" series (RecurrenceRule.missed): an occurrence left
      // undone once the next one is due is marked skipped, and the current one
      // comes in. Runs on launch, after every sync and when the app comes back
      // to the foreground; occurrence ids are derived from the series and day,
      // so running it again — here or on another device — changes nothing.
      applyMissedOccurrences: (now = new Date()) => {
        const upserts: Task[] = [];
        let working = get().tasks;
        for (const task of get().tasks) {
          const delta = skipMissedDelta(task, now, working);
          if (!delta) continue;
          upserts.push(...delta.upserts);
          const changed = new Map(delta.upserts.map((entry) => [entry.id, entry]));
          working = [...working.map((entry) => changed.get(entry.id) ?? entry), ...delta.upserts.filter((entry) => !working.some((w) => w.id === entry.id))];
        }
        if (upserts.length > 0) get().applyPlan({ upserts, deletes: [] }, now);
        else set((state) => ({ tasks: recalcAll(state.tasks, now) }));
        return upserts.length;
      },

      // Edits, completion, reopening and deletion all go through the same
      // planner the AI uses (lib/taskOperations.ts), so a repeating task
      // behaves the same whether it was ticked off by hand or by the chat.
      updateTask: (id, changes, scope) => {
        get().executeOperation({ kind: "update", target: { taskIds: [id] }, changes, scope });
      },

      deleteTask: (id, scope) => {
        get().executeOperation({ kind: "delete", target: { taskIds: [id] }, scope });
      },

      executeOperation: (operation, now = new Date()) => {
        const plan = planOperation(get().tasks, operation, now);
        get().applyPlan(plan, now);
        return plan;
      },

      applyPlan: (plan, now = new Date()) => {
        if (plan.upserts.length === 0 && plan.deletes.length === 0) return;
        const doomed = new Set(plan.deletes);
        const changed = new Map(plan.upserts.map((task) => [task.id, task]));
        set((state) => {
          const kept = state.tasks.filter((task) => !doomed.has(task.id)).map((task) => changed.get(task.id) ?? task);
          const present = new Set(kept.map((task) => task.id));
          const created = plan.upserts.filter((task) => !present.has(task.id));
          return { tasks: recalcAll([...created, ...kept], now) };
        });
        // The recalculated versions, so the saved scores match what's on screen.
        const current = new Map(get().tasks.map((task) => [task.id, task]));
        syncUpsertMany(
          plan.upserts.map((task) => current.get(task.id)).filter((task): task is Task => !!task),
          get().syncUserId,
        );
        syncDeleteMany(plan.deletes, get().syncUserId);
      },

      restoreSnapshots: (snapshots) => {
        const now = new Date();
        get().applyPlan(
          {
            // A fresh updatedAt: the restored version is the newest edit now,
            // so other devices (last-write-wins) take it instead of ignoring it.
            upserts: snapshots.flatMap((entry) => (entry.before ? [{ ...entry.before, updatedAt: now.toISOString() }] : [])),
            deletes: snapshots.filter((entry) => !entry.before).map((entry) => entry.taskId),
          },
          now,
        );
      },

      toggleTaskStatus: (id) => {
        const task = get().tasks.find((t) => t.id === id);
        if (!task) return;
        if (task.status === "completed") get().reopenTask(id);
        else get().completeTask(id);
      },

      completeTask: (id) => {
        get().executeOperation({ kind: "complete", target: { taskIds: [id] } });
      },

      reopenTask: (id) => {
        get().executeOperation({ kind: "reopen", target: { taskIds: [id] } });
      },

      completeStep: (taskId, stepId) => {
        const now = new Date();
        const task = get().tasks.find((t) => t.id === taskId);
        if (!task?.subtasks) return;
        const target = task.subtasks.find((subtask) => subtask.id === stepId);
        // Any step can be ticked, in any order — ticking a finished one puts it
        // back. Only the task itself has to still be open.
        if (task.status !== "pending" || !target) return;

        const updatedSubtasks: Subtask[] = task.subtasks.map((subtask) =>
          subtask.id === stepId
            ? { ...subtask, status: target.status === "completed" ? ("pending" as const) : ("completed" as const) }
            : subtask,
        );
        // "Current" is simply the first step still left, whatever order the
        // user ticked them in.
        const nextPending = updatedSubtasks
          .filter((subtask) => subtask.status !== "completed")
          .sort((a, b) => a.order - b.order)[0];
        const finalSubtasks: Subtask[] = updatedSubtasks.map((subtask) =>
          subtask.status === "completed"
            ? subtask
            : { ...subtask, status: subtask.id === nextPending?.id ? ("current" as const) : ("pending" as const) },
        );
        const allDone = finalSubtasks.every((subtask) => subtask.status === "completed");

        // Ticking the last step finishes the task — through the same path as
        // any other completion, so a repeating task brings in its next one.
        if (allDone) {
          const delta = completeTaskDelta(task, now, get().tasks, {
            subtasks: finalSubtasks,
            currentStepId: undefined,
            estimatedMinutes: 0,
          });
          get().applyPlan(delta, now);
          return;
        }

        set((state) => ({
          tasks: recalcAll(
            state.tasks.map((t) =>
              t.id === taskId
                ? {
                    ...t,
                    subtasks: finalSubtasks,
                    currentStepId: nextPending?.id,
                    estimatedMinutes: remainingMinutes(finalSubtasks),
                    updatedAt: now.toISOString(),
                  }
                : t,
            ),
            now,
          ),
        }));
        const updated = get().tasks.find((t) => t.id === taskId);
        if (updated) syncUpsert(updated, get().syncUserId);
      },

      addSubtask: (taskId, label) => {
        const trimmed = label.trim();
        if (!trimmed) return;
        const now = new Date();
        const task = get().tasks.find((t) => t.id === taskId);
        if (!task) return;

        const existing = task.subtasks ?? [];
        const newSubtask: Subtask = {
          id: `subtask-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          label: trimmed,
          estimatedMinutes: 10,
          order: existing.length,
          status: existing.some((subtask) => subtask.status === "current") ? "pending" : "current",
        };
        const subtasks = [...existing, newSubtask];

        set((state) => ({
          tasks: recalcAll(
            state.tasks.map((t) =>
              t.id === taskId
                ? {
                    ...t,
                    subtasks,
                    currentStepId: subtasks.find((s) => s.status === "current")?.id,
                    estimatedMinutes: remainingMinutes(subtasks),
                    status: "pending",
                    completedAt: undefined,
                    updatedAt: now.toISOString(),
                  }
                : t,
            ),
            now,
          ),
        }));
        const updated = get().tasks.find((t) => t.id === taskId);
        if (updated) syncUpsert(updated, get().syncUserId);
      },

      updateSubtask: (taskId, subtaskId, label) => {
        const trimmed = label.trim();
        if (!trimmed) return;
        const now = new Date();
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  subtasks: t.subtasks?.map((subtask) =>
                    subtask.id === subtaskId ? { ...subtask, label: trimmed } : subtask,
                  ),
                  updatedAt: now.toISOString(),
                }
              : t,
          ),
        }));
        const updated = get().tasks.find((t) => t.id === taskId);
        if (updated) syncUpsert(updated, get().syncUserId);
      },

      deleteSubtask: (taskId, subtaskId) => {
        const now = new Date();
        const task = get().tasks.find((t) => t.id === taskId);
        if (!task?.subtasks) return;

        const remaining = task.subtasks
          .filter((subtask) => subtask.id !== subtaskId)
          .sort((a, b) => a.order - b.order);
        const hasCurrent = remaining.some((subtask) => subtask.status === "current");
        const nextCurrentId = hasCurrent
          ? undefined
          : remaining.find((subtask) => subtask.status === "pending")?.id;
        const subtasks: Subtask[] = remaining.map((subtask, index) => ({
          ...subtask,
          order: index,
          status: subtask.id === nextCurrentId ? "current" : subtask.status,
        }));
        const hasUnfinished = subtasks.some((subtask) => subtask.status !== "completed");

        set((state) => ({
          tasks: recalcAll(
            state.tasks.map((t) =>
              t.id === taskId
                ? {
                    ...t,
                    subtasks,
                    currentStepId: subtasks.find((subtask) => subtask.status === "current")?.id,
                    estimatedMinutes: hasUnfinished ? remainingMinutes(subtasks) : t.estimatedMinutes,
                    updatedAt: now.toISOString(),
                  }
                : t,
            ),
            now,
          ),
        }));
        const updated = get().tasks.find((t) => t.id === taskId);
        if (updated) syncUpsert(updated, get().syncUserId);
      },

      // The chat's ADD_CONTEXT: the note, plus the model's own re-estimate
      // when it gave one (taxonomy 2.2/3.3 — scope change or partial
      // progress), which its reply states. Nothing else is read into the
      // note: a regex layer used to push the deadline a day on "can't
      // finish" and reorder steps on "only have N minutes", without a word to
      // the user — Task Details' reassessment (useReassessStore) is where a
      // note changes the rest of a task, and it says what it changed.
      addContext: (taskId, note, estimatedMinutesOverride) => {
        const now = new Date();
        if (!get().tasks.some((t) => t.id === taskId)) return;

        set((state) => ({
          tasks: recalcAll(
            state.tasks.map((t) =>
              t.id === taskId
                ? {
                    ...t,
                    aiContext: { ...t.aiContext, notes: [...t.aiContext.notes, note] },
                    estimatedMinutes: estimatedMinutesOverride ?? t.estimatedMinutes,
                    updatedAt: now.toISOString(),
                  }
                : t,
            ),
            now,
          ),
        }));
        const updated = get().tasks.find((t) => t.id === taskId);
        if (updated) syncUpsert(updated, get().syncUserId);
      },

      // Never reinterprets the notes — they're just what the AI reads.
      setContextNotes: (taskId, notes) => {
        const now = new Date();
        set((state) => ({
          tasks: recalcAll(
            state.tasks.map((t) =>
              t.id === taskId ? { ...t, aiContext: { ...t.aiContext, notes }, updatedAt: now.toISOString() } : t,
            ),
            now,
          ),
        }));
        const updated = get().tasks.find((t) => t.id === taskId);
        if (updated) syncUpsert(updated, get().syncUserId);
      },

      // Remote first, unlike every other mutation here: the change is shown
      // to the user as done, so it has to be done before the phone shows it.
      saveTaskNow: async (taskId, build) => {
        for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt += 1) {
          const current = get().tasks.find((task) => task.id === taskId);
          if (!current) return { ok: false, reason: "missing" };
          const next = build(current);
          const userId = get().syncUserId;
          if (userId) {
            try {
              // One row, one statement: the whole new version lands or none of it does.
              await inOrder([taskId], () => upsertTaskRows([next], userId));
            } catch (error) {
              console.warn("[useTaskStore] save failed", error);
              return { ok: false, reason: "save-failed" };
            }
            // Signed out (or into another account) while the request was out:
            // the list here isn't this account's any more, so a task missing
            // from it wasn't deleted — its row must be left alone.
            if (get().syncUserId !== userId) return { ok: false, reason: "missing" };
          }

          const latest = get().tasks.find((task) => task.id === taskId);
          if (!latest) {
            // Deleted while the request was out — the row just written would bring it back.
            if (userId) syncDelete(taskId, userId);
            return { ok: false, reason: "missing" };
          }
          // Changed meanwhile — by anything other than this save's own
          // realtime echo: build again on top of that and save again.
          if (latest.updatedAt !== current.updatedAt && latest.updatedAt !== next.updatedAt) {
            if (attempt === MAX_SAVE_ATTEMPTS - 1 && userId) {
              // Out of retries: put the phone's version back up, so Supabase
              // doesn't keep one the phone never showed.
              syncUpsert(latest, userId);
            }
            continue;
          }

          const now = new Date();
          set((state) => ({
            tasks: recalcAll(
              state.tasks.map((task) => (task.id === taskId ? next : task)),
              now,
            ),
            // Signed out, the phone's copy is the save — kept as unsynced
            // until an account uploads it, like any other change.
            unsynced: userId ? withoutKeys(state.unsynced, [taskId]) : { ...state.unsynced, [taskId]: next.updatedAt },
          }));
          return { ok: true, task: get().tasks.find((task) => task.id === taskId) ?? next };
        }
        return { ok: false, reason: "conflict" };
      },

      skipTask: (taskId, reason) => {
        const now = new Date();
        set((state) => ({
          tasks: recalcAll(
            state.tasks.map((task) =>
              task.id === taskId
                ? { ...task, skip: createSkipRecord(reason, now), updatedAt: now.toISOString() }
                : task,
            ),
            now,
          ),
        }));
        const updated = get().tasks.find((t) => t.id === taskId);
        if (updated) syncUpsert(updated, get().syncUserId);
      },

      regeneratePlan: (taskId) => {
        const now = new Date();
        const task = get().tasks.find((t) => t.id === taskId);
        if (!task) return;
        // Explicit user request bypasses the "simple tasks get no plan" gate.
        const subtasks = generatePlan({
          title: task.title,
          estimatedMinutes: task.estimatedMinutes,
          complexity: task.complexity === "simple" ? "medium" : task.complexity,
        });

        set((state) => ({
          tasks: recalcAll(
            state.tasks.map((t) =>
              t.id === taskId
                ? {
                    ...t,
                    subtasks,
                    currentStepId: subtasks?.find((s) => s.status === "current")?.id,
                    updatedAt: now.toISOString(),
                  }
                : t,
            ),
            now,
          ),
        }));
        const updated = get().tasks.find((t) => t.id === taskId);
        if (updated) syncUpsert(updated, get().syncUserId);
      },

      // A proposed plan from BREAKDOWN_TASK (taxonomy 5.1) — replaces the
      // task's subtasks wholesale once the user has confirmed it.
      applyPlanSteps: (taskId, steps) => {
        const now = new Date();
        const subtasks: Subtask[] = steps.map((step, index) => ({
          id: `subtask-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 6)}`,
          label: step.title,
          estimatedMinutes: step.estimatedMinutes,
          order: index,
          status: index === 0 ? "current" : "pending",
        }));

        set((state) => ({
          tasks: recalcAll(
            state.tasks.map((t) =>
              t.id === taskId
                ? {
                    ...t,
                    subtasks,
                    currentStepId: subtasks[0]?.id,
                    estimatedMinutes: remainingMinutes(subtasks),
                    updatedAt: now.toISOString(),
                  }
                : t,
            ),
            now,
          ),
        }));
        const updated = get().tasks.find((t) => t.id === taskId);
        if (updated) syncUpsert(updated, get().syncUserId);
      },

      replaceRemainingSteps: (taskId, steps) => {
        const now = new Date();
        const task = get().tasks.find((t) => t.id === taskId);
        if (!task || steps.length === 0) return;

        const finished = (task.subtasks ?? [])
          .filter((subtask) => subtask.status === "completed")
          .sort((a, b) => a.order - b.order);
        const subtasks: Subtask[] = [
          ...finished.map((subtask, index) => ({ ...subtask, order: index })),
          ...steps.map((step, index) => ({
            id: `subtask-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 6)}`,
            label: step.title,
            estimatedMinutes: step.estimatedMinutes,
            order: finished.length + index,
            status: index === 0 ? ("current" as const) : ("pending" as const),
          })),
        ];

        set((state) => ({
          tasks: recalcAll(
            state.tasks.map((t) =>
              t.id === taskId
                ? {
                    ...t,
                    subtasks,
                    currentStepId: subtasks.find((subtask) => subtask.status === "current")?.id,
                    estimatedMinutes: remainingMinutes(subtasks),
                    updatedAt: now.toISOString(),
                  }
                : t,
            ),
            now,
          ),
        }));
        const updated = get().tasks.find((t) => t.id === taskId);
        if (updated) syncUpsert(updated, get().syncUserId);
      },

      applyStructuredAction: (action) => {
        // Named "copy" rather than "t" — "t" is already the loop variable for a task below.
        const copy = translate().assistant;
        switch (action.type) {
          case "CREATE_TASK": {
            const ids = action.drafts.map((draft) =>
              get().addTask({
                id: draft.candidateId ? taskIdForCandidate(draft.candidateId) : undefined,
                title: draft.title,
                estimatedMinutes: draft.estimatedMinutes,
                dueDate: draft.dueDate,
                dueHasTime: draft.dueHasTime ?? false,
                priorityLevel: draft.priorityLevel,
                steps: draft.steps?.map((step, index) => ({
                  id: `subtask-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 6)}`,
                  label: step.title,
                  estimatedMinutes: step.estimatedMinutes,
                })),
                recurrence: draft.recurrence,
              }),
            );
            const message =
              action.drafts.length === 1
                ? copy.added(action.drafts[0].title)
                : copy.addedMany(action.drafts.length, action.drafts.map((d) => d.title).join(", "));
            return { message, taskId: ids[0], taskIds: ids, undo: ids.map((taskId) => ({ taskId, before: null })) };
          }
          case "OPERATE": {
            // The message is written from what the plan actually did, task by
            // task — never from what the model expected to happen.
            const plan = get().executeOperation(action.operation);
            const touched = plan.outcomes.filter((outcome) => outcome.outcome !== "unchanged").map((outcome) => outcome.taskId);
            return {
              message: describeOperationResult(action.operation, plan, translate(), get().tasks),
              taskId: touched.length === 1 ? (plan.outcomes.find((o) => o.taskId === touched[0])?.next?.id ?? touched[0]) : undefined,
              taskIds: touched,
              undo: plan.before,
            };
          }
          case "LIST_TASKS": {
            const now = new Date();
            const matches = get().tasks.filter((task) => matchesFilter(task, action.filter, now));
            return { message: describeTaskList(matches, translate(), now), taskIds: matches.map((task) => task.id) };
          }
          case "ADD_TASK_CONTEXT": {
            const task = get().tasks.find((t) => t.id === action.taskId);
            get().addContext(action.taskId, action.note, action.estimatedMinutes);
            return { message: copy.loggedContext(task?.title ?? copy.fallbackYourTask), taskId: action.taskId };
          }
          case "SKIP_TASK": {
            const task = get().tasks.find((t) => t.id === action.taskId);
            get().skipTask(action.taskId, action.reason);
            return { message: copy.skipped(task?.title ?? copy.fallbackThat), taskId: action.taskId };
          }
          case "BREAKDOWN_TASK": {
            const task = get().tasks.find((t) => t.id === action.taskId);
            get().applyPlanSteps(action.taskId, action.steps);
            return { message: copy.brokeDown(task?.title ?? copy.fallbackThat, action.steps.length), taskId: action.taskId };
          }
          case "REDIRECT_NEXT":
            return { message: copy.redirectNext(action.availableMinutes) };
          case "QUERY":
            return { message: action.answer };
          case "CLARIFY":
            return { message: action.question };
          case "UNKNOWN":
          default:
            return { message: action.reply };
        }
      },
    }),
    {
      name: "nexdo-tasks",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        tasks: state.tasks,
        unsynced: state.unsynced,
        pendingDeletes: state.pendingDeletes,
        ownerId: state.ownerId,
      }),
      // Version 1 added `unsynced`. An install from before it can't know
      // which of its tasks Supabase ever saved — and task saves were being
      // rejected for a while (the old NOT NULL "category" column) — so every
      // task on the phone counts as unsaved once: the next sign-in keeps and
      // uploads them, and last-write-wins still lets a newer row win.
      version: 1,
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<TaskStore>;
        if (version < 1) {
          const tasks = Array.isArray(state.tasks) ? state.tasks : [];
          return { ...state, unsynced: Object.fromEntries(tasks.map((task) => [task.id, task.updatedAt])) };
        }
        return state;
      },
      // Runs with (state) on success and (undefined, error) on failure —
      // either way the local snapshot is as loaded as it will get, which is
      // what hydrateFromSupabase is waiting on.
      onRehydrateStorage: () => () => resolveRehydrated(),
      merge: (persisted, current) => {
        const persistedState = persisted as Partial<TaskStore>;
        return {
          ...current,
          ...persistedState,
          tasks: normalizePersistedTasks((persistedState.tasks ?? current.tasks).filter((task) => !isSampleTask(task))),
          unsynced: persistedState.unsynced ?? {},
          pendingDeletes: persistedState.pendingDeletes ?? {},
          ownerId: persistedState.ownerId ?? null,
        };
      },
    },
  ),
);
