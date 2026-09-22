export type TaskStatus = "pending" | "completed";

export type TaskPriorityLevel = "high" | "medium" | "low";

export type TaskComplexity = "simple" | "medium" | "complex";

export type SubtaskStatus = "pending" | "current" | "completed";

// Add form's local step-builder input shape — no order/status needed until
// addTask() converts these into real Subtasks.
export type TaskStep = {
  id: string;
  label: string;
  estimatedMinutes: number;
};

// Canonical stored plan step. Exactly one pending subtask per task should be "current".
export type Subtask = {
  id: string;
  label: string;
  estimatedMinutes: number;
  order: number;
  status: SubtaskStatus;
};

export type SkipRecord = {
  reason: string;
  skippedAt: string; // ISO 8601
  suppressUntil: string; // ISO 8601 — suitabilityScore stays suppressed until this passes
};

export type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  dueDate?: string; // ISO 8601 — absent means "No deadline"
  estimatedMinutes: number; // remaining work; recomputed as subtasks complete
  createdAt: string; // ISO 8601 — drives the "Recently added" sort
  updatedAt: string; // ISO 8601 — bumped on every mutation
  notes?: string;
  subtasks?: Subtask[]; // absent/empty = no plan
  currentStepId?: string; // mirrors the one subtask with status "current"
  /** 0–100. High >=75, Medium 45–74, Low <45 — see prompt_material/01-design-system.txt */
  priorityScore: number; // fully code-computed, see lib/scoring.ts
  suitabilityScore: number; // 0–100 — "how doable is this right now"
  importance: number; // 0–100 subjective input feeding priorityScore (mocked "AI" input)
  complexity: TaskComplexity; // subjective input; gates whether a plan is generated
  aiContext: { notes: string[] }; // raw context strings accumulated over time
  skip?: SkipRecord; // present while suppressed by "show another task"
  completedAt?: string; // ISO 8601
};
