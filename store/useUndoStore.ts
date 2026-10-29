import { create } from "zustand";

import { useTaskStore } from "@/store/useTaskStore";
import type { Task } from "@/types/task";

type Snapshot = { taskId: string; before: Task | null };

/** How long the "Undo" toast stays up. */
export const UNDO_TOAST_MS = 5_000;

type UndoToast = {
  /** Bumped for each toast, so a newer one restarts the timer. */
  id: number;
  message: string;
  snapshots: Snapshot[];
};

type UndoStore = {
  toast: UndoToast | null;
  show: (message: string, snapshots: Snapshot[]) => void;
  /** Puts every task the action touched back as it was, and hides the toast. */
  undo: () => void;
  dismiss: () => void;
};

let nextId = 1;

/**
 * The one "Done · Undo" toast (components/UndoToast.tsx), shown after an
 * action that's easy to do by mistake: finishing a task, deleting one,
 * resetting the week. Not saved: an app restart drops it.
 */
export const useUndoStore = create<UndoStore>()((set, get) => ({
  toast: null,
  show: (message, snapshots) => {
    if (snapshots.length === 0) return;
    set({ toast: { id: nextId++, message, snapshots } });
  },
  undo: () => {
    const toast = get().toast;
    if (!toast) return;
    set({ toast: null });
    useTaskStore.getState().restoreSnapshots(toast.snapshots);
  },
  dismiss: () => set({ toast: null }),
}));

/**
 * Runs a task-store change and offers to undo it. What it touched is read off
 * the list itself — tasks added, removed, or saved again (a new updatedAt) —
 * so a repeating task's next occurrence goes away with the undo too. Scores
 * recalculated on every change don't count: they don't move updatedAt.
 */
export function withUndo(message: string, run: () => void) {
  const before = useTaskStore.getState().tasks;
  run();
  const after = useTaskStore.getState().tasks;

  const beforeById = new Map(before.map((task) => [task.id, task]));
  const afterIds = new Set(after.map((task) => task.id));
  const snapshots: Snapshot[] = [];
  for (const task of after) {
    const previous = beforeById.get(task.id);
    if (!previous) snapshots.push({ taskId: task.id, before: null });
    else if (previous.updatedAt !== task.updatedAt || previous.status !== task.status) {
      snapshots.push({ taskId: task.id, before: previous });
    }
  }
  for (const task of before) {
    if (!afterIds.has(task.id)) snapshots.push({ taskId: task.id, before: task });
  }
  useUndoStore.getState().show(message, snapshots);
}
