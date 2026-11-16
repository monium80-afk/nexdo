import type { ShownTask } from "@/lib/liveVoice";
import { isListed } from "@/lib/taskOperations";
import type { Task } from "@/types/task";

// What Magic mic has done so far, read off the task list itself: the list as
// it was when the mic opened (the baseline) against the list now. Magic mic
// saves each change as it's said (lib/liveVoiceTools.ts), so this is all the
// overlay needs to show its cards and selectively undo those writes on Discard.

/** "shown": named by the user, not changed (yet). */
export type MicMark = "added" | "updated" | "completed" | "removed" | "shown";
export type MicChange = { task: Task; mark: MicMark };
export type MicFieldWrite = { before: unknown; lastWritten: unknown; conflicted: boolean };
export type MicTaskWrite = {
  before: Task | null;
  lastWritten: Task | null;
  fields: ReadonlyMap<string, MicFieldWrite>;
  conflicted: boolean;
};
export type MicDiscardSnapshot = { taskId: string; before: Task | null; micWrite: MicTaskWrite };

/** A task's steps as they read, so a fresh copy of the same steps isn't a change. */
function stepsKey(task: Task): string {
  return JSON.stringify(
    (task.subtasks ?? []).map((step) => [step.id, step.label, step.status, step.estimatedMinutes, step.order]),
  );
}

/**
 * Saved again, ticked or unticked, or its steps changed. Scores are worked out
 * again for every task on each change, so a new object alone means nothing —
 * and neither does the same moment written another way ("…Z" here, "+00:00"
 * from the database) or the same steps in a new array (a re-read of the
 * account's tasks rebuilds both).
 */
function hasChanged(before: Task, after: Task): boolean {
  return (
    before.status !== after.status ||
    Date.parse(before.updatedAt) !== Date.parse(after.updatedAt) ||
    (before.subtasks !== after.subtasks && stepsKey(before) !== stepsKey(after))
  );
}

export function sameTaskField(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function sameTaskSnapshot(left: Task, right: Task): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (!sameTaskField(left[key as keyof Task], right[key as keyof Task])) return false;
  }
  return true;
}

/** The ids of tasks added, removed or changed from one version of the list to the next. */
export function changedTaskIds(before: readonly Task[], after: readonly Task[]): string[] {
  const previous = new Map(before.map((task) => [task.id, task]));
  const ids: string[] = [];
  for (const task of after) {
    const old = previous.get(task.id);
    if (!old || hasChanged(old, task)) ids.push(task.id);
    previous.delete(task.id);
  }
  return [...ids, ...previous.keys()];
}

/**
 * One card per task Magic mic has touched, the latest change on top
 * (`changedAt`: when each task last changed, ms). A removed task keeps its
 * card, drawn as it was, so it's clear what went. Something added and then
 * removed again, or a change undone, simply has no card.
 *
 * `touched`: the tasks the mic itself changed (lib/liveVoice.ts). Only those
 * get cards — anything else that moved meanwhile (a background re-read of the
 * account, an edit on another device) wasn't said, so it isn't shown.
 *
 * `shown`: tasks the user only named (show_task) — each gets a card as it is,
 * marked "shown", unless it has a change card already.
 */
export function micChanges(
  baseline: ReadonlyMap<string, Task>,
  tasks: readonly Task[],
  changedAt: ReadonlyMap<string, number>,
  touched: readonly string[],
  shown: readonly ShownTask[] = [],
): MicChange[] {
  const mine = new Set(touched);
  const changes: MicChange[] = [];
  const present = new Set<string>();
  for (const task of tasks) {
    present.add(task.id);
    if (!mine.has(task.id)) continue;
    const before = baseline.get(task.id);
    if (!before) {
      if (isListed(task)) changes.push({ task, mark: "added" });
    } else if (!hasChanged(before, task)) {
      continue;
    } else if (isListed(before) && !isListed(task)) {
      // Skipped or archived: gone from the list, like a delete.
      changes.push({ task: before, mark: "removed" });
    } else if (task.status === "completed" && before.status !== "completed") {
      changes.push({ task, mark: "completed" });
    } else if (isListed(task)) {
      changes.push({ task, mark: "updated" });
    }
  }
  for (const [id, before] of baseline) {
    if (mine.has(id) && !present.has(id) && isListed(before)) changes.push({ task: before, mark: "removed" });
  }
  // Named but not (or not yet) changed: the task as it is, so it can be seen
  // before it's changed. A change to it says more, so that card wins.
  const carded = new Set(changes.map((change) => change.task.id));
  const shownAt = new Map(shown.map((entry) => [entry.taskId, entry.at]));
  for (const { taskId } of shown) {
    if (carded.has(taskId)) continue;
    const task = tasks.find((entry) => entry.id === taskId);
    if (task) changes.push({ task, mark: "shown" });
  }
  // Latest on top, whether it was changed or named last.
  const latest = (id: string) => Math.max(changedAt.get(id) ?? 0, shownAt.get(id) ?? 0);
  return changes.sort((a, b) => latest(b.task.id) - latest(a.task.id));
}

/**
 * The mic's original value and latest write per touched task. Discard uses
 * these to undo only fields still holding the mic's last value.
 */
export function discardSnapshots(
  tasks: readonly Task[],
  touched: readonly string[],
  micWrites: ReadonlyMap<string, MicTaskWrite>,
): MicDiscardSnapshot[] {
  const mine = new Set(touched);
  const snapshots: MicDiscardSnapshot[] = [];
  const current = new Map(tasks.map((task) => [task.id, task]));
  for (const id of mine) {
    const micWrite = micWrites.get(id);
    if (!micWrite || micWrite.conflicted) continue;
    const task = current.get(id);
    if (micWrite.before === null) {
      if (task && micWrite.lastWritten && sameTaskSnapshot(task, micWrite.lastWritten)) {
        snapshots.push({ taskId: id, before: null, micWrite });
      }
    } else if (micWrite.lastWritten === null) {
      if (!task) snapshots.push({ taskId: id, before: micWrite.before, micWrite });
    } else if (task) {
      const fields = new Map(
        [...micWrite.fields].filter(
          ([field, write]) =>
            !write.conflicted && sameTaskField(task[field as keyof Task], write.lastWritten),
        ),
      );
      if (fields.size > 0) {
        snapshots.push({ taskId: id, before: micWrite.before, micWrite: { ...micWrite, fields } });
      }
    }
  }
  return snapshots;
}
