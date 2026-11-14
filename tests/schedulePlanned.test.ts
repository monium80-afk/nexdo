/// <reference types="node" />
// The Calendar's coming repeats (2026-11-14): with planAhead, routines and
// repeating tasks show on the days after today, never stored, never counted.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { taskCount } from "@/components/schedule/scheduleParts";
import { normalizeRule, startSeries } from "@/lib/recurrence";
import { buildSchedule } from "@/lib/schedule";
import type { RecurrenceRule, Task } from "@/types/task";

import { local, makeTask } from "./helpers";

function rule(partial: Partial<RecurrenceRule> & Pick<RecurrenceRule, "frequency" | "anchorDate">): RecurrenceRule {
  const normalized = normalizeRule({ interval: 1, hour: 18, minute: 0, ...partial });
  assert.ok(normalized);
  return normalized;
}

function series(id: string, recurrenceRule: RecurrenceRule): Task {
  return startSeries(makeTask({ id, title: id }), recurrenceRule, `series-${id}`);
}

const now = local(2026, 11, 14, 9);

function plannedTitles(tasks: Task[], from: string, until: string, planAhead = true) {
  return buildSchedule(tasks, { now, from, until, planAhead }).map((day) => [day.date, day.planned.map((task) => task.title)]);
}

describe("coming repeats on the Calendar", () => {
  it("a daily routine shows on every day after today, not on today or before", () => {
    const water = series("water", rule({ frequency: "daily", anchorDate: "2026-11-14" }));
    assert.deepEqual(plannedTitles([water], "2026-11-13", "2026-11-17"), [
      ["2026-11-13", []],
      ["2026-11-14", []],
      ["2026-11-15", ["water"]],
      ["2026-11-16", ["water"]],
      ["2026-11-17", ["water"]],
    ]);
  });

  it("reaches any later month, on the rule's own days", () => {
    const rent = series("rent", rule({ frequency: "monthly", anchorDate: "2026-11-01" }));
    const days = buildSchedule([rent], { now, from: "2027-03-01", until: "2027-03-31", planAhead: true });
    assert.deepEqual(
      days.filter((day) => day.planned.length).map((day) => day.date),
      ["2027-03-01"],
    );
  });

  it("is off unless asked for", () => {
    const water = series("water", rule({ frequency: "daily", anchorDate: "2026-11-14" }));
    assert.ok(buildSchedule([water], { now, from: "2026-11-15", until: "2026-11-20" }).every((day) => day.planned.length === 0));
  });

  it("a day with a real occurrence keeps that one", () => {
    const water = series("water", rule({ frequency: "daily", anchorDate: "2026-11-14" }));
    // Tomorrow's already exists (today's was done): it's real there, not planned.
    const done: Task = { ...water, status: "completed", completedAt: now.toISOString() };
    const tomorrow: Task = { ...water, id: "series-water@2026-11-15", recurrence: { ...water.recurrence!, occurrenceDate: "2026-11-15" }, deadline: { date: "2026-11-15", time: "18:00" } };
    const days = buildSchedule([done, tomorrow], { now, from: "2026-11-15", until: "2026-11-16", planAhead: true });
    assert.equal(days[0].planned.length, 0);
    assert.equal(days[0].routines.length, 1);
    assert.equal(days[1].planned.length, 1);
  });

  it("a series with nothing open (archived or ended) isn't carried on", () => {
    const water = series("water", rule({ frequency: "daily", anchorDate: "2026-11-14" }));
    const archived: Task = { ...water, status: "archived" };
    assert.ok(buildSchedule([archived], { now, from: "2026-11-15", until: "2026-11-20", planAhead: true }).every((day) => day.planned.length === 0));
  });

  it("a coming repeating task counts on its day; a routine never does", () => {
    const water = series("water", rule({ frequency: "daily", anchorDate: "2026-11-14" }));
    const study = series("study", rule({ frequency: "daily", anchorDate: "2026-11-14", kind: "task" }));
    const days = buildSchedule([water, study], { now, from: "2026-11-14", until: "2026-11-20", planAhead: true });
    // Today: study's real occurrence. After it: study's coming ones. Water: never.
    assert.deepEqual(
      days.map((day) => taskCount(day)),
      [1, 1, 1, 1, 1, 1, 1],
    );
    assert.ok(days.slice(1).every((day) => day.planned.length === 2));
  });
});
