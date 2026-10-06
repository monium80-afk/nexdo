/// <reference types="node" />
// The reminder policy (lib/reminders.ts): which notifications the phone should
// hold, and what the reconciler changes to get there.
process.env.TZ = "Europe/Paris";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { en } from "@/constants/translations/en";
import { makeDeadline, withDeadline } from "@/lib/deadline";
import {
  DEFAULT_REMINDER_PREFERENCES,
  diffNotifications,
  MAX_SCHEDULED,
  planNotifications,
  planTaskReminders,
  type ReminderPreferences,
} from "@/lib/reminders";
import { archiveTaskDelta, completeTaskDelta, editTaskDelta } from "@/lib/taskOperations";
import type { Task } from "@/types/task";

import { local, makeTask } from "./helpers";

const NOW = local(2026, 9, 29, 10);
const PREFS: ReminderPreferences = { ...DEFAULT_REMINDER_PREFERENCES };

function dueTask(id: string, date: string, time?: string, extra: Partial<Task> = {}): Task {
  return withDeadline(makeTask({ id, title: id, ...extra }), makeDeadline({ date, time }));
}

function times(task: Task, prefs = PREFS, now = NOW) {
  return planTaskReminders(task, prefs, now, en).map((entry) => ({
    kind: entry.kind,
    at: new Date(entry.fireAt).toString().slice(0, 21),
  }));
}

describe("default reminder policy", () => {
  it("no deadline: no task reminder", () => {
    assert.deepEqual(planTaskReminders(makeTask({ id: "read" }), PREFS, NOW, en), []);
  });

  it("date-only deadline: 9:00 on the day, and nothing that claims a time", () => {
    const [reminder, ...rest] = planTaskReminders(dueTask("essay", "2026-10-15"), PREFS, NOW, en);
    assert.equal(rest.length, 0);
    assert.equal(reminder.kind, "due-day");
    const at = new Date(reminder.fireAt);
    assert.deepEqual([at.getDate(), at.getHours(), at.getMinutes()], [15, 9, 0]);
    assert.equal(reminder.title, "Due today: essay");
    assert.equal(reminder.body, "No set time — any time today works.");
    assert.equal(reminder.data.url, "/task/essay");
  });

  it("exact deadline: one reminder at the deadline itself, not at the morning reminder time", () => {
    const [reminder, ...rest] = planTaskReminders(dueTask("exam", "2026-10-15", "19:00"), PREFS, NOW, en);
    assert.equal(rest.length, 0);
    assert.equal(reminder.kind, "due-day");
    const at = new Date(reminder.fireAt);
    assert.deepEqual([at.getDate(), at.getHours(), at.getMinutes()], [15, 19, 0]);
    assert.equal(reminder.title, "Due now: exam");
    assert.match(reminder.body, /^Set for 7:00/);
    // Due before the morning reminder time — still reminded, at 8:00.
    assert.deepEqual(times(dueTask("early", "2026-10-15", "08:00")), [{ kind: "due-day", at: "Thu Oct 15 2026 08:00" }]);
  });

  it("a task due later today, added after the reminder time, is still reminded at its time", () => {
    // What the phone test hit: before, this got nothing at all.
    assert.deepEqual(times(dueTask("call", "2026-09-29", "18:00")), [{ kind: "due-day", at: "Tue Sep 29 2026 18:00" }]);
  });

  it("a date-only task added after 9:00 on its day gets no reminder — never a late burst", () => {
    assert.deepEqual(planTaskReminders(dueTask("today", "2026-09-29"), PREFS, NOW, en), []);
  });

  it("a deadline already passed gets nothing more", () => {
    assert.deepEqual(planTaskReminders(dueTask("late", "2026-09-20", "18:00"), { ...PREFS, overdueAlerts: true }, NOW, en), []);
  });

  it("completed, archived and muted tasks get none", () => {
    const task = dueTask("essay", "2026-10-15");
    assert.deepEqual(planTaskReminders({ ...task, status: "completed" }, PREFS, NOW, en), []);
    assert.deepEqual(planTaskReminders({ ...task, status: "archived" }, PREFS, NOW, en), []);
    assert.deepEqual(planTaskReminders({ ...task, reminders: { muted: true } }, PREFS, NOW, en), []);
    assert.deepEqual(planTaskReminders(task, { ...PREFS, deadlineReminders: false }, NOW, en), []);
  });
});

describe("user preferences", () => {
  it("offsets before an exact deadline; the reminder time only moves date-only reminders", () => {
    const prefs = { ...PREFS, dayReminderTime: "07:30", beforeOffsets: [60, 1440] };
    assert.deepEqual(times(dueTask("exam", "2026-10-15", "19:00"), prefs), [
      { kind: "before", at: "Wed Oct 14 2026 19:00" },
      { kind: "before", at: "Thu Oct 15 2026 18:00" },
      { kind: "due-day", at: "Thu Oct 15 2026 19:00" },
    ]);
    assert.deepEqual(times(dueTask("essay", "2026-10-15"), prefs), [{ kind: "due-day", at: "Thu Oct 15 2026 07:30" }]);
  });

  it("offsets only apply to deadlines with a time", () => {
    assert.deepEqual(times(dueTask("essay", "2026-10-15"), { ...PREFS, beforeOffsets: [15, 60] }), [
      { kind: "due-day", at: "Thu Oct 15 2026 09:00" },
    ]);
  });

  it("an extra reminder the day before, for high priority only", () => {
    const prefs = { ...PREFS, importantDayBefore: true };
    assert.deepEqual(times(dueTask("big", "2026-10-15", undefined, { importance: 75 }), prefs), [
      { kind: "day-before", at: "Wed Oct 14 2026 09:00" },
      { kind: "due-day", at: "Thu Oct 15 2026 09:00" },
    ]);
    assert.equal(times(dueTask("small", "2026-10-15", undefined, { importance: 50 }), prefs).length, 1);
  });

  it("overdue alerts fire as an exact deadline passes — never for a date-only one (no midnight alerts)", () => {
    const prefs = { ...PREFS, deadlineReminders: false, overdueAlerts: true };
    assert.deepEqual(times(dueTask("exam", "2026-10-15", "19:00"), prefs), [{ kind: "overdue", at: "Thu Oct 15 2026 19:00" }]);
    assert.deepEqual(times(dueTask("essay", "2026-10-15"), prefs), []);
  });

  it("with overdue alerts on, the alert takes the reminder's place at the deadline — one notification, not two", () => {
    const prefs = { ...PREFS, overdueAlerts: true };
    assert.deepEqual(times(dueTask("exam", "2026-10-15", "19:00"), prefs), [{ kind: "overdue", at: "Thu Oct 15 2026 19:00" }]);
  });

  it("two reminders for one task minutes apart are one too many", () => {
    // The day before at 9:00, and a day before 9:03 — three minutes apart.
    const prefs = { ...PREFS, importantDayBefore: true, beforeOffsets: [1440] };
    assert.deepEqual(times(dueTask("call", "2026-10-15", "09:03", { importance: 75 }), prefs), [
      { kind: "day-before", at: "Wed Oct 14 2026 09:00" },
      { kind: "due-day", at: "Thu Oct 15 2026 09:03" },
    ]);
  });
});

describe("daily planning note", () => {
  it("a week of notes at the chosen time, with what's due and where to start — separate from any deadline", () => {
    const tasks = [dueTask("Essay", "2026-09-30", undefined, { importance: 75 }), makeTask({ id: "Read" })];
    const notes = planNotifications(tasks, { ...PREFS, deadlineReminders: false, dailyPlanning: true, dailyPlanningTime: "08:00" }, NOW, en);
    assert.equal(notes.length, 6, "today's 08:00 has passed; the next six days");
    assert.ok(notes.every((note) => note.kind === "daily" && new Date(note.fireAt).getHours() === 8));
    assert.equal(notes[0].body, '1 task due today. Start with "Essay".');
    assert.match(notes[1].body, /^2 open tasks\./);
    // No reminder was invented for the task without a deadline.
    assert.ok(!notes.some((note) => note.taskId === "Read"));
  });

  it("nothing open, no note", () => {
    assert.deepEqual(planNotifications([], { ...PREFS, dailyPlanning: true }, NOW, en), []);
  });
});

describe("reconciling with what's scheduled", () => {
  it("the same plan twice changes nothing — no duplicates", () => {
    const plan = planNotifications([dueTask("essay", "2026-10-15")], PREFS, NOW, en);
    const scheduled = plan.map((entry) => ({ id: entry.id, signature: entry.data.signature }));
    assert.deepEqual(diffNotifications(plan, scheduled), { cancel: [], schedule: [] });
  });

  it("a moved deadline cancels the old reminder and schedules the new one, under the same id", () => {
    const task = dueTask("essay", "2026-10-15");
    const before = planNotifications([task], PREFS, NOW, en);
    const moved = editTaskDelta(task, { deadline: { date: "2026-10-20" } }, undefined, NOW, []).upserts[0];
    const after = planNotifications([moved], PREFS, NOW, en);
    const { cancel, schedule } = diffNotifications(after, before.map((entry) => ({ id: entry.id, signature: entry.data.signature })));
    assert.deepEqual(cancel, [before[0].id]);
    assert.equal(schedule.length, 1);
    assert.equal(schedule[0].id, before[0].id);
    assert.equal(new Date(schedule[0].fireAt).getDate(), 20);
  });

  it("completing, archiving or deleting a task cancels its reminders", () => {
    const task = dueTask("essay", "2026-10-15");
    const scheduled = planNotifications([task], PREFS, NOW, en).map((entry) => ({ id: entry.id, signature: entry.data.signature }));
    const completed = completeTaskDelta(task, NOW, [task]).upserts[0];
    assert.deepEqual(diffNotifications(planNotifications([completed], PREFS, NOW, en), scheduled).cancel, [scheduled[0].id]);
    const archived = archiveTaskDelta(task, NOW).upserts[0];
    assert.deepEqual(diffNotifications(planNotifications([archived], PREFS, NOW, en), scheduled).cancel, [scheduled[0].id]);
    assert.deepEqual(diffNotifications(planNotifications([], PREFS, NOW, en), scheduled).cancel, [scheduled[0].id]);
  });

  it("clears the overdue alerts scheduled before this engine, and leaves anything else alone", () => {
    const { cancel } = diffNotifications([], [{ id: "overdue-task-1" }, { id: "someone-elses" }]);
    assert.deepEqual(cancel, ["overdue-task-1"]);
  });

  it("stays within the platform's limit, soonest first", () => {
    const tasks = Array.from({ length: 80 }, (_, index) => dueTask(`t${index}`, `2026-10-${String(1 + (index % 28)).padStart(2, "0")}`));
    const plan = planNotifications(tasks, PREFS, NOW, en);
    assert.equal(plan.length, MAX_SCHEDULED);
    assert.ok(plan.every((entry, index) => index === 0 || plan[index - 1].fireAt <= entry.fireAt));
  });
});
