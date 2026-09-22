import type { TaskScope } from "@/lib/taskMeta";
import type { Task, TaskComplexity, TaskPriorityLevel } from "@/types/task";

// Every "AI" function in this directory is a heuristic today, but shaped
// exactly like a real LLM call's input/output — swapping in a real backend
// later means rewriting these function bodies, not their call sites.

export type ConfirmationTier = "safe" | "immediate" | "confirm-required";

export type ExtractedTaskDraft = {
  title: string;
  estimatedMinutes: number;
  dueDate?: string;
  // True only when the user said a clock time ("at 7 p.m.") — otherwise
  // dueDate's hour is just a default and the preview shows the date alone.
  dueHasTime?: boolean;
  // Feeds `importance` in lib/scoring.ts. Without it every extracted task
  // landed on medium, which — combined with no deadline — pinned every
  // AI-created task to the same priority score.
  priorityLevel: TaskPriorityLevel;
  // Set when the message listed linked items that belong to this one task
  // (taxonomy 1.1a) — they're saved as its subtasks instead of separate tasks.
  steps?: PlanStep[];
};

export type ComplexityAnalysis = {
  complexity: TaskComplexity;
  reasoning: string;
};

export type PlanStep = { title: string; estimatedMinutes: number };

export type StructuredAction =
  | { type: "CREATE_TASK"; drafts: ExtractedTaskDraft[]; confirmationTier: "confirm-required" }
  | {
      type: "UPDATE_TASK";
      taskId: string;
      changes: Partial<Pick<Task, "title" | "dueDate" | "estimatedMinutes">>;
      confirmationTier: ConfirmationTier;
    }
  | { type: "COMPLETE_TASK"; taskId: string; confirmationTier: "immediate" }
  // "Mark all my tasks as done" — every pending task, resolved on-device.
  // Applied immediately: it's reversible with undo, unlike a bulk delete.
  | { type: "COMPLETE_TASKS"; confirmationTier: "immediate" }
  // Deletion is a direct, unambiguous command per the input taxonomy — it
  // executes immediately; ambiguity is handled by asking which task
  // (CLARIFY) rather than by a confirmation step.
  | { type: "DELETE_TASK"; taskId: string; confirmationTier: "immediate" }
  // Bulk removal ("remove all my completed tasks"). The scope is resolved
  // against the full task list on-device, and it's always confirmed first
  // since one message can wipe out every task.
  | { type: "DELETE_TASKS"; scope: TaskScope; taskIds?: string[]; confirmationTier: "confirm-required" }
  // estimatedMinutes is set alongside a note when added context changes the
  // task's scope (taxonomy 2.2) or shrinks it via partial progress (3.3).
  | { type: "ADD_TASK_CONTEXT"; taskId: string; note: string; estimatedMinutes?: number; confirmationTier: "safe" }
  | { type: "RESCHEDULE_TASK"; taskId: string; newDueDate?: string; confirmationTier: "immediate" }
  | { type: "SKIP_TASK"; taskId: string; reason: string; confirmationTier: "safe" }
  // A proposed subtask plan (taxonomy 5.1) — always confirmed before it
  // overwrites the task's existing subtasks.
  | { type: "BREAKDOWN_TASK"; taskId: string; steps: PlanStep[]; confirmationTier: "confirm-required" }
  // A time-budget statement (taxonomy 4.2) — never answered inline, always
  // routes the user to the Next page pre-loaded with this time budget.
  | { type: "REDIRECT_NEXT"; availableMinutes: number; confirmationTier: "safe" }
  | { type: "QUERY"; answer: string; confirmationTier: "safe" }
  | { type: "CLARIFY"; question: string; candidates: Task[]; confirmationTier: "safe" }
  | { type: "UNKNOWN"; reply: string; confirmationTier: "safe" };
