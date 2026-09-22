import { getDueInfo } from "@/lib/taskMeta";
import type { Task } from "@/types/task";

// Trims a Task down to the fields the AI prompts actually need — keeps the
// request payload small and gives the model a stable, documented shape
// instead of the full internal Task type (scores, sync bookkeeping, etc).
export type TaskContext = {
  id: string;
  title: string;
  status: Task["status"];
  dueDate?: string;
  /** The deadline already put into words ("Due tomorrow at 6:00 PM"), so the model never does date math. */
  dueLabel: string;
  estimatedMinutes: number;
  priorityScore: number;
  complexity: Task["complexity"];
  notes?: string;
  contextNotes: string[];
};

export function taskToContext(task: Task): TaskContext {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    dueDate: task.dueDate,
    dueLabel: getDueInfo(task).pillLabel,
    estimatedMinutes: task.estimatedMinutes,
    priorityScore: task.priorityScore,
    complexity: task.complexity,
    notes: task.notes,
    contextNotes: task.aiContext.notes,
  };
}

// Context-budgeting: pick a small, relevant slice of the task list to reason
// over instead of ever handing "the whole database" to the classifier.
export function selectRelevantTasks(
  text: string,
  tasks: Task[],
  recentTaskIds: string[],
  currentTaskId: string | undefined,
  limit = 8,
): Task[] {
  const pending = tasks.filter((task) => task.status === "pending");
  const selected: Task[] = [];
  const seen = new Set<string>();

  const add = (task: Task | undefined) => {
    if (!task || seen.has(task.id)) return;
    seen.add(task.id);
    selected.push(task);
  };

  add(pending.find((task) => task.id === currentTaskId));
  recentTaskIds.forEach((id) => add(pending.find((task) => task.id === id)));

  const lower = text.toLowerCase();
  pending
    .filter((task) => lower.includes(task.title.toLowerCase()))
    .forEach((task) => add(task));

  const byPriority = [...pending].sort((a, b) => b.priorityScore - a.priorityScore);
  for (const task of byPriority) {
    if (selected.length >= limit) break;
    add(task);
  }

  return selected.slice(0, limit);
}
