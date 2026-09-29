/// <reference types="node" />
// Repeating tasks: date-only series, independent occurrences, the "missed"
// policy, and daylight saving. Europe/Paris: the clocks go back on 2026-10-25.
process.env.TZ = "Europe/Paris";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { makeDeadline, withDeadline } from "@/lib/deadline";
import { buildRule, normalizeRule, startSeries } from "@/lib/recurrence";
import { completeTaskDelta, editTaskDelta, planOperation, skipMissedDelta } from "@/lib/taskOperations";
import type { RecurrenceRule, Task } from "@/types/task";

import { local, makeTask } from "./helpers";

function rule(partial: Partial<RecurrenceRule> & Pick<RecurrenceRule, "frequency" | "anchorDate">): RecurrenceRule {
  const normalized = normalizeRule({ interval: 1, hour: 18, minute: 0, ...partial });
  assert.ok(normalized);
  return normalized;
}

function series(id: string, recurrenceRule: RecurrenceRule, extra: Partial<Task> = {}): Task {
  return startSeries(makeTask({ id, title: id, ...extra }), recurrenceRule, `series-${id}`);
}

describe("series without a time", () => {
  it('"every day" with no deadline starts today, due on the day — no 18:00 invented', () => {
    const built = buildRule({ frequency: "daily" }, undefined, local(2026, 9, 29, 10));
    assert.equal(built?.anchorDate, "2026-09-29");
    assert.equal(built?.allDay, true);
  });

  it("a date-only deadline makes a date-only series; an exact one keeps its time", () => {
    const dateOnly = buildRule({ frequency: "weekly", weekdays: [6] }, makeDeadline({ date: "2026-10-03" }), local(2026, 9, 29, 10));
    assert.deepEqual([dateOnly?.anchorDate, dateOnly?.allDay], ["2026-10-03", true]);
    const timed = buildRule({ frequency: "weekly", weekdays: [1, 3, 5] }, makeDeadline({ date: "2026-09-30", time: "18:00" }), local(2026, 9, 29, 10));
    assert.deepEqual([timed?.anchorDate, timed?.allDay, timed?.hour], ["2026-09-30", undefined, 18]);
  });

  it("occurrences of an all-day series have date-only deadlines, also across the clock change", () => {
    const first = series("clean", rule({ frequency: "weekly", anchorDate: "2026-10-24", weekdays: [6], allDay: true }));
    assert.deepEqual([first.deadline?.date, first.deadline?.time], ["2026-10-24", undefined]);
    const { upserts } = completeTaskDelta(first, local(2026, 10, 24, 20), [first]);
    const next = upserts.find((task) => task.status === "pending")!;
    assert.deepEqual([next.deadline?.date, next.deadline?.time], ["2026-10-31", undefined]);
    assert.equal(new Date(next.dueDate!).getHours(), 23);
  });

  it("a weekly 18:00 series stays at 18:00 local time on both sides of the clock change", () => {
    const first = series("gym", rule({ frequency: "weekly", anchorDate: "2026-10-19", weekdays: [1] }));
    const next = completeTaskDelta(first, local(2026, 10, 19, 19), [first]).upserts.find((task) => task.status === "pending")!;
    assert.equal(next.deadline?.date, "2026-10-26");
    assert.equal(new Date(next.dueDate!).getHours(), 18);
    assert.equal(Date.parse(next.dueDate!) - Date.parse(first.dueDate!), 7 * 24 * 3_600_000 + 3_600_000);
  });
});

describe("occurrences are independent", () => {
  const mwf = series("exercise", rule({ frequency: "weekly", anchorDate: "2026-09-28", weekdays: [1, 3, 5] }));

  it("completing Monday's creates Wednesday's, open — completing one never completes another", () => {
    const { upserts } = completeTaskDelta(mwf, local(2026, 9, 28, 19), [mwf]);
    const [monday, wednesday] = upserts;
    assert.equal(monday.status, "completed");
    assert.equal(wednesday.status, "pending");
    assert.equal(wednesday.id, "series-exercise@2026-09-30");
    assert.equal(wednesday.deadline?.date, "2026-09-30");
  });

  it("editing just this occurrence leaves the series alone; 'future' changes it and keeps the history", () => {
    const done = { ...mwf, id: "series-exercise@2026-09-21", status: "completed" as const, completedAt: "2026-09-21T17:00:00.000Z" };
    const all = [done, mwf];
    const thisOnly = editTaskDelta(mwf, { title: "Run" }, "this", local(2026, 9, 28, 9), all).upserts;
    assert.equal(thisOnly[0].title, "Run");
    assert.equal(thisOnly[0].recurrence?.template.title, "exercise");
    assert.equal(thisOnly.length, 1);

    const future = editTaskDelta(mwf, { title: "Run" }, "future", local(2026, 9, 28, 9), all).upserts;
    assert.equal(future[0].recurrence?.template.title, "Run");
    assert.equal(future.length, 1, "the completed occurrence isn't rewritten");
  });

  it("moving an occurrence to Tuesday 'from now on' moves the rule; its date-only-ness follows the new deadline", () => {
    const moved = editTaskDelta(mwf, { deadline: { date: "2026-09-29" } }, "future", local(2026, 9, 28, 9), [mwf]).upserts[0];
    assert.equal(moved.recurrence?.rule.allDay, true);
    assert.ok(moved.recurrence?.rule.weekdays?.includes(2));
  });

  it("a day already done early doesn't stall the series — it moves on to the next free day", () => {
    const daily = series("water", rule({ frequency: "daily", anchorDate: "2026-09-29" }));
    const tomorrowDoneEarly: Task = {
      ...withDeadline(makeTask({ id: "series-water@2026-09-30", title: "water" }), makeDeadline({ date: "2026-09-30", time: "18:00" })),
      status: "completed",
      recurrence: { ...daily.recurrence!, occurrenceDate: "2026-09-30" },
    };
    const { upserts } = completeTaskDelta(daily, local(2026, 9, 29, 19), [daily, tomorrowDoneEarly]);
    const next = upserts.find((task) => task.status === "pending");
    assert.equal(next?.id, "series-water@2026-10-01");
  });
});

describe("missed occurrences", () => {
  const skipDaily = series("quran", rule({ frequency: "daily", anchorDate: "2026-09-25", allDay: true, missed: "skip" }));

  it('"skip": once a later one is due, the missed one is marked skipped and today\'s comes in — just today\'s', () => {
    const now = local(2026, 9, 29, 10);
    const delta = skipMissedDelta(skipDaily, now, [skipDaily])!;
    const [skipped, current] = delta.upserts;
    assert.equal(skipped.status, "skipped");
    assert.equal(skipped.id, skipDaily.id);
    assert.equal(current.id, "series-quran@2026-09-29");
    assert.equal(current.status, "pending");
    assert.equal(delta.upserts.length, 2, "no back-filled occurrences for the days in between");
  });

  it("running it again changes nothing — it's idempotent", () => {
    const now = local(2026, 9, 29, 10);
    const first = skipMissedDelta(skipDaily, now, [skipDaily])!;
    const after = first.upserts;
    for (const task of after) assert.equal(skipMissedDelta(task, now, after), null);
    // And on another device that still has the old open one, it lands on the same row.
    const again = skipMissedDelta(skipDaily, now, [skipDaily, after[1]])!;
    assert.deepEqual(again.upserts.map((task) => task.id), [skipDaily.id]);
  });

  it('"keep" (the default): the missed one stays open and overdue, and the series waits', () => {
    const keep = series("read", rule({ frequency: "daily", anchorDate: "2026-09-25" }));
    assert.equal(skipMissedDelta(keep, local(2026, 9, 29, 10), [keep]), null);
  });

  it("an occurrence the user moved into the future isn't skipped", () => {
    const moved = withDeadline(skipDaily, makeDeadline({ date: "2026-10-02" }));
    assert.equal(skipMissedDelta(moved, local(2026, 9, 29, 10), [moved]), null);
  });

  it("the rule's missed policy survives storage and editing", () => {
    assert.equal(normalizeRule({ ...skipDaily.recurrence!.rule })?.missed, "skip");
    const plan = planOperation([skipDaily], { kind: "update", target: { taskIds: [skipDaily.id] }, changes: { title: "Qur'an" }, scope: "future" }, local(2026, 9, 25, 9));
    assert.equal(plan.upserts[0].recurrence?.rule.missed, "skip");
  });
});
