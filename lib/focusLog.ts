import { useFocusLogStore } from "@/store/useFocusLogStore";
import { useTaskStore } from "@/store/useTaskStore";
import type { Task } from "@/types/task";

/** Shorter than this, a session was opened and closed again — nothing to learn from. */
const MIN_FOCUSED_MS = 60_000;
/** A clock left running for hours says nothing about the task: it's capped. */
const MAX_FOCUSED_MINUTES = 240;

/**
 * Saves a focus session that just ended to the focus log (Insights, your
 * pace). Called by the session store whenever a session ends, however it
 * ends: finished, cancelled, or replaced by another. Sessions on a task with
 * no duration have no clock, so they aren't saved.
 */
export function logEndedSession(session: {
  taskId: string | undefined;
  plannedMinutes: number;
  estimateMinutes: number;
  startedAt: number;
  elapsedMs: number;
  endedAt: number;
}): void {
  try {
    if (!session.taskId || session.plannedMinutes <= 0 || session.elapsedMs < MIN_FOCUSED_MS) return;
    const { tasks, syncUserId } = useTaskStore.getState();
    const task = tasks.find((entry) => entry.id === session.taskId);
    useFocusLogStore.getState().add({
      id: `focus-${session.endedAt.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      userId: syncUserId,
      taskId: session.taskId,
      startedAt: new Date(session.startedAt).toISOString(),
      endedAt: new Date(session.endedAt).toISOString(),
      focusedMinutes: Math.min(MAX_FOCUSED_MINUTES, Math.round(session.elapsedMs / 6000) / 10),
      estimateMinutes: session.estimateMinutes,
      completed: task?.status === "completed",
    });
  } catch (error) {
    // Never allowed to get in the way of ending a session.
    console.warn("[focusLog] couldn't save the session", error);
  }
}

let watching = false;

/**
 * Notes every task finished — and takes it back when it's reopened — from
 * then on, whichever way it was done (a card, a session, Magic mic). Only a
 * change seen here counts: tasks arriving already done (signing in, another
 * phone) aren't new completions. Started once, at the root of the app.
 */
export function watchCompletions(): void {
  if (watching) return;
  watching = true;
  useTaskStore.subscribe((state, previous) => {
    if (state.tasks === previous.tasks) return;
    try {
      const before = new Map<string, Task>(previous.tasks.map((task) => [task.id, task]));
      const log = useFocusLogStore.getState();
      for (const task of state.tasks) {
        const old = before.get(task.id);
        if (!old || old.status === task.status) continue;
        if (task.status === "completed") {
          log.addCompletion({ taskId: task.id, userId: state.syncUserId, at: task.completedAt ?? new Date().toISOString() });
        } else if (old.status === "completed") {
          log.removeCompletion(task.id);
        }
      }
    } catch (error) {
      console.warn("[focusLog] couldn't note a completion", error);
    }
  });
}
