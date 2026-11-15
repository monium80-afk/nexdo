import type { ReassessRequestBody, ReassessResponseBody } from "@/app/api/reassess+api";
import { describeNow, taskToContext } from "@/lib/ai/context";
import { parseDeadlinePhrase } from "@/lib/ai/parseDate";
import { apiPost } from "@/lib/api";
import { getLanguage, translate } from "@/lib/i18n";
import type { TaskChanges } from "@/lib/taskOperations";
import type { Task } from "@/types/task";

/** What the user sent from Task Details' context box. */
export type ContextSubmission = {
  text: string;
  /** Editing an earlier note: the text it replaces. */
  replacesNote?: string;
  /** Answering the question Nexdo asked about a note that wasn't saved yet. */
  clarification?: { note: string; question: string };
};

/** A step of the proposed plan: `id` for a subtask the task already has, none for a new one. */
export type ProposedStep = { id?: string; title: string; estimatedMinutes: number };

export type ReassessmentUpdate = {
  outcome: "update";
  summary: string;
  /** Field edits, in the same shape the task operation planner takes (lib/taskOperations.ts). */
  changes: TaskChanges;
  /** The whole new list of unfinished steps, or null to keep them. */
  steps: ProposedStep[] | null;
  /** Unfinished subtasks the user says are now done. */
  stepsDone: string[];
  advice?: string;
};

export type ReassessmentProposal =
  | { outcome: "clarify"; question: string }
  | { outcome: "no_change"; summary: string }
  | ReassessmentUpdate;

// The model only ever sees "s1", "s2", … for the subtasks: shorter than the
// app's ids, and an id it invents can't match a real subtask by accident.
function stepAliases(task: Task) {
  const unfinished = (task.subtasks ?? [])
    .filter((subtask) => subtask.status !== "completed")
    .sort((a, b) => a.order - b.order);
  const toReal = new Map(unfinished.map((subtask, index) => [`s${index + 1}`, subtask.id]));
  return { unfinished, toReal };
}

/** Earlier notes the model reads: the newest 20, minus one that's being replaced. */
function earlierNotes(task: Task, replacesNote: string | undefined): string[] {
  const notes = [...task.aiContext.notes];
  const replaced = replacesNote === undefined ? -1 : notes.indexOf(replacesNote);
  if (replaced >= 0) notes.splice(replaced, 1);
  return notes.slice(-20);
}

export function buildReassessRequest(task: Task, submission: ContextSubmission, now: Date): ReassessRequestBody {
  const { unfinished } = stepAliases(task);
  const done = (task.subtasks ?? [])
    .filter((subtask) => subtask.status === "completed")
    .sort((a, b) => a.order - b.order);
  return {
    task: { ...taskToContext(task, now), contextNotes: earlierNotes(task, submission.replacesNote) },
    doneSteps: done.map((subtask) => ({ title: subtask.label, estimatedMinutes: subtask.estimatedMinutes })),
    steps: unfinished.map((subtask, index) => ({
      id: `s${index + 1}`,
      title: subtask.label,
      estimatedMinutes: subtask.estimatedMinutes,
    })),
    advice: task.aiContext.advice ?? null,
    newContext: submission.text,
    replacesNote: submission.replacesNote,
    clarification: submission.clarification,
    today: describeNow(now),
    language: getLanguage(),
  };
}

/**
 * Turns the route's answer into something the app can apply, entirely in
 * terms of this task's real ids and dates. Anything that can't be applied
 * safely as given becomes a question for the user instead of a guess: a
 * deadline phrase the app can't read, or a move of a deadline the task
 * doesn't have.
 */
export function toProposal(task: Task, response: ReassessResponseBody, now: Date): ReassessmentProposal {
  const t = translate().taskDetail.reassess;
  if (response.outcome === "clarify") return { outcome: "clarify", question: response.question ?? t.deadlineUnclear };
  if (response.outcome === "no_change") return { outcome: "no_change", summary: response.summary };

  const changes: TaskChanges = {};
  if (response.title) changes.title = response.title;
  if (response.description) changes.notes = response.description;
  if (response.priority) changes.priority = response.priority;
  if (response.estimatedMinutes !== null) changes.estimatedMinutes = response.estimatedMinutes;

  if (response.removeDeadline) {
    changes.dueDate = null;
  } else if (response.dueDatePhrase) {
    // The model's phrase is English, so it's read with English rules — the
    // same as the inbox — on the device, in the user's own time zone. A day
    // with no time keeps the time the task had (none for a date-only task),
    // and a date that reads two ways ("3/4") is asked about, not guessed.
    const deadline = parseDeadlinePhrase(response.dueDatePhrase, now);
    if (!deadline) return { outcome: "clarify", question: t.deadlineUnclear };
    changes.deadline = deadline;
    changes.keepTimeOfDay = !deadline.time;
  } else if (response.dueDateShift) {
    if (!task.dueDate) return { outcome: "clarify", question: t.deadlineUnclear };
    changes.dueShift = response.dueDateShift;
  }

  const { toReal } = stepAliases(task);
  const stepsDone = [
    ...new Set((response.stepsDone ?? []).map((alias) => toReal.get(alias)).filter((id): id is string => !!id)),
  ];
  const done = new Set(stepsDone);
  const steps = response.steps
    ? response.steps
        .map((step) => {
          const id = step.id ? toReal.get(step.id) : undefined;
          return { id, title: step.title, estimatedMinutes: step.estimatedMinutes };
        })
        // A step marked done doesn't also stay on the to-do list.
        .filter((step) => !step.id || !done.has(step.id))
    : null;

  return {
    outcome: "update",
    summary: response.summary,
    changes,
    steps,
    stepsDone,
    advice: response.advice ?? undefined,
  };
}

/** Asks the AI to reassess `task` for the new context. Throws when the AI can't be reached or its answer is unusable. */
export async function requestReassessment(
  task: Task,
  submission: ContextSubmission,
  now: Date = new Date(),
): Promise<ReassessmentProposal> {
  const response = await apiPost<ReassessResponseBody>("/api/reassess", buildReassessRequest(task, submission, now));
  if (!response || !["update", "no_change", "clarify"].includes(response.outcome)) {
    throw new Error("[reassessTask] unusable response");
  }
  return toProposal(task, response, now);
}
