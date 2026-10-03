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
  it("is 0.45 urgency + 0.35 importance + 0.20 effort, 0–100", () => {
    // Due tomorrow (end of day, 37h59m away) and 60 minutes long: 1.54 days of slack.
    const task = due("a", "2026-09-30", { importance: 80, estimatedMinutes: 60 });
    const breakdown = priorityBreakdown(task, { now: NOW });
    assert.deepEqual([breakdown.importance, breakdown.effort, breakdown.readiness, breakdown.timeFit], [80, 70, 1, null]);
    assert.ok(breakdown.urgency > 72 && breakdown.urgency < 85, `slack between 1 and 2 days: ${breakdown.urgency}`);
    assert.equal(breakdown.score, Math.round(0.45 * breakdown.urgency + 0.35 * 80 + 0.2 * 70));
  });

  it("uses the whole 0–100 range: the chosen level clearly moves it, and it can reach 100", () => {
    const score = (extra: Partial<Task>) => computeScore(makeTask({ id: "x", estimatedMinutes: 30, ...extra }), { now: NOW });
    assert.equal(score({ importance: 50 }), Math.round(0.45 * 15 + 0.35 * 50 + 0.2 * 50));
    assert.ok(score({ importance: 80 }) - score({ importance: 50 }) >= 10, "High is well above Medium");
    assert.ok(score({ importance: 50 }) - score({ importance: 20 }) >= 10, "Medium is well above Low");
    const top = due("top", "2026-09-20", { importance: 100, estimatedMinutes: 240 });
    assert.equal(computeScore(top, { now: NOW }), 100);
  });

  it("a task without a deadline still gets a score and stays recommendable", () => {
    const task = makeTask({ id: "read", importance: 80 });
    assert.ok(computeScore(task, { now: NOW }) > 0);
    assert.deepEqual(recommendTasks([task], { now: NOW }).map((entry) => entry.task.id), ["read"]);
  });

  it("overdue is the top of the urgency scale, not beyond it", () => {
    assert.equal(urgencyScore(due("week", "2026-09-22"), NOW), 100);
    assert.equal(urgencyScore(due("month", "2026-08-01"), NOW), 100);
    assert.equal(computeScore(due("month", "2026-08-01"), { now: NOW }), computeScore(due("week", "2026-09-22"), { now: NOW }));
  });

  it("urgency rises smoothly as the deadline nears, with no jump at midnight", () => {
    const task = due("d", "2026-10-03", { estimatedMinutes: 30 });
    const before = urgencyScore(task, local(2026, 9, 30, 23, 59));
    const after = urgencyScore(task, local(2026, 10, 1, 0, 1));
    assert.ok(after - before <= 1, `${before} → ${after}`);
    assert.ok(urgencyScore(task, local(2026, 10, 2, 12)) > after);
  });

  it("the longer the task, the higher the score", () => {
    const minutes = [2, 15, 30, 60, 120, 240];
    const scores = minutes.map((m) => computeScore(makeTask({ id: `m${m}`, estimatedMinutes: m }), { now: NOW }));
    for (let index = 1; index < scores.length; index += 1) assert.ok(scores[index] > scores[index - 1], scores.join(" < "));
    // Same deadline: the long one also runs out of slack sooner.
    const short = due("s", "2026-10-02", { estimatedMinutes: 15 });
    const long = due("l", "2026-10-02", { estimatedMinutes: 600 });
    assert.ok(urgencyScore(long, NOW) > urgencyScore(short, NOW));
    assert.ok(computeScore(long, { now: NOW }) > computeScore(short, { now: NOW }));
  });

  it("more work than time left counts as due now", () => {
    const dueSoon = withDeadline(makeTask({ id: "x", estimatedMinutes: 240 }), makeDeadline({ date: "2026-09-29", time: "12:00" }));
    assert.equal(urgencyScore(dueSoon, NOW), 100);
  });

  it("a snoozed task is held back, and comes back gradually", () => {
    const skip = createSkipRecord("not now", NOW);
    const task = makeTask({ id: "x", skip });
    const unsnoozed = computeScore(makeTask({ id: "x" }), { now: NOW });
    assert.equal(priorityBreakdown(task, { now: NOW }).readiness, 0.3);
    assert.equal(computeScore(task, { now: NOW }), Math.round(unsnoozed * 0.3));
    assert.ok(priorityBreakdown(task, { now: new Date(NOW.getTime() + 90 * 60_000) }).readiness > 0.3);
    assert.equal(priorityBreakdown(task, { now: new Date(NOW.getTime() + 4 * 3_600_000) }).readiness, 1);
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
    const tasks = [due("urgent", "2026-09-29", { importance: 80 }), due("later", "2026-10-10"), makeTask({ id: "someday" })];
    const first = recommendTasks(tasks, { now: NOW })[0].task;
    assert.equal(first.id, "urgent");
    const completed = completeTaskDelta(first, NOW, tasks).upserts[0];
    const after = tasks.map((task) => (task.id === completed.id ? completed : task));
    assert.equal(recommendTasks(after, { now: NOW })[0].task.id, "later");
  });

  it("the user's pin beats the ranking", () => {
    const tasks = [due("urgent", "2026-09-29", { importance: 80 }), makeTask({ id: "mine", pinnedAt: NOW.toISOString() })];
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
    const muchBetter = due("much", "2026-09-29", { importance: 80 });
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
