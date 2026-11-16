import { analyzeTaskComplexity } from "@/lib/ai/analyzeComplexity";
import { isUntouchedTemplatePlan } from "@/lib/ai/generatePlan";
import { deadlineFromDate, makeDeadline, reconcileDeadline, withDeadline, type DeadlineInput } from "@/lib/deadline";
import { buildRule, startSeries, type RuleInput } from "@/lib/recurrence";
import { PRIORITY_LEVEL_IMPORTANCE, recalcTask, type ImportanceLevel } from "@/lib/scoring";
import type { Subtask, Task, TaskDeadline, TaskStep } from "@/types/task";

// The task model, apart from the store that holds the list (split out of
// store/useTaskStore.ts, review 2026-11-13): making a new task from what the
// user or the AI gave, reading old saved shapes, and merging the account's
// copy with the phone's. Plain functions — no state, no sync.

export type NewTaskInput = {
  /**
   * An id to create the task under — given for a task made from an AI
   * preview card (derived from its candidate id), so adding the same card
   * twice lands on the same task instead of a duplicate.
   */
  id?: string;
  title: string;
  estimatedMinutes: number;
  /** The deadline: a day, plus a time only if the user gave one. Preferred over `dueDate`. */
  deadline?: DeadlineInput;
  /** A deadline as an ISO instant (an AI draft, onboarding) — exact unless `dueHasTime` is false. */
  dueDate?: string;
  /** With `dueDate`: false when no clock time was given, so only its day is kept. */
  dueHasTime?: boolean;
  /** The picker's three levels, or "critical" read off the user's own words. */
  priorityLevel: ImportanceLevel;
  notes?: string;
  steps?: TaskStep[];
  /** Makes the new task the first occurrence of a repeating series. */
  recurrence?: RuleInput;
};

function createTaskId(): string {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The task id an AI preview card creates — the same one however many times it's added. */
export function taskIdForCandidate(candidateId: string): string {
  return `task-${candidateId}`;
}

/** The deadline a new task starts with — never one the user didn't give. */
function initialDeadline(input: NewTaskInput): TaskDeadline | undefined {
  if (input.deadline) return makeDeadline(input.deadline);
  if (!input.dueDate) return undefined;
  const due = new Date(input.dueDate);
  return deadlineFromDate(due, input.dueHasTime ?? true);
}

/** How long a caller waits for the database before saying a new task isn't saved yet. */

function stepsToSubtasks(steps: TaskStep[]): Subtask[] {
  return steps.map((step, index) => ({
    id: step.id,
    label: step.label,
    estimatedMinutes: step.estimatedMinutes,
    order: index,
    status: index === 0 ? "current" : "pending",
  }));
}

/**
 * Exported so onboarding can build a task without saving one: it has drafts to
 * rank and explain before the user has an account to hang them on, and running
 * them through anything other than this would score and rank them differently
 * from how the app actually will.
 */
export function buildTask(input: NewTaskInput, now: Date): Task {
  const complexity = analyzeTaskComplexity({
    title: input.title,
    estimatedMinutes: input.estimatedMinutes,
    subtaskCount: input.steps?.length,
  }).complexity;

  // Only real steps: ones the user or the AI gave this task. A task without any
  // stays without, rather than getting a generic plan, so a session shows a
  // checklist only when there is something real to tick off. AI Breakdown is
  // there for everything else.
  const subtasks = input.steps && input.steps.length > 0 ? stepsToSubtasks(input.steps) : undefined;

  const nowIso = now.toISOString();
  const base: Task = {
    id: input.id ?? createTaskId(),
    title: input.title.trim(),
    status: "pending",
    estimatedMinutes: input.estimatedMinutes,
    createdAt: nowIso,
    updatedAt: nowIso,
    notes: input.notes?.trim() || undefined,
    subtasks,
    currentStepId: subtasks?.find((subtask) => subtask.status === "current")?.id,
    priorityScore: 0,
    suitabilityScore: 0,
    importance: PRIORITY_LEVEL_IMPORTANCE[input.priorityLevel],
    complexity,
    aiContext: { notes: [] },
  };
  const task = withDeadline(base, initialDeadline(input));
  // A repeating task's first occurrence sits on the rule's first day (a task
  // due Wednesday that repeats on Mondays is due next Monday).
  const rule = input.recurrence ? buildRule(input.recurrence, task.deadline, now) : null;
  return recalcTask(rule ? startSeries(task, rule) : task, now);
}

export function remainingMinutes(subtasks: Subtask[]): number {
  return subtasks.filter((subtask) => subtask.status !== "completed").reduce((sum, s) => sum + s.estimatedMinutes, 0);
}

// The picker's High and Low were 75 and 25 until 2026-09-30, when the scale
// widened to 80 / 50 / 20 (lib/scoring.ts). Those exact old values are read
// as today's, so a task saved then scores like one picked now; anything else
// (a critical 100, a value in between) is kept as it is.
const LEGACY_IMPORTANCE: Record<number, number> = {
  75: PRIORITY_LEVEL_IMPORTANCE.high,
  25: PRIORITY_LEVEL_IMPORTANCE.low,
};

function currentImportance(importance: number): number {
  return LEGACY_IMPORTANCE[importance] ?? importance;
}

export function normalizePersistedTasks(tasks: Task[]): Task[] {
  return tasks.map((task) => {
    // Tasks saved before buildTask stopped adding a generic plan still carry
    // one. If nobody has ticked or edited it, it was never the user's plan, so
    // it goes, and the task shows no steps until it gets real ones.
    const ownSubtasks = task.subtasks && !isUntouchedTemplatePlan(task.subtasks) ? task.subtasks : undefined;
    const orderedSubtasks = ownSubtasks?.slice().sort((a, b) => a.order - b.order);
    const currentIndex = orderedSubtasks?.findIndex(
      (subtask) => subtask.id === task.currentStepId && subtask.status !== "completed",
    ) ?? -1;
    const nextIndex = currentIndex >= 0
      ? currentIndex
      : (orderedSubtasks?.findIndex((subtask) => subtask.status !== "completed") ?? -1);
    const subtasks = orderedSubtasks?.map((subtask, index) => ({
        ...subtask,
        status:
          subtask.status === "completed"
            ? ("completed" as const)
            : index === nextIndex
              ? ("current" as const)
              : ("pending" as const),
      }));
    const currentStepId = subtasks?.find((subtask) => subtask.status === "current")?.id;

    const advice = task.aiContext?.advice;
    const recurrence = task.recurrence?.template
      ? { ...task.recurrence, template: { ...task.recurrence.template, importance: currentImportance(task.recurrence.template.importance) } }
      : task.recurrence;
    // `deadline` is the source of truth; a task saved before date-only
    // deadlines existed has only `dueDate`, and keeps it as an exact one.
    return reconcileDeadline({
      ...task,
      importance: currentImportance(task.importance),
      recurrence,
      // Treat tasks saved with the removed archive status as open tasks.
      status: task.status === "archived" ? "pending" : TASK_STATUSES.includes(task.status) ? task.status : "pending",
      aiContext: {
        notes: Array.isArray(task.aiContext?.notes) ? task.aiContext.notes : [],
        ...(typeof advice === "string" && advice ? { advice } : {}),
      },
      subtasks,
      currentStepId,
    });
  });
}

const TASK_STATUSES: Task["status"][] = ["pending", "completed", "skipped"];

/**
 * A row read back from a database that doesn't have the newer columns yet
 * (supabase/schema.sql not re-run) comes back without them. What the phone
 * already knows about the same version of the task is kept rather than lost:
 * the deadline's date-only-ness (its dueDate is unchanged, so nothing moved
 * it), and — for the very same version — its reminder, pin and archive details.
 */
export function keepLocalOnlyFields(remote: Task, local: Task | undefined): Task {
  if (!local) return remote;
  let merged = remote;
  if (!remote.deadline && local.deadline && remote.dueDate && remote.dueDate === local.dueDate) {
    merged = { ...merged, deadline: local.deadline };
  }
  if (remote.updatedAt === local.updatedAt) {
    if (!remote.reminders && local.reminders) merged = { ...merged, reminders: local.reminders };
    if (!remote.pinnedAt && local.pinnedAt) merged = { ...merged, pinnedAt: local.pinnedAt };
    if (!remote.closedAt && local.closedAt) merged = { ...merged, closedAt: local.closedAt };
  }
  return merged;
}

/**
 * Per-task last-write-wins — the same rule the realtime handler uses. A local
 * edit whose background write never reached Supabase (offline, the app closed
 * mid-request, a row the database rejected) must not be undone by the stale
 * row it left behind. A task only this phone has is kept if it never reached
 * Supabase; one that did and is gone now was deleted on another device, and
 * stays deleted. `toPush` is every local version Supabase is behind on.
 *
 * `fetchStartedAt`: a task changed on this phone after the fetch was sent may
 * have been saved too late for it — no longer unsynced, yet missing from the
 * rows that came back. It's kept (and sent again) rather than taken for
 * deleted.
 */
export function mergeRemoteTasks(
  remote: Task[],
  local: Task[],
  unsynced: Record<string, string>,
  fetchStartedAt = Number.POSITIVE_INFINITY,
): { tasks: Task[]; toPush: Task[] } {
  const localById = new Map(local.map((task) => [task.id, task]));
  const remoteIds = new Set(remote.map((task) => task.id));
  const toPush: Task[] = [];

  const tasks = remote.map((remoteTask) => {
    const localTask = localById.get(remoteTask.id);
    if (localTask && Date.parse(localTask.updatedAt) > Date.parse(remoteTask.updatedAt)) {
      toPush.push(localTask);
      return localTask;
    }
    return keepLocalOnlyFields(remoteTask, localTask);
  });

  const neverSaved = local.filter(
    (task) => !remoteIds.has(task.id) && (task.id in unsynced || Date.parse(task.updatedAt) >= fetchStartedAt),
  );
  toPush.push(...neverSaved);
  return { tasks: [...neverSaved, ...tasks], toPush };
}
