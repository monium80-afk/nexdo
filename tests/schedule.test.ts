/// <reference types="node" />
// The days behind the Schedule screen and the Today page (lib/schedule.ts).
process.env.TZ = "Europe/Paris";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { makeDeadline, withDeadline } from "@/lib/deadline";
import { buildSchedule, weekStart, type DayPlan } from "@/lib/schedule";
import type { Subtask, Task } from "@/types/task";

import { local, makeTask } from "./helpers";

// Tuesday, Oct 6 2026, mid-morning.
const NOW = local(2026, 10, 6, 10);
const MONDAY = "2026-10-05";
const SUNDAY = "2026-10-11";

function due(id: string, date: string, extra: Partial<Task> = {}, time?: string): Task {
  return withDeadline(makeTask({ id, title: id, ...extra }), makeDeadline({ date, time }));
}

function steps(...minutes: number[]): Subtask[] {
  return minutes.map((estimatedMinutes, order) => ({
    id: `s${order + 1}`,
    label: `step ${order + 1}`,
    estimatedMinutes,
    order,
    status: order === 0 ? "current" : "pending",
  }));
}

function week(tasks: Task[]): DayPlan[] {
  return buildSchedule(tasks, { now: NOW, from: MONDAY, until: SUNDAY });
}

/** Each day's open tasks, by date. */
function byDay(days: DayPlan[]): Record<string, string[]> {
  return Object.fromEntries(days.map((day) => [day.date, day.items.map((item) => item.task.id)]));
}

describe("the days", () => {
  it("run from the first day asked for through the last", () => {
    assert.deepEqual(
      week([]).map((day) => day.date),
      ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"],
    );
  });

  it("put each task on the day it's due — however much is due that day", () => {
    const days = byDay(
      week([
        due("fri", "2026-10-09", { estimatedMinutes: 120 }),
        due("today-a", "2026-10-06", { estimatedMinutes: 300 }),
        due("today-b", "2026-10-06", { estimatedMinutes: 240 }),
        due("wed", "2026-10-07", { estimatedMinutes: 90 }),
      ]),
    );
    assert.deepEqual(days["2026-10-06"].sort(), ["today-a", "today-b"]);
    assert.deepEqual(days["2026-10-07"], ["wed"]);
    assert.deepEqual(days["2026-10-09"], ["fri"]);
  });

  it("leave a task without a deadline off every day", () => {
    const days = week([makeTask({ id: "someday" }), makeTask({ id: "pinned", pinnedAt: "2026-10-05T08:00:00.000Z" })]);
    assert.equal(days.every((day) => day.items.length === 0), true);
  });

  it("keep a late task on the day it was due, as overdue — not on today", () => {
    const days = week([due("late", "2026-10-05", { estimatedMinutes: 60 }), due("today", "2026-10-06")]);
    assert.deepEqual(byDay(days)["2026-10-05"], ["late"]);
    assert.equal(days[0].items[0].overdue, true);
    assert.deepEqual(byDay(days)["2026-10-06"], ["today"]);
    assert.equal(days[1].items[0].overdue, false);
  });

  it("keep a task whose time today has passed on today, as overdue", () => {
    const [today] = buildSchedule([due("standup", "2026-10-06", {}, "09:00")], { now: NOW, from: "2026-10-06", until: "2026-10-06" });
    assert.deepEqual(today.items.map((item) => [item.task.id, item.overdue, item.time]), [["standup", true, "09:00"]]);
  });

  it("order a day: late first, then set times by time, then the most worth doing", () => {
    const [today] = buildSchedule(
      [
        due("small", "2026-10-06", { importance: 20 }),
        due("evening", "2026-10-06", {}, "19:00"),
        due("big", "2026-10-06", { importance: 100 }),
        due("morning", "2026-10-06", {}, "08:00"),
        due("noon", "2026-10-06", {}, "12:00"),
      ],
      { now: NOW, from: "2026-10-06", until: "2026-10-06" },
    );
    assert.deepEqual(today.items.map((item) => item.task.id), ["morning", "noon", "evening", "big", "small"]);
  });

  it("put a repeating task's occurrence on its own day", () => {
    const occurrence = due("laundry", "2026-10-10", {
      recurrence: {
        seriesId: "laundry",
        occurrenceDate: "2026-10-10",
        rule: { frequency: "weekly", interval: 1, anchorDate: "2026-10-03", hour: 18, minute: 0, allDay: true },
        template: { title: "laundry", estimatedMinutes: 30, importance: 50 },
      },
    });
    assert.deepEqual(byDay(week([occurrence]))["2026-10-10"], ["laundry"]);
  });

  it("keep a task with a plan whole, on its due day", () => {
    const thesis = due("thesis", "2026-10-09", { estimatedMinutes: 180, subtasks: steps(60, 60, 60), currentStepId: "s1" });
    const days = byDay(week([thesis]));
    assert.deepEqual(days["2026-10-09"], ["thesis"]);
    assert.equal(Object.values(days).flat().length, 1);
  });

  it("add up the open work on a day, counting a task with no length as half an hour", () => {
    const [today] = buildSchedule(
      [due("a", "2026-10-06", { estimatedMinutes: 45 }), due("b", "2026-10-06", { estimatedMinutes: 0 })],
      { now: NOW, from: "2026-10-06", until: "2026-10-06" },
    );
    assert.equal(today.plannedMinutes, 75);
  });

  it("show a finished task on the day it was due, in the order things were done", () => {
    const doneAt = (id: string, date: string, at: Date) =>
      due(id, date, { status: "completed", completedAt: at.toISOString() });
    const days = week([
      doneAt("late", "2026-10-06", local(2026, 10, 6, 18)),
      doneAt("early", "2026-10-06", local(2026, 10, 6, 7)),
      // Done a day ahead: still Wednesday's.
      doneAt("ahead", "2026-10-07", local(2026, 10, 6, 9)),
      due("reopened", "2026-10-06", { completedAt: local(2026, 10, 6, 8).toISOString() }),
      makeTask({ id: "no-deadline", status: "completed", completedAt: local(2026, 10, 6, 8).toISOString() }),
    ]);
    assert.deepEqual(days[1].done.map((task) => task.id), ["early", "late"]);
    assert.deepEqual(days[2].done.map((task) => task.id), ["ahead"]);
    assert.deepEqual(byDay(days)["2026-10-06"], ["reopened"]);
  });

  it("ignore skipped and archived tasks", () => {
    const days = week([due("skipped", "2026-10-06", { status: "skipped" }), due("archived", "2026-10-06", { status: "archived" })]);
    assert.equal(days.every((day) => day.items.length === 0 && day.done.length === 0), true);
  });

  it("leave out what's due outside the days asked for", () => {
    const days = week([due("before", "2026-10-04"), due("after", "2026-10-12")]);
    assert.equal(days.every((day) => day.items.length === 0), true);
  });
});

describe("weeks", () => {
  it("run Monday to Sunday", () => {
    assert.equal(weekStart("2026-10-06"), "2026-10-05");
    assert.equal(weekStart("2026-10-05"), "2026-10-05");
    assert.equal(weekStart("2026-10-11"), "2026-10-05");
    assert.equal(weekStart("2026-11-01"), "2026-10-26");
  });
});
