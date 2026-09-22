import type { Task } from "@/types/task";

export type TaskReferenceResult =
  | { status: "resolved"; taskId: string }
  | { status: "ambiguous"; candidates: Task[] }
  | { status: "none" };

function titleMatches(text: string, task: Task): boolean {
  const lower = text.toLowerCase();
  return lower.includes(task.title.toLowerCase()) || task.title.toLowerCase().includes(lower.trim());
}

function findTitleWordOverlap(text: string, task: Task): boolean {
  const words = task.title.toLowerCase().split(/\s+/).filter((word) => word.length > 3);
  const lower = text.toLowerCase();
  return words.some((word) => lower.includes(word));
}

// Disambiguation order per spec: current task -> recently mentioned -> title
// match -> none (ask). Never silently edits a random task.
export function resolveTaskReference(
  text: string,
  ctx: { currentTaskId?: string; recentTaskIds: string[]; tasks: Task[] },
): TaskReferenceResult {
  const pending = ctx.tasks.filter((task) => task.status === "pending");

  const explicitMatches = pending.filter((task) => titleMatches(text, task));
  if (ctx.currentTaskId && (explicitMatches.length === 0 || explicitMatches.some((t) => t.id === ctx.currentTaskId))) {
    if (pending.some((task) => task.id === ctx.currentTaskId)) {
      return { status: "resolved", taskId: ctx.currentTaskId };
    }
  }

  for (const id of ctx.recentTaskIds) {
    const task = pending.find((candidate) => candidate.id === id);
    if (task && titleMatches(text, task)) return { status: "resolved", taskId: task.id };
  }

  if (explicitMatches.length === 1) return { status: "resolved", taskId: explicitMatches[0].id };
  if (explicitMatches.length > 1) return { status: "ambiguous", candidates: explicitMatches };

  const wordMatches = pending.filter((task) => findTitleWordOverlap(text, task));
  if (wordMatches.length === 1) return { status: "resolved", taskId: wordMatches[0].id };
  if (wordMatches.length > 1) return { status: "ambiguous", candidates: wordMatches };

  return { status: "none" };
}
