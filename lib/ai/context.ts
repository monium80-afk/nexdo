import { describeRuleForAi } from "@/lib/recurrence";
import { getDueInfo } from "@/lib/taskMeta";
import type { ImportanceLevel } from "@/lib/scoring";
import { importanceLevelOf, isListed, isOverdue } from "@/lib/taskOperations";
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
  /** The importance picked for the task — what "make it high priority" changes. "critical" when the user stressed it. */
  priority?: ImportanceLevel;
  /** Pending and past its deadline. */
  overdue?: boolean;
  /** A completed task still exists: when it was finished, in words ("Completed yesterday at 3:12 PM (1 day ago)"). */
  completedLabel?: string;
  /** Set on an occurrence of a repeating task: the rule, in words. */
  repeats?: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "Wednesday, October 7, 2026, 10:00 (UTC+02:00)" — so the model knows what "today" is, for questions. */
export function describeNow(now: Date): string {
  const date = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const time = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  const offset = -now.getTimezoneOffset();
  const hours = Math.floor(Math.abs(offset) / 60).toString().padStart(2, "0");
  const minutes = (Math.abs(offset) % 60).toString().padStart(2, "0");
  return `${date}, ${time} (UTC${offset >= 0 ? "+" : "-"}${hours}:${minutes})`;
}

/** Always English: it's for the model, like the rest of the prompt. */
export function completedLabelFor(completedAt: string, now: Date): string {
  const date = new Date(completedAt);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (days === 0) return `Completed today at ${time}`;
  if (days === 1) return `Completed yesterday at ${time}`;
  const day = date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
  return `Completed ${day} at ${time} (${days} days ago)`;
}

export function taskToContext(task: Task, now: Date = new Date()): TaskContext {
  const completed = task.status === "completed";
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    // A date-only deadline goes as its day ("2026-10-15"): its dueDate is an
    // end-of-day instant, which would read as a time the user never gave.
    dueDate: task.deadline && !task.deadline.time ? task.deadline.date : task.dueDate,
    // A completed task's own label would just say "Completed" — the model
    // needs the deadline it had, so it's described as if still open.
    dueLabel: getDueInfo(completed ? { ...task, status: "pending" } : task, now).pillLabel,
    estimatedMinutes: task.estimatedMinutes,
    priorityScore: task.priorityScore,
    complexity: task.complexity,
    notes: task.notes,
    contextNotes: task.aiContext.notes,
    priority: importanceLevelOf(task.importance),
    overdue: isOverdue(task, now) || undefined,
    completedLabel: completed && task.completedAt ? completedLabelFor(task.completedAt, now) : undefined,
    repeats: task.recurrence ? `${describeRuleForAi(task.recurrence.rule)} (this is one occurrence)` : undefined,
  };
}

function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 3);
}

/** How many of the task title's longer words the message mentions. */
function titleOverlap(lowerText: string, task: Task): number {
  return significantWords(task.title).filter((word) => lowerText.includes(word)).length;
}

// Context-budgeting: pick a relevant slice of the task list to reason over
// instead of ever handing "the whole database" to the classifier. Completed
// tasks are part of that slice — "reopen the chemistry assignment I finished"
// has to be able to find it — but only after the open ones, apart from the
// ones the message actually names.
export function selectRelevantTasks(
  text: string,
  tasks: Task[],
  recentTaskIds: string[],
  currentTaskId: string | undefined,
  limit = 8,
): Task[] {
  const selected: Task[] = [];
  const seen = new Set<string>();
  // Archived tasks and skipped occurrences are put away: the AI works with
  // what's on the list (open and done), like every filter in lib/taskOperations.ts.
  tasks = tasks.filter(isListed);
  const byId = new Map(tasks.map((task) => [task.id, task]));

  const add = (task: Task | undefined) => {
    if (!task || seen.has(task.id) || selected.length >= limit) return;
    seen.add(task.id);
    selected.push(task);
  };

  add(currentTaskId ? byId.get(currentTaskId) : undefined);
  recentTaskIds.forEach((id) => add(byId.get(id)));

  // Named in the message — whole title first, then by how many of its words appear.
  const lower = text.toLowerCase();
  tasks.filter((task) => lower.includes(task.title.toLowerCase())).forEach(add);
  tasks
    .map((task) => ({ task, overlap: titleOverlap(lower, task) }))
    .filter((entry) => entry.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || (a.task.status === "pending" ? -1 : 1))
    .forEach((entry) => add(entry.task));

  // Then the open list by priority, then the most recently finished.
  [...tasks]
    .filter((task) => task.status === "pending")
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .forEach(add);
  [...tasks]
    .filter((task) => task.status === "completed")
    .sort((a, b) => Date.parse(b.completedAt ?? b.updatedAt) - Date.parse(a.completedAt ?? a.updatedAt))
    .forEach(add);

  return selected;
}
