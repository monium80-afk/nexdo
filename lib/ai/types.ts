import type { RuleInput } from "@/lib/recurrence";
import type { TaskFilter, TaskOperation } from "@/lib/taskOperations";
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
  // "gym every Monday at 7" — saved as the first occurrence of a series.
  recurrence?: RuleInput;
};

export type ComplexityAnalysis = {
  complexity: TaskComplexity;
  reasoning: string;
};

export type PlanStep = { title: string; estimatedMinutes: number };

export type StructuredAction =
  | { type: "CREATE_TASK"; drafts: ExtractedTaskDraft[]; confirmationTier: "confirm-required" }
  // Every change to tasks that already exist — one task or many, edit,
  // complete, reopen or delete — as one validated operation (see
  // lib/taskOperations.ts). Which tasks it reaches is resolved on-device
  // against the whole list, and the chat decides whether to ask first from
  // how many that is (see useChatStore): a wrong model output can never skip
  // a confirmation a bulk change needs.
  | { type: "OPERATE"; operation: TaskOperation; confirmationTier: ConfirmationTier }
  // "Show me what I finished this week" — listed by the app from the full
  // list, so it isn't limited to the tasks the model was shown.
  | { type: "LIST_TASKS"; filter: TaskFilter; confirmationTier: "safe" }
  // estimatedMinutes is set alongside a note when added context changes the
  // task's scope (taxonomy 2.2) or shrinks it via partial progress (3.3).
  | { type: "ADD_TASK_CONTEXT"; taskId: string; note: string; estimatedMinutes?: number; confirmationTier: "safe" }
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
