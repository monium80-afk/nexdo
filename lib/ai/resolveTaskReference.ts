import type { Task } from "@/types/task";

export type TaskReferenceResult =
  | { status: "resolved"; taskId: string }
  | { status: "ambiguous"; candidates: Task[] }
  | { status: "none" };

function words(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function containsWords(text: string, phrase: string): boolean {
  const textWords = words(text);
  const phraseWords = words(phrase);
  return phraseWords.length > 0 && textWords.some((_, index) =>
    phraseWords.every((word, offset) => textWords[index + offset] === word),
  );
}

function titleMatches(text: string, task: Task): boolean {
  return containsWords(text, task.title) || containsWords(task.title, text);
}

function findTitleWordOverlap(text: string, task: Task): boolean {
  const messageWords = new Set(words(text));
  return words(task.title).some((word) => word.length > 3 && messageWords.has(word));
}

/**
 * Which tasks a reference may point at. Open tasks by default ("mark the
 * dentist done" means an open one); a delete or a reschedule may name a
 * finished task too, and "reopen" can only mean one. A completed task still
 * exists — it's only left out where it can't be what was meant.
 */
export type ReferenceOptions = { includeCompleted?: boolean; onlyCompleted?: boolean };

// Disambiguation order per spec: current task -> recently mentioned -> title
// match -> none (ask). Never silently edits a random task. With completed
// tasks allowed, an open task that matches as well still wins.
export function resolveTaskReference(
  text: string,
  ctx: { currentTaskId?: string; recentTaskIds: string[]; tasks: Task[] },
  options: ReferenceOptions = {},
): TaskReferenceResult {
  const candidates = ctx.tasks.filter((task) =>
    options.onlyCompleted ? task.status === "completed" : options.includeCompleted || task.status === "pending",
  );
  const preferOpen = (matches: Task[]) => {
    const open = matches.filter((task) => task.status === "pending");
    return options.includeCompleted && open.length > 0 ? open : matches;
  };

  const explicitMatches = preferOpen(candidates.filter((task) => titleMatches(text, task)));
  if (ctx.currentTaskId && explicitMatches.some((task) => task.id === ctx.currentTaskId)) {
    if (candidates.some((task) => task.id === ctx.currentTaskId)) {
      return { status: "resolved", taskId: ctx.currentTaskId };
    }
  }

  if (explicitMatches.length === 1) return { status: "resolved", taskId: explicitMatches[0].id };

  for (const id of ctx.recentTaskIds) {
    const task = explicitMatches.find((candidate) => candidate.id === id);
    if (task) return { status: "resolved", taskId: task.id };
  }

  if (explicitMatches.length > 1) return { status: "ambiguous", candidates: explicitMatches };

  if (ctx.currentTaskId && candidates.some((task) => task.id === ctx.currentTaskId)) {
    return { status: "resolved", taskId: ctx.currentTaskId };
  }

  for (const id of ctx.recentTaskIds) {
    const task = candidates.find((candidate) => candidate.id === id);
    if (task && titleMatches(text, task)) return { status: "resolved", taskId: task.id };
  }

  const wordMatches = preferOpen(candidates.filter((task) => findTitleWordOverlap(text, task)));
  if (wordMatches.length === 1) return { status: "resolved", taskId: wordMatches[0].id };
  if (wordMatches.length > 1) return { status: "ambiguous", candidates: wordMatches };

  return { status: "none" };
}
