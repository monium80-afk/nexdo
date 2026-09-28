import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { analyzeTaskComplexity } from "@/lib/ai/analyzeComplexity";
import { applyContextToTask } from "@/lib/ai/applyContext";
import { generatePlan, isUntouchedTemplatePlan } from "@/lib/ai/generatePlan";
import type { PlanStep, StructuredAction } from "@/lib/ai/types";
import { translate } from "@/lib/i18n";
import { syncOverdueAlerts } from "@/lib/notifications";
import { describeOperationResult, describeTaskList } from "@/lib/operationMessages";
import { buildRule, startSeries, type RecurrenceScope, type RuleInput } from "@/lib/recurrence";
import { PRIORITY_LEVEL_IMPORTANCE, createSkipRecord, recalcTask } from "@/lib/scoring";
import { deleteTaskRows, fetchTasks, subscribeToTasks, upsertTaskRows } from "@/lib/supabaseSync";
import {
  completeTaskDelta,
  matchesFilter,
  planOperation,
  type OperationPlan,
  type TaskChanges,
  type TaskOperation,
} from "@/lib/taskOperations";
import { recalcAll } from "@/lib/taskPipeline";
import type { Subtask, Task, TaskPriorityLevel, TaskStep } from "@/types/task";

// Local-first background sync: mutations below stay synchronous against
// local state (UI/lib/ai never awaits anything), and additionally mirror
// the change to Supabase fire-and-forget. Failures are logged, not surfaced
// to the user — but every save is tracked in `unsynced` until Supabase
// confirms it, so a failed one is retried rather than forgotten.
let realtimeChannel: RealtimeChannel | null = null;

function withoutKeys(record: Record<string, string>, keys: string[]): Record<string, string> {
  const copy = { ...record };
  keys.forEach((key) => delete copy[key]);
  return copy;
}

// Returns a promise that never rejects, so callers can fire and forget it or
// (signing out) wait for it. Several tasks go up in one request — one
// statement on the database, so a bulk change lands whole or not at all.
function syncUpsertMany(tasks: Task[], userId: string | null): Promise<void> {
  if (tasks.length === 0) return Promise.resolve();
  useTaskStore.setState((state) => ({
    unsynced: { ...state.unsynced, ...Object.fromEntries(tasks.map((task) => [task.id, task.updatedAt])) },
  }));
  if (!userId) return Promise.resolve();
  return upsertTaskRows(tasks, userId)
    .then(() => {
      // Only if this is still the newest version — an edit made while the
      // request was in flight has its own save to wait for.
      useTaskStore.setState((state) => {
        const saved = tasks.filter((task) => state.unsynced[task.id] === task.updatedAt).map((task) => task.id);
        return saved.length > 0 ? { unsynced: withoutKeys(state.unsynced, saved) } : {};
      });
    })
    .catch((error) => {
      console.warn("[useTaskStore] upsert failed", error);
    });
}

function syncUpsert(task: Task, userId: string | null): Promise<void> {
  return syncUpsertMany([task], userId);
}

function syncDeleteMany(taskIds: string[], userId: string | null) {
  if (taskIds.length === 0) return;
  useTaskStore.setState((state) =>
    taskIds.some((id) => id in state.unsynced) ? { unsynced: withoutKeys(state.unsynced, taskIds) } : {},
  );
  if (!userId) return;
  deleteTaskRows(taskIds, userId).catch((error) => console.warn("[useTaskStore] delete failed", error));
}

function syncDelete(taskId: string, userId: string | null) {
  syncDeleteMany([taskId], userId);
}

// Signing out clears this phone's copy of the list — the account's tasks live
// in Supabase and come back on the next sign-in. The exception is a task
// Supabase never confirmed (offline, the app closed mid-save, a row the
// database rejected): the phone holds the only copy, so it is set aside here
// under the account it belongs to and uploaded the next time that account
// signs in on this phone. Never shown to, or mixed into, another account.
const stashKey = (userId: string) => `nexdo-unsynced-tasks:${userId}`;

async function stashUnsynced(userId: string, tasks: Task[], unsynced: Record<string, string>) {
  const pending = tasks.filter((task) => task.id in unsynced);
  if (pending.length === 0) return;
  const earlier = await takeStash(userId);
  const ids = new Set(pending.map((task) => task.id));
  await AsyncStorage.setItem(stashKey(userId), JSON.stringify([...pending, ...earlier.filter((task) => !ids.has(task.id))]));
}

async function takeStash(userId: string): Promise<Task[]> {
  try {
    const raw = await AsyncStorage.getItem(stashKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Task[]) : [];
  } catch (error) {
    console.warn("[useTaskStore] couldn't read unsynced tasks", error);
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
  title: string;
  estimatedMinutes: number;
  dueDate?: string;
  priorityLevel: TaskPriorityLevel;
  notes?: string;
  steps?: TaskStep[];
  /** Makes the new task the first occurrence of a repeating series. */
  recurrence?: RuleInput;
};

function createTaskId(): string {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

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
  const task: Task = {
    id: createTaskId(),
    title: input.title.trim(),
    status: "pending",
    dueDate: input.dueDate,
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
  // A repeating task's first occurrence sits on the rule's first day (a task
  // due Wednesday that repeats on Mondays is due next Monday).
  const rule = input.recurrence ? buildRule(input.recurrence, input.dueDate, now) : null;
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

    return {
      ...task,
      aiContext: {
        notes: Array.isArray(task.aiContext?.notes) ? task.aiContext.notes : [],
      },
      subtasks,
      currentStepId,
    };
  });
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
    return remoteTask;
  });

  const neverSaved = local.filter((task) => !remoteIds.has(task.id) && task.id in unsynced);
  toPush.push(...neverSaved);
  return { tasks: [...neverSaved, ...tasks], toPush };
}

type TaskStore = {
  tasks: Task[];
  syncUserId: string | null;
  /** Tasks whose newest local version Supabase hasn't confirmed yet: id → that version's updatedAt. */
  unsynced: Record<string, string>;
  /** The account the local list belongs to — persisted, so it outlives an app restart. */
  ownerId: string | null;
  hydrateFromSupabase: (userId: string) => Promise<void>;
  subscribeToRealtime: (userId: string) => void;
  unsubscribeFromRealtime: () => void;
  /**
   * Call while still signed in, right before signing out: tries once more to
   * save every task Supabase hasn't confirmed. Resolves to how many are still
   * unsaved — those stay on this phone (see handleSignOut), not lost.
   */
  saveUnsyncedTasks: () => Promise<number>;
  handleSignOut: (options?: { accountDeleted?: boolean }) => Promise<void>;
  addTask: (input: NewTaskInput) => string;
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
  /** Replaces the task's AI context notes as-is — the Task Details note cards add, edit and remove through this. */
  setContextNotes: (taskId: string, notes: string[]) => void;
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
            await stashUnsynced(ownerId, get().tasks, get().unsynced);
            set({ tasks: [], unsynced: {} });
          }
          // Tasks this account had set aside when it last signed out here.
          const stashed = (await takeStash(userId)).filter((task) => !isSampleTask(task));
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
          set({ ownerId: userId });
          await AsyncStorage.removeItem(stashKey(userId));

          const fetched = await fetchTasks(userId);
          if (get().syncUserId !== userId) return;
          const remoteTasks = fetched.filter((task) => !isSampleTask(task));
          const { tasks, toPush } = mergeRemoteTasks(normalizePersistedTasks(remoteTasks), get().tasks, get().unsynced);
          // Everything not being pushed now matches Supabase; syncUpsert marks
          // the rest unsynced again until their saves are confirmed.
          set({ tasks: recalcAll(tasks), unsynced: {} });
          const pushIds = new Set(toPush.map((task) => task.id));
          get()
            .tasks.filter((task) => pushIds.has(task.id))
            .forEach((task) => syncUpsert(task, userId));
          fetched.filter(isSampleTask).forEach((task) => syncDelete(task.id, userId));
        } catch (error) {
          console.warn("[useTaskStore] hydrate failed", error);
        }
      },

      subscribeToRealtime: (userId) => {
        if (realtimeChannel) return;
        realtimeChannel = subscribeToTasks(userId, (task, event) => {
          set((state) => {
            if (event === "DELETE") {
              return { tasks: state.tasks.filter((t) => t.id !== task.id) };
            }
            const existing = state.tasks.find((t) => t.id === task.id);
            // Last-write-wins, and skips echoes of our own just-applied write.
            if (existing && Date.parse(existing.updatedAt) >= Date.parse(task.updatedAt)) return {};
            const merged = existing
              ? state.tasks.map((t) => (t.id === task.id ? task : t))
              : [task, ...state.tasks];
            return { tasks: recalcAll(merged) };
          });
        });
      },

      unsubscribeFromRealtime: () => {
        realtimeChannel?.unsubscribe();
        realtimeChannel = null;
      },

      saveUnsyncedTasks: async () => {
        const { syncUserId, tasks, unsynced } = get();
        if (!syncUserId) return Object.keys(unsynced).length;
        const saves = tasks.filter((task) => task.id in unsynced).map((task) => syncUpsert(task, syncUserId));
        await Promise.race([
          Promise.all(saves),
          new Promise((resolve) => setTimeout(resolve, SIGN_OUT_SAVE_TIMEOUT_MS)),
        ]);
        return Object.keys(get().unsynced).length;
      },

      // Clears this phone's copy only — the account's tasks stay in Supabase
      // for the next sign-in, and any this phone never managed to save are set
      // aside for this account (see stashUnsynced) rather than thrown away.
      handleSignOut: async (options) => {
        realtimeChannel?.unsubscribe();
        realtimeChannel = null;
        const { syncUserId, ownerId, tasks, unsynced } = get();
        const owner = syncUserId ?? ownerId;
        if (owner) {
          // A deleted account has nothing to come back to.
          if (options?.accountDeleted) await AsyncStorage.removeItem(stashKey(owner));
          else await stashUnsynced(owner, tasks, unsynced);
        }
        set({ tasks: [], syncUserId: null, unsynced: {}, ownerId: null });
        // The phone would otherwise keep firing alerts about the departing
        // account's tasks, titles and all.
        await syncOverdueAlerts([]);
        await AsyncStorage.removeItem("nexdo-tasks");
      },

      addTask: (input) => {
        const now = new Date();
        const task = buildTask(input, now);
        set((state) => ({ tasks: recalcAll([task, ...state.tasks], now) }));
        syncUpsert(get().tasks.find((t) => t.id === task.id)!, get().syncUserId);
        return task.id;
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

      addContext: (taskId, note, estimatedMinutesOverride) => {
        const now = new Date();
        const task = get().tasks.find((t) => t.id === taskId);
        if (!task) return;
        const result = applyContextToTask(task, note, now);

        set((state) => ({
          tasks: recalcAll(
            state.tasks.map((t) =>
              t.id === taskId
                ? {
                    ...t,
                    aiContext: { notes: [...t.aiContext.notes, result.noteToStore] },
                    subtasks: result.updatedSubtasks ?? t.subtasks,
                    currentStepId: result.updatedSubtasks
                      ? result.updatedSubtasks.find((s) => s.status === "current")?.id
                      : t.currentStepId,
                    // The AI's own re-estimate (taxonomy 2.2/3.3 — scope
                    // change or partial progress) wins over the generic
                    // capacity-reorder heuristic below when both apply.
                    estimatedMinutes: estimatedMinutesOverride ?? result.updatedEstimatedMinutes ?? t.estimatedMinutes,
                    dueDate: result.newDueDate ?? t.dueDate,
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

      // Unlike addContext above, this never reinterprets the notes (no subtask
      // reordering, no deadline changes) — they're just what the AI reads.
      setContextNotes: (taskId, notes) => {
        const now = new Date();
        set((state) => ({
          tasks: recalcAll(
            state.tasks.map((t) =>
              t.id === taskId ? { ...t, aiContext: { notes }, updatedAt: now.toISOString() } : t,
            ),
            now,
          ),
        }));
        const updated = get().tasks.find((t) => t.id === taskId);
        if (updated) syncUpsert(updated, get().syncUserId);
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
                title: draft.title,
                estimatedMinutes: draft.estimatedMinutes,
                dueDate: draft.dueDate,
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
      partialize: (state) => ({ tasks: state.tasks, unsynced: state.unsynced, ownerId: state.ownerId }),
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
          ownerId: persistedState.ownerId ?? null,
        };
      },
    },
  ),
);
