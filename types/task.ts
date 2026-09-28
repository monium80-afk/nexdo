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

export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";

/** 0 = Sunday … 6 = Saturday, the same numbering as Date.getDay(). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * When a series repeats. Dates are local calendar days ("YYYY-MM-DD") and the
 * time is local wall-clock time, so a 9:00 task stays at 9:00 across a
 * daylight-saving change — see lib/recurrence.ts.
 */
export type RecurrenceRule = {
  frequency: RecurrenceFrequency;
  /** Every N days / weeks / months / years. At least 1. */
  interval: number;
  /** Weekly only: which days. Empty means the anchor's own weekday. */
  weekdays?: Weekday[];
  /** Monthly only: day of the month (1–31), clamped to short months. Absent means the anchor's day. */
  monthDay?: number;
  /** The first occurrence's day. Fixes the phase of "every 2 weeks" and the defaults above. */
  anchorDate: string;
  /** Local time every occurrence is due at. */
  hour: number;
  minute: number;
  /** Last day an occurrence may fall on, inclusive. */
  endDate?: string;
};

/** What each new occurrence is built from — kept apart from the occurrence's own fields, so editing just one occurrence doesn't leak into the next. */
export type SeriesTemplate = {
  title: string;
  estimatedMinutes: number;
  importance: number;
  notes?: string;
  steps?: { label: string; estimatedMinutes: number }[];
};

/**
 * Present on every occurrence of a repeating task. The series is identified by
 * seriesId; each occurrence is an ordinary task row whose id is derived from
 * seriesId + occurrenceDate, so two devices generating the same occurrence
 * write the same row instead of a duplicate.
 */
export type TaskRecurrence = {
  seriesId: string;
  /** The rule day this occurrence stands for — unchanged when the occurrence itself is moved. */
  occurrenceDate: string;
  rule: RecurrenceRule;
  template: SeriesTemplate;
  /** Set on a completed occurrence: the occurrence its completion created, so reopening can take it back. */
  nextOccurrenceId?: string;
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
  recurrence?: TaskRecurrence; // present only on occurrences of a repeating task
};
