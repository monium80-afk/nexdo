import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { tasks as initialTasks } from "@/data/tasks";
import { analyzeTaskComplexity } from "@/lib/ai/analyzeComplexity";
import { applyContextToTask } from "@/lib/ai/applyContext";
import { generatePlan } from "@/lib/ai/generatePlan";
import type { PlanStep, StructuredAction } from "@/lib/ai/types";
import { translate } from "@/lib/i18n";
import { PRIORITY_LEVEL_IMPORTANCE, createSkipRecord, recalcTask } from "@/lib/scoring";
import { deleteTaskRow, fetchTasks, subscribeToTasks, upsertTaskRow } from "@/lib/supabaseSync";
import { describeTaskCount, tasksInScope } from "@/lib/taskMeta";
import { recalcAll } from "@/lib/taskPipeline";
import type { Subtask, Task, TaskPriorityLevel, TaskStep } from "@/types/task";

// Local-first background sync: mutations below stay synchronous against
// local state (UI/lib/ai never awaits anything), and additionally mirror
// the change to Supabase fire-and-forget. Failures are logged, not surfaced
// to the user — acceptable for a v1 teaching app.
let realtimeChannel: RealtimeChannel | null = null;
const confirmedUpsertIds = new Set<string>();

function syncUpsert(task: Task, userId: string | null) {
  if (!userId) return;
  upsertTaskRow(task, userId)
    .then(() => confirmedUpsertIds.add(task.id))
    .catch((error) => console.warn("[useTaskStore] upsert failed", error));
}

function syncDelete(taskId: string, userId: string | null) {
  if (!userId) return;
  deleteTaskRow(taskId).catch((error) => console.warn("[useTaskStore] delete failed", error));
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

function buildTask(input: NewTaskInput, now: Date): Task {
  const complexity = analyzeTaskComplexity({
    title: input.title,
    estimatedMinutes: input.estimatedMinutes,
    subtaskCount: input.steps?.length,
  }).complexity;

  const subtasks =
    input.steps && input.steps.length > 0
      ? stepsToSubtasks(input.steps)
      : generatePlan({
          title: input.title,
          estimatedMinutes: input.estimatedMinutes,
          complexity,
        });

  const nowIso = now.toISOString();
  return recalcTask(
    {
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
    },
    now,
  );
}

function remainingMinutes(subtasks: Subtask[]): number {
  return subtasks.filter((subtask) => subtask.status !== "completed").reduce((sum, s) => sum + s.estimatedMinutes, 0);
}

function normalizePersistedTasks(tasks: Task[]): Task[] {
  return tasks.map((task) => {
    const orderedSubtasks = task.subtasks?.slice().sort((a, b) => a.order - b.order);
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
 * row it left behind. Supabase still decides which tasks *exist*, so a task
 * deleted on another device stays deleted.
 */
function mergeRemoteTasks(remote: Task[], local: Task[]): { tasks: Task[]; localNewer: Task[] } {
  const localById = new Map(local.map((task) => [task.id, task]));
  const remoteIds = new Set(remote.map((task) => task.id));
  const localNewer: Task[] = [];

  const tasks = remote.map((remoteTask) => {
    const localTask = localById.get(remoteTask.id);
    if (localTask && Date.parse(localTask.updatedAt) > Date.parse(remoteTask.updatedAt)) {
      localNewer.push(localTask);
      return localTask;
    }
    return remoteTask;
  });

  const unconfirmedLocal = local.filter((task) => !remoteIds.has(task.id) && !confirmedUpsertIds.has(task.id));
  return { tasks: [...unconfirmedLocal, ...tasks], localNewer };
}

type TaskStore = {
  tasks: Task[];
  syncUserId: string | null;
  hydrateFromSupabase: (userId: string) => Promise<void>;
  subscribeToRealtime: (userId: string) => void;
  unsubscribeFromRealtime: () => void;
  handleSignOut: () => Promise<void>;
  addTask: (input: NewTaskInput) => string;
  updateTask: (
    id: string,
    changes: Partial<Pick<Task, "title" | "dueDate" | "estimatedMinutes" | "notes">>,
  ) => void;
  deleteTask: (id: string) => void;
  deleteTasks: (ids: string[]) => void;
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
  /** Undo support: null restores "no task" (undoes a create), otherwise replaces/reinserts the given task verbatim. */
  restoreTaskSnapshot: (taskId: string, snapshot: Task | null) => void;
  applyStructuredAction: (action: StructuredAction) => { message: string; taskId?: string; taskIds?: string[] };
};

export const useTaskStore = create<TaskStore>()(
  persist(
    (set, get) => ({
      tasks: recalcAll(initialTasks),
      syncUserId: null,

      // Supabase decides which tasks a signed-in user has (an empty result
      // means this user has no synced tasks yet — the local seed data was
      // never a real synced task, so it's fine for it to drop away once a
      // real account takes over), but a task the user edited more recently
      // than the stored row keeps its local version. Anything local that
      // Supabase is behind on gets pushed again right here, so the row
      // repairs itself instead of reverting the user's edit on every launch.
      hydrateFromSupabase: async (userId) => {
        set({ syncUserId: userId });
        try {
          const remoteTasks = await fetchTasks(userId);
          await rehydrated;
          if (get().syncUserId !== userId) return;
          const { tasks, localNewer } = mergeRemoteTasks(normalizePersistedTasks(remoteTasks), get().tasks);
          set({ tasks: recalcAll(tasks) });
          localNewer.forEach((task) => syncUpsert(task, userId));
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

      handleSignOut: async () => {
        realtimeChannel?.unsubscribe();
        realtimeChannel = null;
        set({ tasks: recalcAll(initialTasks), syncUserId: null });
        await AsyncStorage.removeItem("nexdo-tasks");
      },

      addTask: (input) => {
        const now = new Date();
        const task = buildTask(input, now);
        set((state) => ({ tasks: recalcAll([task, ...state.tasks], now) }));
        syncUpsert(get().tasks.find((t) => t.id === task.id)!, get().syncUserId);
        return task.id;
      },

      updateTask: (id, changes) => {
        const now = new Date();
        set((state) => ({
          tasks: recalcAll(
            state.tasks.map((task) =>
              task.id === id ? { ...task, ...changes, updatedAt: now.toISOString() } : task,
            ),
            now,
          ),
        }));
        const updated = get().tasks.find((t) => t.id === id);
        if (updated) syncUpsert(updated, get().syncUserId);
      },

      deleteTask: (id) => {
        set((state) => ({ tasks: state.tasks.filter((task) => task.id !== id) }));
        syncDelete(id, get().syncUserId);
      },

      deleteTasks: (ids) => {
        const doomed = new Set(ids);
        set((state) => ({ tasks: state.tasks.filter((task) => !doomed.has(task.id)) }));
        ids.forEach((id) => syncDelete(id, get().syncUserId));
      },

      toggleTaskStatus: (id) => {
        const task = get().tasks.find((t) => t.id === id);
        if (!task) return;
        if (task.status === "completed") get().reopenTask(id);
        else get().completeTask(id);
      },

      completeTask: (id) => {
        const now = new Date();
        set((state) => ({
          tasks: recalcAll(
            state.tasks.map((task) =>
              task.id === id
                ? { ...task, status: "completed", completedAt: now.toISOString(), updatedAt: now.toISOString() }
                : task,
            ),
            now,
          ),
        }));
        const updated = get().tasks.find((t) => t.id === id);
        if (updated) syncUpsert(updated, get().syncUserId);
      },

      reopenTask: (id) => {
        const now = new Date();
        set((state) => ({
          tasks: recalcAll(
            state.tasks.map((task) =>
              task.id === id
                ? (() => {
                    const reopenedSubtasks = task.subtasks?.length
                      ? task.subtasks
                          .slice()
                          .sort((a, b) => a.order - b.order)
                          .map((subtask, index) => ({
                            ...subtask,
                            status: index === 0 ? ("current" as const) : ("pending" as const),
                          }))
                      : undefined;
                    const restoredMinutes = reopenedSubtasks?.length
                      ? remainingMinutes(reopenedSubtasks)
                      : Math.max(task.estimatedMinutes, 1);
                    return {
                      ...task,
                      status: "pending",
                      subtasks: reopenedSubtasks,
                      currentStepId: reopenedSubtasks?.[0]?.id,
                      estimatedMinutes: restoredMinutes,
                      completedAt: undefined,
                      updatedAt: now.toISOString(),
                    };
                  })()
                : task,
            ),
            now,
          ),
        }));
        const updated = get().tasks.find((t) => t.id === id);
        if (updated) syncUpsert(updated, get().syncUserId);
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

        set((state) => ({
          tasks: recalcAll(
            state.tasks.map((t) =>
              t.id === taskId
                ? {
                    ...t,
                    subtasks: finalSubtasks,
                    currentStepId: nextPending?.id,
                    estimatedMinutes: allDone ? 0 : remainingMinutes(finalSubtasks),
                    status: allDone ? "completed" : t.status,
                    completedAt: allDone ? now.toISOString() : t.completedAt,
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

      restoreTaskSnapshot: (taskId, snapshot) => {
        const now = new Date();
        if (snapshot === null) {
          set((state) => ({ tasks: state.tasks.filter((t) => t.id !== taskId) }));
          syncDelete(taskId, get().syncUserId);
          return;
        }
        set((state) => {
          const exists = state.tasks.some((t) => t.id === taskId);
          const tasks = exists ? state.tasks.map((t) => (t.id === taskId ? snapshot : t)) : [snapshot, ...state.tasks];
          return { tasks: recalcAll(tasks, now) };
        });
        syncUpsert(snapshot, get().syncUserId);
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
              }),
            );
            const message =
              action.drafts.length === 1
                ? copy.added(action.drafts[0].title)
                : copy.addedMany(action.drafts.length, action.drafts.map((d) => d.title).join(", "));
            return { message, taskId: ids[0], taskIds: ids };
          }
          case "UPDATE_TASK": {
            const task = get().tasks.find((t) => t.id === action.taskId);
            get().updateTask(action.taskId, action.changes);
            const updatedTask = get().tasks.find((t) => t.id === action.taskId);
            return {
              message: copy.updated(action.changes.title ?? updatedTask?.title ?? task?.title ?? copy.fallbackTask),
              taskId: action.taskId,
            };
          }
          case "COMPLETE_TASK": {
            const task = get().tasks.find((t) => t.id === action.taskId);
            get().completeTask(action.taskId);
            return { message: copy.markedDone(task?.title ?? copy.fallbackTask), taskId: action.taskId };
          }
          case "COMPLETE_TASKS": {
            const pending = tasksInScope(get().tasks, "pending");
            pending.forEach((task) => get().completeTask(task.id));
            return { message: copy.markedAllDone(describeTaskCount(pending.length, "all")) };
          }
          case "DELETE_TASK": {
            const task = get().tasks.find((t) => t.id === action.taskId);
            get().deleteTask(action.taskId);
            return { message: copy.deleted(task?.title ?? copy.fallbackTask) };
          }
          case "DELETE_TASKS": {
            const matching = action.taskIds
              ? get().tasks.filter((task) => action.taskIds?.includes(task.id))
              : tasksInScope(get().tasks, action.scope);
            get().deleteTasks(matching.map((task) => task.id));
            return { message: copy.deletedMany(describeTaskCount(matching.length, action.scope)) };
          }
          case "ADD_TASK_CONTEXT": {
            const task = get().tasks.find((t) => t.id === action.taskId);
            get().addContext(action.taskId, action.note, action.estimatedMinutes);
            return { message: copy.loggedContext(task?.title ?? copy.fallbackYourTask), taskId: action.taskId };
          }
          case "RESCHEDULE_TASK": {
            const task = get().tasks.find((t) => t.id === action.taskId);
            get().updateTask(action.taskId, { dueDate: action.newDueDate });
            return { message: copy.rescheduled(task?.title ?? copy.fallbackTask), taskId: action.taskId };
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
      partialize: (state) => ({ tasks: state.tasks }),
      // Runs with (state) on success and (undefined, error) on failure —
      // either way the local snapshot is as loaded as it will get, which is
      // what hydrateFromSupabase is waiting on.
      onRehydrateStorage: () => () => resolveRehydrated(),
      merge: (persisted, current) => {
        const persistedState = persisted as Partial<TaskStore>;
        return {
          ...current,
          ...persistedState,
          tasks: normalizePersistedTasks(persistedState.tasks ?? current.tasks),
        };
      },
    },
  ),
);
