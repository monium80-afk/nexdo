import { recalcTask } from "@/lib/scoring";
import type { Task } from "@/types/task";

// The single recalculation step every store mutation funnels through — the
// spec's TASK_CREATED/UPDATED/COMPLETED/... -> recalculateTaskScore chain,
// mapped onto plain code instead of a pub/sub event bus. Ranking
// (rankTasksForNext) and "does this change the Next pick" are handled by
// screens re-deriving from the tasks array via useMemo, since Zustand gives
// every mutation a fresh array identity for free.
export function recalcAll(tasks: Task[], now: Date = new Date()): Task[] {
  return tasks.map((task) => (task.status === "pending" ? recalcTask(task, now) : task));
}
