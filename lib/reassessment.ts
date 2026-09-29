import type { ProposedStep, ReassessmentUpdate } from "@/lib/ai/reassessTask";
import { deadlineOf, sameDeadline } from "@/lib/deadline";
import { editTaskDelta, effectiveChanges, priorityLevelOf, type TaskChanges } from "@/lib/taskOperations";
import { recalcAll } from "@/lib/taskPipeline";
import type { Subtask, Task, TaskDeadline, TaskPriorityLevel } from "@/types/task";

// The second half of a reassessment (the first is lib/ai/reassessTask.ts):
// what the AI proposed, applied to the task as it is NOW and compared with
// it. Pure — no store, no network — so the store can re-run it on a newer
// version of the task if the task changes while the save is in flight.
//
// Three rules shape everything below:
// - The user's own edits win. Anything the user changed while the AI was
//   working (a ticked step, a new deadline) stays as they left it, and the
//   AI's change to that same thing is dropped.
// - Progress is never undone. A finished step stays finished and keeps its
//   place; the AI can only add to what's done.
// - The report lists what actually differs between the task before and the
//   task saved — never what the AI said it would do.

/** How the new note joins the task's notes. */
export type NoteEdit = { kind: "add"; text: string } | { kind: "replace"; previous: string; text: string };

export type SubtaskChangeSummary = {
  added: number;
  removed: number;
  completed: number;
  renamed: number;
  retimed: number;
  reordered: boolean;
};

export type ReassessmentChange =
  | { field: "title"; from: string; to: string }
  | { field: "description"; kind: "added" | "updated" | "removed" }
  | { field: "deadline"; from?: TaskDeadline; to?: TaskDeadline }
  | { field: "duration"; from: number; to: number }
  | { field: "priority"; from: TaskPriorityLevel; to: TaskPriorityLevel }
  | { field: "score"; from: number; to: number }
  | { field: "subtasks"; summary: SubtaskChangeSummary }
  | { field: "advice"; kind: "added" | "revised" };

export type ReassessmentReport = {
  /** Only real changes, in the order they're shown. Empty: the task is as it was. */
  changes: ReassessmentChange[];
  /** The task has a deadline and it stayed put — said out loud when other things changed. */
  deadlineUnchanged: boolean;
  /** The AI's one-line reason. Empty when some of its changes were left out (it would describe those too). */
  summary: string;
  /** Some of the AI's changes were left out because the user changed the same thing while it worked. */
  keptUserEdits: boolean;
};

type Proposal = ReassessmentUpdate | { outcome: "no_change"; summary: string };

const MIN_STEP_MINUTES = 5;

function byOrder(a: Subtask, b: Subtask): number {
  return a.order - b.order;
}

function sumRemaining(subtasks: Subtask[]): number {
  return subtasks.filter((subtask) => subtask.status !== "completed").reduce((sum, subtask) => sum + subtask.estimatedMinutes, 0);
}

function newSubtaskId(index: number): string {
  return `subtask-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 6)}`;
}

/** One step marked current — the first unfinished — the rest pending, and `order` matching the array. */
function withStatuses(subtasks: Subtask[]): Subtask[] {
  const firstOpen = subtasks.find((subtask) => subtask.status !== "completed")?.id;
  return subtasks.map((subtask, index) => ({
    ...subtask,
    order: index,
    status: subtask.status === "completed" ? "completed" : subtask.id === firstOpen ? "current" : "pending",
  }));
}

/**
 * Scales the unfinished steps so they add up to `target` — for an AI that gave
 * the task a new length but left its steps alone. Steps and length must agree
 * (the store keeps a task with steps at the sum of what's left), so one of
 * them has to move, and the steps are what the user can see.
 */
function scaleRemaining(subtasks: Subtask[], target: number): Subtask[] {
  const open = subtasks.filter((subtask) => subtask.status !== "completed");
  const total = sumRemaining(subtasks);
  if (open.length === 0 || total === 0 || total === target) return subtasks;
  const factor = target / total;
  const scaled = new Map(open.map((subtask) => [subtask.id, Math.max(MIN_STEP_MINUTES, Math.round(subtask.estimatedMinutes * factor))]));
  // Rounding leftovers go to the longest step, as long as it stays a real step.
  const drift = target - [...scaled.values()].reduce((sum, minutes) => sum + minutes, 0);
  const longest = open.reduce((a, b) => (scaled.get(b.id)! > scaled.get(a.id)! ? b : a));
  scaled.set(longest.id, Math.max(MIN_STEP_MINUTES, scaled.get(longest.id)! + drift));
  return subtasks.map((subtask) => (scaled.has(subtask.id) ? { ...subtask, estimatedMinutes: scaled.get(subtask.id)! } : subtask));
}

/** The field edits still worth making now: ones the user hasn't made their own since the AI was asked. */
function rebaseChanges(base: Task, current: Task, proposed: TaskChanges): { changes: TaskChanges; dropped: boolean } {
  const changes: TaskChanges = { ...proposed };
  let dropped = false;
  const drop = (...keys: (keyof TaskChanges)[]) => {
    if (keys.some((key) => changes[key] !== undefined)) dropped = true;
    keys.forEach((key) => delete changes[key]);
  };
  if (current.title !== base.title) drop("title");
  if (current.notes !== base.notes) drop("notes");
  if (!sameDeadline(deadlineOf(current), deadlineOf(base))) drop("deadline", "dueDate", "keepTimeOfDay", "dueShift");
  if (current.importance !== base.importance) drop("priority");
  if (current.estimatedMinutes !== base.estimatedMinutes) drop("estimatedMinutes");
  return { changes, dropped };
}

/**
 * The subtasks after the AI's plan, on top of the ones the task has now.
 * Returns whether anything the user did meanwhile overrode part of the plan.
 */
function mergeSubtasks(
  base: Task,
  current: Task,
  steps: ProposedStep[] | null,
  stepsDone: string[],
): { subtasks: Subtask[]; stepsChanged: boolean; dropped: boolean } {
  const ordered = (current.subtasks ?? []).slice().sort(byOrder);
  const baseById = new Map((base.subtasks ?? []).map((subtask) => [subtask.id, subtask]));
  const currentById = new Map(ordered.map((subtask) => [subtask.id, subtask]));
  let dropped = false;

  // Only steps that exist and are still open can be ticked off by the AI.
  const doneIds = new Set(stepsDone.filter((id) => currentById.has(id) && currentById.get(id)!.status !== "completed"));
  if (stepsDone.length > doneIds.size) dropped = stepsDone.some((id) => !currentById.has(id));

  /** A step the user added, renamed or re-timed since the AI was asked — theirs, not the AI's, to change. */
  const userTouched = (subtask: Subtask) => {
    const before = baseById.get(subtask.id);
    return !before || before.label !== subtask.label || before.estimatedMinutes !== subtask.estimatedMinutes;
  };

  if (steps === null) {
    // The plan stays as it is — exactly, down to which step is current —
    // apart from steps the user said they've finished.
    if (doneIds.size === 0) return { subtasks: ordered, stepsChanged: false, dropped };
    const subtasks = ordered.map((subtask) =>
      doneIds.has(subtask.id) ? { ...subtask, status: "completed" as const } : subtask,
    );
    return { subtasks: withStatuses(subtasks), stepsChanged: true, dropped };
  }

  // Finished steps first, in their own order, then the new plan — the same
  // layout AI Breakdown gives (replaceRemainingSteps in the store).
  const finished = ordered
    .filter((subtask) => subtask.status === "completed" || doneIds.has(subtask.id))
    .map((subtask) => ({ ...subtask, status: "completed" as const }));
  const finishedIds = new Set(finished.map((subtask) => subtask.id));
  const planned = new Set<string>();
  const remaining: Subtask[] = [];

  steps.forEach((step, index) => {
    if (!step.id) {
      remaining.push({
        id: newSubtaskId(index),
        label: step.title,
        estimatedMinutes: step.estimatedMinutes,
        order: 0,
        status: "pending",
      });
      return;
    }
    const existing = currentById.get(step.id);
    if (!existing) {
      dropped = true; // deleted while the AI worked — it stays deleted
      return;
    }
    if (finishedIds.has(existing.id) || planned.has(existing.id)) return;
    planned.add(existing.id);
    if (userTouched(existing)) {
      if (existing.label !== step.title || existing.estimatedMinutes !== step.estimatedMinutes) dropped = true;
      remaining.push(existing);
      return;
    }
    remaining.push({ ...existing, label: step.title, estimatedMinutes: step.estimatedMinutes });
  });

  // Open steps the plan leaves out go — unless the user added or changed them meanwhile.
  for (const subtask of ordered) {
    if (finishedIds.has(subtask.id) || planned.has(subtask.id)) continue;
    if (userTouched(subtask)) {
      if (baseById.has(subtask.id)) dropped = true;
      remaining.push(subtask);
    }
  }

  return { subtasks: withStatuses([...finished, ...remaining]), stepsChanged: true, dropped };
}

function describeSubtaskChanges(before: Subtask[], after: Subtask[]): SubtaskChangeSummary | null {
  const beforeById = new Map(before.map((subtask) => [subtask.id, subtask]));
  const afterById = new Map(after.map((subtask) => [subtask.id, subtask]));
  const summary: SubtaskChangeSummary = {
    added: after.filter((subtask) => !beforeById.has(subtask.id)).length,
    removed: before.filter((subtask) => !afterById.has(subtask.id)).length,
    completed: 0,
    renamed: 0,
    retimed: 0,
    reordered: false,
  };
  for (const next of after) {
    const previous = beforeById.get(next.id);
    if (!previous) continue;
    if (previous.status !== "completed" && next.status === "completed") summary.completed += 1;
    if (previous.label !== next.label) summary.renamed += 1;
    if (next.status !== "completed" && previous.estimatedMinutes !== next.estimatedMinutes) summary.retimed += 1;
  }
  // Only the relative order of the open steps both versions share: a step
  // being added, removed or ticked off isn't a reorder.
  const openIn = (list: Subtask[], other: Map<string, Subtask>) =>
    list
      .slice()
      .sort(byOrder)
      .filter((subtask) => subtask.status !== "completed" && other.get(subtask.id)?.status !== "completed" && other.has(subtask.id))
      .map((subtask) => subtask.id)
      .join("|");
  summary.reordered = openIn(before, afterById) !== openIn(after, beforeById);

  const changed =
    summary.added + summary.removed + summary.completed + summary.renamed + summary.retimed > 0 || summary.reordered;
  return changed ? summary : null;
}

/** Everything that differs between two versions of a task, as the user would put it. */
export function describeReassessment(before: Task, after: Task): ReassessmentChange[] {
  const changes: ReassessmentChange[] = [];
  if (before.title !== after.title) changes.push({ field: "title", from: before.title, to: after.title });
  if (before.notes !== after.notes) {
    changes.push({ field: "description", kind: !before.notes ? "added" : !after.notes ? "removed" : "updated" });
  }
  const deadlineChanged = !sameDeadline(deadlineOf(before), deadlineOf(after));
  if (deadlineChanged) changes.push({ field: "deadline", from: deadlineOf(before), to: deadlineOf(after) });
  const durationChanged = before.estimatedMinutes !== after.estimatedMinutes;
  if (durationChanged) changes.push({ field: "duration", from: before.estimatedMinutes, to: after.estimatedMinutes });
  const importanceChanged = before.importance !== after.importance;
  if (importanceChanged) {
    changes.push({ field: "priority", from: priorityLevelOf(before.importance), to: priorityLevelOf(after.importance) });
  }
  // The score is the app's own formula (lib/scoring.ts) run on the new
  // values. Reported only when an input to it changed here: saving also
  // refreshes a score that has drifted with the clock, and that isn't
  // something this note did.
  if ((deadlineChanged || durationChanged || importanceChanged) && before.priorityScore !== after.priorityScore) {
    changes.push({ field: "score", from: before.priorityScore, to: after.priorityScore });
  }
  const subtasks = describeSubtaskChanges(before.subtasks ?? [], after.subtasks ?? []);
  if (subtasks) changes.push({ field: "subtasks", summary: subtasks });
  if (before.aiContext.advice !== after.aiContext.advice && after.aiContext.advice) {
    changes.push({ field: "advice", kind: before.aiContext.advice ? "revised" : "added" });
  }
  return changes;
}

function withNote(notes: string[], note: NoteEdit): string[] {
  if (note.kind === "replace") {
    const index = notes.indexOf(note.previous);
    if (index >= 0) return notes.map((entry, entryIndex) => (entryIndex === index ? note.text : entry));
  }
  return [...notes, note.text];
}

/**
 * The task after a reassessment, and what changed. `base` is the task the AI
 * was shown; `current` is the task now, which may have moved on since.
 * Saving the result is the caller's job (useTaskStore.saveTaskNow).
 */
export function applyReassessment(params: {
  base: Task;
  current: Task;
  proposal: Proposal;
  note: NoteEdit;
  now: Date;
  allTasks: Task[];
}): { task: Task; report: ReassessmentReport } {
  const { base, current, proposal, note, now, allTasks } = params;
  let next: Task = current;
  let keptUserEdits = false;
  let summary = proposal.summary;

  if (proposal.outcome === "update") {
    // Deadline, title, description and priority go through the same editor
    // as every other change to a task (lib/taskOperations.ts) — so a
    // repeating task's occurrence behaves exactly as a hand edit of it would.
    // No scope: this occurrence only, like a note about it.
    const rebased = rebaseChanges(base, current, proposal.changes);
    keptUserEdits = rebased.dropped;
    const { estimatedMinutes: proposedMinutes, ...fieldChanges } = effectiveChanges(current, rebased.changes);
    const edited = editTaskDelta(current, fieldChanges, undefined, now, allTasks).upserts[0];
    if (edited) next = edited;

    // A finished task has no work left to re-plan: its steps and length stay
    // as they were, and only what describes it (title, deadline, advice…) can change.
    const finishedTask = current.status === "completed";
    const merged = finishedTask
      ? { subtasks: (current.subtasks ?? []).slice().sort(byOrder), stepsChanged: false, dropped: false }
      : mergeSubtasks(base, current, proposal.steps, proposal.stepsDone);
    keptUserEdits ||= merged.dropped;
    let subtasks = merged.subtasks;
    const open = subtasks.filter((subtask) => subtask.status !== "completed");

    // Length and steps have to agree: a task with steps left is as long as
    // they add up to (see remainingMinutes in the store).
    let estimatedMinutes = current.estimatedMinutes;
    if (!finishedTask) {
      if (open.length > 0 && proposedMinutes !== undefined && proposal.steps === null) {
        subtasks = scaleRemaining(subtasks, proposedMinutes);
        estimatedMinutes = sumRemaining(subtasks);
      } else if (open.length > 0 && merged.stepsChanged) {
        estimatedMinutes = sumRemaining(subtasks);
      } else if (proposedMinutes !== undefined) {
        estimatedMinutes = proposedMinutes;
      }
    }

    const advice = proposal.advice?.trim() || current.aiContext.advice;
    next = {
      ...next,
      subtasks: subtasks.length > 0 ? subtasks : undefined,
      currentStepId: subtasks.find((subtask) => subtask.status === "current")?.id,
      estimatedMinutes: Math.max(1, Math.round(estimatedMinutes)),
      aiContext: { ...current.aiContext, advice },
    };
    if (!next.aiContext.advice) delete next.aiContext.advice;
  }

  // Always strictly newer than what's there, so every device's
  // last-write-wins takes this version.
  const updatedAt = new Date(Math.max(now.getTime(), Date.parse(current.updatedAt) + 1)).toISOString();
  // Scored by the app's own formula, through the same step as every other
  // change to a task (lib/taskPipeline.ts) — the AI never sets a score.
  const [task] = recalcAll(
    [{ ...next, aiContext: { ...next.aiContext, notes: withNote(current.aiContext.notes, note) }, updatedAt }],
    now,
  );

  const changes = describeReassessment(current, task);
  if (keptUserEdits) summary = "";
  return {
    task,
    report: {
      changes,
      deadlineUnchanged: changes.length > 0 && !!deadlineOf(task) && sameDeadline(deadlineOf(task), deadlineOf(current)),
      summary,
      keptUserEdits,
    },
  };
}
