import { formatDeadline } from "@/lib/deadline";
import type { Translations } from "@/lib/i18n";
import { describeRule } from "@/lib/recurrence";
import type { OperationPlan, TaskOperation, TaskOutcome } from "@/lib/taskOperations";
import type { Task, TaskDeadline } from "@/types/task";

// What the assistant says about a task operation — written by the app from
// the plan that was actually carried out (lib/taskOperations.ts), so a reply
// can never claim a change that didn't happen, or miscount a bulk one. The
// copy itself is in the translations (t.ops).

const PREVIEW_TITLES = 3;
const LIST_LIMIT = 15;

export function formatWhen(iso: string, t: Translations): string {
  return new Date(iso).toLocaleString(t.locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "Chemistry", "Chemistry and Gym", "Chemistry, Gym, Essay and 4 more". */
export function previewTitles(titles: string[], t: Translations): string {
  const quoted = titles.map((title) => t.ops.quote(title));
  if (quoted.length <= PREVIEW_TITLES) return t.ops.joinList(quoted);
  return t.ops.andMore(quoted.slice(0, PREVIEW_TITLES).join(", "), quoted.length - PREVIEW_TITLES);
}

/** A deadline in a reply: its day, and its time only if it has one. */
function when(deadline: TaskDeadline | undefined, iso: string | undefined, t: Translations): string | undefined {
  if (deadline) return formatDeadline(deadline, t.locale);
  return iso ? formatWhen(iso, t) : undefined;
}

function nextPart(outcome: TaskOutcome, t: Translations): string {
  if (!outcome.recurring) return "";
  const next = when(outcome.next?.deadline, outcome.next?.dueDate, t);
  return next ? ` ${t.ops.nextOccurrence(next)}` : ` ${t.ops.seriesEnded}`;
}

function single(operation: TaskOperation, outcome: TaskOutcome, t: Translations): string {
  const { title } = outcome;
  if (outcome.outcome === "unchanged") {
    switch (outcome.reason) {
      case "already-completed":
        return t.ops.alreadyDone(title);
      case "already-open":
        return t.ops.alreadyOpen(title);
      case "no-deadline":
        return t.ops.noDeadlineToMove(title);
      case "invalid-change":
        return t.ops.invalidChange(title);
      default:
        return t.ops.nothingChanged(title);
    }
  }
  switch (outcome.outcome) {
    case "completed":
      return `${t.assistant.markedDone(title)}${nextPart(outcome, t)}`;
    case "reopened":
      return t.ops.reopened(title);
    case "skipped":
      return t.ops.skippedOccurrence(title, when(outcome.next?.deadline, outcome.next?.dueDate, t));
    case "archived":
      return t.ops.archived(title);
    case "restored":
      return t.ops.restored(title);
    case "deleted":
      if (operation.kind === "delete" && operation.scope === "series" && outcome.recurring) {
        return t.ops.deletedSeries(title, outcome.removedCount ?? 1);
      }
      if (operation.kind === "delete" && operation.scope === "future" && outcome.recurring) return t.ops.endedSeries(title);
      return t.assistant.deleted(title);
    case "updated": {
      const base = outcome.wasCompleted ? t.ops.updatedCompleted(title) : t.assistant.updated(title);
      const due = when(outcome.newDeadline, outcome.newDueDate, t);
      return due ? `${base} ${t.ops.nowDue(due)}` : base;
    }
  }
}

/**
 * The reply for a finished operation. `tasksAfter` is the list once it was
 * applied, used to describe a series' new rule.
 */
export function describeOperationResult(
  operation: TaskOperation,
  plan: OperationPlan,
  t: Translations,
  tasksAfter: Task[] = [],
): string {
  const { outcomes } = plan;
  if (outcomes.length === 0) return plan.missingIds.length > 0 ? t.ops.notFound : t.ops.nothingMatched;

  let message: string;
  if (outcomes.length === 1) {
    message = single(operation, outcomes[0], t);
    // Starting or changing a repeat says what the rule now is.
    if (operation.kind === "update" && operation.changes.recurrence !== undefined && outcomes[0].outcome === "updated") {
      const task = tasksAfter.find((candidate) => candidate.id === outcomes[0].taskId);
      message =
        operation.changes.recurrence === null
          ? t.ops.stoppedRepeating(outcomes[0].title)
          : task?.recurrence
            ? `${t.ops.nowRepeats(outcomes[0].title, describeRule(task.recurrence.rule, t))} ${t.ops.nowDue(when(task.deadline, task.dueDate, t) ?? "")}`
            : message;
    }
  } else {
    const count = (kind: TaskOutcome["outcome"]) => outcomes.filter((outcome) => outcome.outcome === kind).length;
    const parts: string[] = [];
    const completed = count("completed");
    const reopened = count("reopened");
    const updated = count("updated");
    const deleted = count("deleted") + count("skipped");
    if (completed) parts.push(t.ops.completedMany(completed));
    if (reopened) parts.push(t.ops.reopenedMany(reopened));
    if (updated) {
      const shift = operation.kind === "update" ? operation.changes.dueShift : undefined;
      parts.push(shift ? t.ops.shiftedMany(updated, shift.amount, shift.unit) : t.ops.updatedMany(updated));
      const stillCompleted = outcomes.filter((outcome) => outcome.outcome === "updated" && outcome.wasCompleted).length;
      if (stillCompleted) parts.push(t.ops.someStillCompleted(stillCompleted));
    }
    if (deleted) parts.push(t.ops.deletedMany(deleted));
    const noDeadline = outcomes.filter((outcome) => outcome.reason === "no-deadline").length;
    if (noDeadline) parts.push(t.ops.noDeadlineSkipped(noDeadline));
    const alreadyDone = outcomes.filter((outcome) => outcome.reason === "already-completed").length;
    if (alreadyDone) parts.push(t.ops.alreadyDoneMany(alreadyDone));
    const alreadyOpen = outcomes.filter((outcome) => outcome.reason === "already-open").length;
    if (alreadyOpen) parts.push(t.ops.alreadyOpenMany(alreadyOpen));
    message = parts.length > 0 ? parts.join(" ") : t.ops.nothingChangedMany;
  }
  if (plan.missingIds.length > 0) message = `${message} ${t.ops.someNotFound(plan.missingIds.length)}`;
  return message;
}

/**
 * The question asked before a change that reaches several tasks, or a whole
 * series. `repeatingDefaulted`: the request didn't say how its repeating tasks
 * should be treated, so the app's default (bulkRecurrenceScope) is spelled out.
 */
export function describeConfirmation(
  operation: TaskOperation,
  targets: Task[],
  t: Translations,
  repeatingDefaulted = false,
): string {
  const titles = previewTitles(
    targets.map((task) => task.title),
    t,
  );
  switch (operation.kind) {
    case "complete":
      return t.ops.confirmComplete(targets.length, titles);
    case "reopen":
      return t.ops.confirmReopen(targets.length, titles);
    case "delete": {
      if (operation.scope === "series" && targets.length === 1) return t.ops.confirmDeleteSeries(targets[0].title);
      const question = t.ops.confirmDelete(targets.length, titles, targets.some((task) => task.status === "completed"));
      return repeatingDefaulted ? `${question} ${t.ops.repeatingDeleteNote}` : question;
    }
    case "update": {
      const shift = operation.changes.dueShift;
      const question = shift
        ? t.ops.confirmShift(targets.length, titles, shift.amount, shift.unit)
        : t.ops.confirmUpdate(targets.length, titles);
      return repeatingDefaulted ? `${question} ${t.ops.repeatingUpdateNote}` : question;
    }
    // Archiving and restoring come from Task Details, one task at a time — never asked about.
    case "archive":
    case "restore":
      return t.ops.confirmUpdate(targets.length, titles);
  }
}

/** Asked when a repeating task is edited or deleted and the request didn't say how far that should reach. */
export function describeScopeQuestion(operation: TaskOperation, targets: Task[], t: Translations): string {
  const repeating = targets.filter((task) => task.recurrence && task.status === "pending");
  if (targets.length === 1 && repeating.length === 1) {
    const task = repeating[0];
    const rule = describeRule(task.recurrence!.rule, t);
    return operation.kind === "delete" ? t.ops.askDeleteScope(task.title, rule) : t.ops.askEditScope(task.title, rule);
  }
  return operation.kind === "delete" ? t.ops.askDeleteScopeMany(repeating.length) : t.ops.askEditScopeMany(repeating.length);
}

/** A read-only listing, from the whole list — not just the tasks the model was shown. */
export function describeTaskList(tasks: Task[], t: Translations, now: Date): string {
  if (tasks.length === 0) return t.ops.listEmpty;
  const sorted = [...tasks].sort((a, b) => {
    const aTime = Date.parse(a.completedAt ?? a.dueDate ?? a.createdAt);
    const bTime = Date.parse(b.completedAt ?? b.dueDate ?? b.createdAt);
    return a.status === "completed" && b.status === "completed" ? bTime - aTime : aTime - bTime;
  });
  const lines = sorted.slice(0, LIST_LIMIT).map((task) => {
    const detail =
      task.status === "completed" && task.completedAt
        ? t.ops.completedOn(formatWhen(task.completedAt, t))
        : task.dueDate
          ? Date.parse(task.dueDate) < now.getTime()
            ? t.ops.overdueSince(when(task.deadline, task.dueDate, t)!)
            : t.ops.dueOn(when(task.deadline, task.dueDate, t)!)
          : t.due.noDeadline;
    const repeat = task.recurrence ? ` · ${describeRule(task.recurrence.rule, t)}` : "";
    return `• ${task.title} — ${detail}${repeat}`;
  });
  const more = tasks.length > LIST_LIMIT ? `\n${t.ops.listMore(tasks.length - LIST_LIMIT)}` : "";
  return `${t.ops.listHeader(tasks.length)}\n${lines.join("\n")}${more}`;
}
