/// <reference types="node" />
process.env.TZ = "Europe/Paris";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeRule, startSeries } from "@/lib/recurrence";
import {
  bulkRecurrenceScope,
  completeTaskDelta,
  needsRecurrenceScope,
  planOperation,
  reopenTaskDelta,
  shiftDate,
  type TaskOperation,
} from "@/lib/taskOperations";
import type { Task } from "@/types/task";

import { local, makeTask } from "./helpers";

const NOW = local(2026, 10, 7, 10); // Wednesday 7 Oct 2026, 10:00

function iso(year: number, month: number, day: number, hour = 18, minute = 0) {
  return local(year, month, day, hour, minute).toISOString();
}

function apply(tasks: Task[], operation: TaskOperation, now = NOW) {
  const plan = planOperation(tasks, operation, now);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  plan.upserts.forEach((task) => byId.set(task.id, task));
  plan.deletes.forEach((id) => byId.delete(id));
  return { plan, tasks: [...byId.values()] };
}

const weeklyGym = () =>
  startSeries(
    makeTask({ id: "gym", title: "Gym", estimatedMinutes: 60 }),
    normalizeRule({ frequency: "weekly", interval: 1, weekdays: [1], anchorDate: "2026-10-05", hour: 7, minute: 0 })!,
    "series-gym",
  );

describe("shiftDate", () => {
  it("keeps the time of day across the DST change", () => {
    const shifted = new Date(shiftDate(iso(2026, 10, 20, 9), { amount: 2, unit: "weeks" }));
    assert.equal(shifted.getDate(), 3);
    assert.equal(shifted.getMonth(), 10); // November
    assert.equal(shifted.getHours(), 9);
  });

  it("clamps month shifts to the end of a shorter month", () => {
    const shifted = new Date(shiftDate(iso(2026, 1, 31), { amount: 1, unit: "months" }));
    assert.equal(shifted.getMonth(), 1);
    assert.equal(shifted.getDate(), 28);
  });
});

describe("bulk updates", () => {
  const tasks = [
    makeTask({ id: "a", title: "Chemistry assignment", dueDate: iso(2026, 10, 8) }),
    makeTask({ id: "b", title: "Business plan", dueDate: iso(2026, 10, 9, 9, 30) }),
    makeTask({ id: "c", title: "Read a book" }),
    makeTask({ id: "d", title: "Old report", status: "completed", completedAt: iso(2026, 10, 6), dueDate: iso(2026, 10, 5) }),
  ];

  it("postpones every open task by two weeks, keeping each time of day, and skips the ones without a deadline", () => {
    const { plan } = apply(tasks, {
      kind: "update",
      target: { filter: {} },
      changes: { dueShift: { amount: 2, unit: "weeks" } },
    });
    const byId = new Map(plan.upserts.map((task) => [task.id, task]));
    assert.equal(new Date(byId.get("a")!.dueDate!).getDate(), 22);
    const b = new Date(byId.get("b")!.dueDate!);
    assert.deepEqual([b.getDate(), b.getHours(), b.getMinutes()], [23, 9, 30]);
    assert.ok(!byId.has("c"));
    assert.ok(!byId.has("d"), "completed tasks are not part of 'all my tasks' for an update");
    assert.equal(plan.outcomes.find((outcome) => outcome.taskId === "c")?.reason, "no-deadline");
  });

  it("adds an hour to every open task", () => {
    const { plan } = apply(tasks, { kind: "update", target: { filter: {} }, changes: { estimatedMinutesDelta: 60 } });
    assert.deepEqual(
      plan.upserts.map((task) => task.estimatedMinutes),
      [90, 90, 90],
    );
  });

  it("changes importance of keyword-matched tasks only", () => {
    const { plan } = apply(tasks, {
      kind: "update",
      target: { filter: { keywords: ["business"] } },
      changes: { priority: "high" },
    });
    assert.deepEqual(plan.upserts.map((task) => [task.id, task.importance]), [["b", 75]]);
  });

  it("reschedules only overdue tasks to an absolute date, keeping their own time", () => {
    const withOverdue = [...tasks, makeTask({ id: "late", dueDate: iso(2026, 10, 1, 8, 15) })];
    const { plan } = apply(withOverdue, {
      kind: "update",
      target: { filter: { status: "overdue" } },
      changes: { dueDate: iso(2026, 10, 12), keepTimeOfDay: true },
    });
    assert.equal(plan.upserts.length, 1);
    const due = new Date(plan.upserts[0].dueDate!);
    assert.deepEqual([due.getDate(), due.getHours(), due.getMinutes()], [12, 8, 15]);
  });

  it("records the previous version of every touched task for undo", () => {
    const { plan } = apply(tasks, { kind: "update", target: { taskIds: ["a"] }, changes: { title: "Chem lab" } });
    assert.equal(plan.before.length, 1);
    assert.equal(plan.before[0].before?.title, "Chemistry assignment");
  });

  it("reports ids that don't exist instead of pretending", () => {
    const { plan } = apply(tasks, { kind: "complete", target: { taskIds: ["a", "ghost"] } });
    assert.deepEqual(plan.missingIds, ["ghost"]);
    assert.equal(plan.outcomes.length, 1);
  });
});

describe("completed tasks", () => {
  const done = makeTask({ id: "chem", title: "Chemistry", status: "completed", completedAt: iso(2026, 10, 6, 14) });

  it("editing a completed task keeps it completed", () => {
    const { plan } = apply([done], { kind: "update", target: { taskIds: ["chem"] }, changes: { dueDate: iso(2026, 10, 20) } });
    assert.equal(plan.upserts[0].status, "completed");
    assert.equal(plan.upserts[0].completedAt, done.completedAt);
    assert.equal(plan.outcomes[0].wasCompleted, true);
  });

  it("reopens it", () => {
    const { plan } = apply([done], { kind: "reopen", target: { taskIds: ["chem"] } });
    assert.equal(plan.upserts[0].status, "pending");
    assert.equal(plan.upserts[0].completedAt, undefined);
  });

  it("completing an already completed task changes nothing and says so", () => {
    const { plan } = apply([done], { kind: "complete", target: { taskIds: ["chem"] } });
    assert.equal(plan.upserts.length, 0);
    assert.equal(plan.outcomes[0].reason, "already-completed");
  });

  it("finds completed tasks by completion date", () => {
    const { plan } = apply(
      [done, makeTask({ id: "older", status: "completed", completedAt: iso(2026, 9, 1) })],
      { kind: "delete", target: { filter: { status: "completed", completedFrom: iso(2026, 10, 5, 0), completedTo: iso(2026, 10, 11, 23, 59) } } },
    );
    assert.deepEqual(plan.deletes, ["chem"]);
  });
});

describe("recurring tasks", () => {
  it("completing Monday's occurrence creates next Monday's, once", () => {
    const gym = weeklyGym();
    const first = apply([gym], { kind: "complete", target: { taskIds: ["gym"] } }, local(2026, 10, 5, 8));
    const next = first.tasks.find((task) => task.id === "series-gym@2026-10-12");
    assert.ok(next);
    assert.equal(first.tasks.find((task) => task.id === "gym")?.status, "completed");
    assert.equal(first.tasks.find((task) => task.id === "gym")?.recurrence?.nextOccurrenceId, next.id);

    // Another device completing the same occurrence (or a replayed sync) finds it already there.
    const again = completeTaskDelta(gym, local(2026, 10, 5, 9), first.tasks);
    assert.deepEqual(again.upserts.map((task) => task.id), ["gym"]);
    assert.equal(first.tasks.filter((task) => task.recurrence?.seriesId === "series-gym").length, 2);
  });

  it("reopening takes back the untouched next occurrence", () => {
    const gym = weeklyGym();
    const completed = apply([gym], { kind: "complete", target: { taskIds: ["gym"] } }, local(2026, 10, 5, 8)).tasks;
    const delta = reopenTaskDelta(completed.find((task) => task.id === "gym")!, local(2026, 10, 5, 9), completed);
    assert.deepEqual(delta.deletes, ["series-gym@2026-10-12"]);
    assert.equal(delta.upserts[0].recurrence?.nextOccurrenceId, undefined);
  });

  it("deleting just this occurrence skips to the next one", () => {
    const { plan, tasks } = apply([weeklyGym()], { kind: "delete", target: { taskIds: ["gym"] }, scope: "this" }, local(2026, 10, 4, 8));
    assert.deepEqual(plan.deletes, ["gym"]);
    assert.deepEqual(tasks.map((task) => task.id), ["series-gym@2026-10-12"]);
    assert.equal(plan.outcomes[0].outcome, "skipped");
  });

  it("deleting the series removes history too; 'future' keeps history", () => {
    const history = { ...weeklyGym(), id: "gym-old", status: "completed" as const, completedAt: iso(2026, 9, 28) };
    history.recurrence = { ...history.recurrence!, occurrenceDate: "2026-09-28" };
    const all = [history, weeklyGym()];
    assert.deepEqual(apply(all, { kind: "delete", target: { taskIds: ["gym"] }, scope: "series" }).plan.deletes.sort(), ["gym", "gym-old"]);
    assert.deepEqual(apply(all, { kind: "delete", target: { taskIds: ["gym"] }, scope: "future" }).plan.deletes, ["gym"]);
  });

  it("editing only this occurrence leaves the template alone; 'future' rewrites it", () => {
    const gym = weeklyGym();
    const only = apply([gym], { kind: "update", target: { taskIds: ["gym"] }, changes: { title: "Gym (legs)" }, scope: "this" });
    assert.equal(only.plan.upserts[0].title, "Gym (legs)");
    assert.equal(only.plan.upserts[0].recurrence?.template.title, "Gym");

    const future = apply([gym], { kind: "update", target: { taskIds: ["gym"] }, changes: { title: "Gym session" }, scope: "future" });
    assert.equal(future.plan.upserts[0].recurrence?.template.title, "Gym session");
  });

  it("moving an occurrence to Tuesday 'from now on' re-times the rule", () => {
    const gym = weeklyGym();
    const { plan } = apply(gym ? [gym] : [], {
      kind: "update",
      target: { taskIds: ["gym"] },
      changes: { dueDate: iso(2026, 10, 6, 19) },
      scope: "future",
    }, local(2026, 10, 4, 8));
    const recurrence = plan.upserts[0].recurrence!;
    assert.deepEqual(recurrence.rule.weekdays, [2]);
    assert.equal(recurrence.rule.hour, 19);
    assert.equal(recurrence.occurrenceDate, "2026-10-06");
  });

  it("stopping the repeat turns the open occurrence into a plain task", () => {
    const { plan } = apply([weeklyGym()], { kind: "update", target: { taskIds: ["gym"] }, changes: { recurrence: null } });
    assert.equal(plan.upserts[0].recurrence, undefined);
  });

  it("asks for a scope before editing or deleting a repeating task, but not before completing it", () => {
    const gym = weeklyGym();
    assert.ok(needsRecurrenceScope({ kind: "delete", target: { taskIds: ["gym"] } }, [gym]));
    assert.ok(needsRecurrenceScope({ kind: "update", target: { taskIds: ["gym"] }, changes: { title: "x" } }, [gym]));
    assert.ok(!needsRecurrenceScope({ kind: "complete", target: { taskIds: ["gym"] } }, [gym]));
    assert.ok(!needsRecurrenceScope({ kind: "update", target: { taskIds: ["gym"] }, changes: { recurrence: null } }, [gym]));
    // The model repeats the task's current title and length alongside "stop repeating" — those aren't edits.
    assert.ok(
      !needsRecurrenceScope(
        { kind: "update", target: { taskIds: ["gym"] }, changes: { recurrence: null, title: "Gym", estimatedMinutes: 60, priority: "medium" } },
        [gym],
      ),
    );
  });

  it("a bulk request doesn't ask about the repeating tasks in it: edits move the current occurrence, deletes end the series", () => {
    const gym = weeklyGym();
    const essay = makeTask({ id: "essay", dueDate: iso(2026, 10, 9) });
    const postpone: TaskOperation = { kind: "update", target: { filter: {} }, changes: { dueShift: { amount: 2, unit: "weeks" } } };
    assert.ok(!needsRecurrenceScope(postpone, [gym, essay]));
    assert.equal(bulkRecurrenceScope(postpone, [gym, essay]), "this");

    const wipe: TaskOperation = { kind: "delete", target: { filter: { status: "all" } } };
    assert.equal(bulkRecurrenceScope(wipe, [gym, essay]), "future");
    const { tasks } = apply([gym, essay], { ...wipe, scope: "future" }, local(2026, 10, 4, 8));
    assert.deepEqual(tasks, [], "no next occurrence is generated for a series that was deleted in bulk");
  });

  it("'future' deletes the named occurrence even when it's a completed one", () => {
    const done = { ...weeklyGym(), id: "gym-old", status: "completed" as const, completedAt: iso(2026, 9, 28) };
    const { plan } = apply([done, weeklyGym()], { kind: "delete", target: { taskIds: ["gym-old"] }, scope: "future" });
    assert.deepEqual([...plan.deletes].sort(), ["gym", "gym-old"]);
  });

  it("makes a plain task repeat every weekday it asks for", () => {
    const task = makeTask({ id: "standup", dueDate: iso(2026, 10, 8, 9) });
    const { plan } = apply([task], {
      kind: "update",
      target: { taskIds: ["standup"] },
      changes: { recurrence: { frequency: "weekly", weekdays: [1, 3, 5] } },
    });
    const recurrence = plan.upserts[0].recurrence!;
    assert.deepEqual(recurrence.rule.weekdays, [1, 3, 5]);
    assert.equal(recurrence.occurrenceDate, "2026-10-09"); // first of Mon/Wed/Fri on or after Thu 8th
    assert.equal(new Date(plan.upserts[0].dueDate!).getHours(), 9);
  });
});
