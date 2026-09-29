/// <reference types="node" />
// The priority engine (lib/priority.ts) and the planning engine (lib/planning.ts).
process.env.TZ = "Europe/Paris";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { makeDeadline, withDeadline } from "@/lib/deadline";
import { summarizePlan } from "@/lib/planning";
import {
  computeScore,
  priorityBreakdown,
  recommendTasks,
  RECOMMENDATION_STABILITY_MARGIN,
  urgencyScore,
} from "@/lib/priority";
import { createSkipRecord } from "@/lib/scoring";
import { completeTaskDelta } from "@/lib/taskOperations";
import { useTaskStore } from "@/store/useTaskStore";
import type { Subtask, Task } from "@/types/task";

import { local, makeTask } from "./helpers";

const NOW = local(2026, 9, 29, 10);

function due(id: string, date: string, extra: Partial<Task> = {}): Task {
  return withDeadline(makeTask({ id, title: id, ...extra }), makeDeadline({ date }));
}

function steps(...entries: [string, number, Subtask["status"]][]): Subtask[] {
  return entries.map(([id, minutes, status], order) => ({ id, label: id, estimatedMinutes: minutes, order, status }));
}

describe("the score", () => {
  it("is 0.40 urgency + 0.30 importance + 0.15 readiness (+ 0.15 time fit when a budget is known), 0–100", () => {
    const task = due("a", "2026-09-30", { importance: 75 });
    const breakdown = priorityBreakdown(task, { now: NOW });
    assert.deepEqual([breakdown.urgency, breakdown.importance, breakdown.readiness, breakdown.timeFit], [85, 75, 100, null]);
    // No budget: the time-fit weight is left out and the rest re-weighted.
    assert.equal(breakdown.score, Math.round((0.4 * 85 + 0.3 * 75 + 0.15 * 100) / 0.85));
    const withBudget = priorityBreakdown(task, { now: NOW, availableMinutes: 60 });
    assert.equal(withBudget.score, Math.round(0.4 * 85 + 0.3 * 75 + 0.15 * 100 + 0.15 * 100));
  });

  it("a task without a deadline still gets a score and stays recommendable", () => {
    const task = makeTask({ id: "read", importance: 75 });
    assert.ok(computeScore(task, { now: NOW }) > 0);
    assert.deepEqual(recommendTasks([task], { now: NOW }).map((entry) => entry.task.id), ["read"]);
  });

  it("overdue is the top of the urgency scale, not beyond it", () => {
    assert.equal(urgencyScore(due("week", "2026-09-22"), NOW), 100);
    assert.equal(urgencyScore(due("month", "2026-08-01"), NOW), 100);
    assert.equal(computeScore(due("month", "2026-08-01"), { now: NOW }), computeScore(due("week", "2026-09-22"), { now: NOW }));
  });

  it("duration never lowers it — a long task isn't an unimportant one", () => {
    const short = due("s", "2026-10-02", { estimatedMinutes: 15 });
    const long = due("l", "2026-10-02", { estimatedMinutes: 600 });
    assert.equal(computeScore(short, { now: NOW }), computeScore(long, { now: NOW }));
  });

  it("more work than time left counts as due now", () => {
    const dueSoon = withDeadline(makeTask({ id: "x", estimatedMinutes: 240 }), makeDeadline({ date: "2026-09-29", time: "12:00" }));
    assert.equal(urgencyScore(dueSoon, NOW), 100);
  });

  it("a snoozed task comes back gradually", () => {
    const skip = createSkipRecord("not now", NOW);
    const task = makeTask({ id: "x", skip });
    assert.equal(priorityBreakdown(task, { now: NOW }).readiness, 0);
    assert.ok(priorityBreakdown(task, { now: new Date(NOW.getTime() + 90 * 60_000) }).readiness > 0);
    assert.equal(priorityBreakdown(task, { now: new Date(NOW.getTime() + 4 * 3_600_000) }).readiness, 100);
  });

  it("time fit: what fits the stated time wins; the next step fitting counts for something", () => {
    const fits = makeTask({ id: "fits", estimatedMinutes: 20 });
    const stepFits = makeTask({ id: "step", estimatedMinutes: 120, subtasks: steps(["a", 20, "current"], ["b", 100, "pending"]), currentStepId: "a" });
    const tooLong = makeTask({ id: "long", estimatedMinutes: 120 });
    const ranked = recommendTasks([tooLong, stepFits, fits], { now: NOW, availableMinutes: 30 }).map((entry) => entry.task.id);
    assert.deepEqual(ranked, ["fits", "step", "long"]);
  });
});

describe("what to do next", () => {
  it("never recommends completed, skipped or archived tasks", () => {
    const tasks = [
      makeTask({ id: "done", status: "completed" }),
      makeTask({ id: "gone", status: "archived" }),
      makeTask({ id: "missed", status: "skipped" }),
      makeTask({ id: "open" }),
    ];
    assert.deepEqual(recommendTasks(tasks, { now: NOW }).map((entry) => entry.task.id), ["open"]);
  });

  it("completing the top task brings up the next best one", () => {
    const tasks = [due("urgent", "2026-09-29", { importance: 75 }), due("later", "2026-10-10"), makeTask({ id: "someday" })];
    const first = recommendTasks(tasks, { now: NOW })[0].task;
    assert.equal(first.id, "urgent");
    const completed = completeTaskDelta(first, NOW, tasks).upserts[0];
    const after = tasks.map((task) => (task.id === completed.id ? completed : task));
    assert.equal(recommendTasks(after, { now: NOW })[0].task.id, "later");
  });

  it("the user's pin beats the ranking", () => {
    const tasks = [due("urgent", "2026-09-29", { importance: 75 }), makeTask({ id: "mine", pinnedAt: NOW.toISOString() })];
    assert.equal(recommendTasks(tasks, { now: NOW })[0].task.id, "mine");
  });

  it("ties are broken the same way every time: earlier deadline, then the older task, then the id", () => {
    const a = makeTask({ id: "b-task", createdAt: "2026-09-01T08:00:00.000Z" });
    const b = makeTask({ id: "a-task", createdAt: "2026-09-01T08:00:00.000Z" });
    const c = makeTask({ id: "older", createdAt: "2026-08-01T08:00:00.000Z" });
    const order = (list: Task[]) => recommendTasks(list, { now: NOW }).map((entry) => entry.task.id);
    assert.deepEqual(order([a, b, c]), ["older", "a-task", "b-task"]);
    assert.deepEqual(order([c, b, a]), ["older", "a-task", "b-task"]);
  });

  it("keeps the card on top unless another beats it clearly", () => {
    const top = makeTask({ id: "top", importance: 50 });
    const slightlyBetter = makeTask({ id: "better", importance: 55 });
    const muchBetter = due("much", "2026-09-29", { importance: 75 });
    assert.equal(recommendTasks([top, slightlyBetter], { now: NOW })[0].task.id, "better");
    assert.equal(recommendTasks([top, slightlyBetter], { now: NOW }, "top")[0].task.id, "top");
    const gap = computeScore(muchBetter, { now: NOW }) - computeScore(top, { now: NOW });
    assert.ok(gap > RECOMMENDATION_STABILITY_MARGIN);
    assert.equal(recommendTasks([top, muchBetter], { now: NOW }, "top")[0].task.id, "much");
  });
});

describe("the plan", () => {
  it("a simple task has no plan", () => {
    assert.equal(summarizePlan(makeTask({ id: "simple" }), NOW), null);
  });

  it("spreads the steps left over the days to the deadline, and never schedules a time", () => {
    const task = due("exam", "2026-10-02", {
      subtasks: steps(["c1", 60, "completed"], ["c2", 60, "current"], ["c3", 60, "pending"], ["c4", 60, "pending"], ["mock", 60, "pending"]),
      currentStepId: "c2",
    });
    const plan = summarizePlan(task, NOW)!;
    assert.equal(plan.pace, "scheduled");
    assert.deepEqual([plan.totalSteps, plan.doneSteps, plan.openSteps, plan.remainingMinutes], [5, 1, 4, 240]);
    assert.equal(plan.daysLeft, 4, "today to Oct 2, both included");
    assert.equal(plan.minutesPerDay, 60);
    assert.deepEqual(plan.suggestions.map((entry) => entry.date), ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    assert.equal(plan.currentStep?.id, "c2");
  });

  it("follows the deadline when it moves, and keeps finished work out of the pace", () => {
    const base = due("exam", "2026-10-02", { subtasks: steps(["done", 120, "completed"], ["left", 120, "current"]) });
    assert.equal(summarizePlan(base, NOW)!.remainingMinutes, 120);
    const sooner = withDeadline(base, makeDeadline({ date: "2026-09-30" }));
    assert.equal(summarizePlan(sooner, NOW)!.daysLeft, 2);
    assert.equal(summarizePlan(sooner, NOW)!.minutesPerDay, 60);
  });

  it("an overdue plan says so, and a plan without a deadline makes no schedule up", () => {
    const overdue = due("late", "2026-09-20", { subtasks: steps(["a", 30, "current"]) });
    assert.equal(summarizePlan(overdue, NOW)!.pace, "overdue");
    const open = makeTask({ id: "open", subtasks: steps(["a", 30, "current"]) });
    assert.deepEqual([summarizePlan(open, NOW)!.pace, summarizePlan(open, NOW)!.suggestions], ["none", []]);
  });

  it("regenerating the remaining steps keeps the finished ones", () => {
    useTaskStore.setState({ tasks: [makeTask({ id: "plan", subtasks: steps(["done", 30, "completed"], ["old", 30, "current"]) })], syncUserId: null });
    useTaskStore.getState().replaceRemainingSteps("plan", [{ title: "new", estimatedMinutes: 45 }]);
    const kept = useTaskStore.getState().tasks[0].subtasks!;
    assert.deepEqual(kept.map((step) => [step.label, step.status]), [["done", "completed"], ["new", "current"]]);
    assert.equal(useTaskStore.getState().tasks[0].estimatedMinutes, 45);
  });
});
