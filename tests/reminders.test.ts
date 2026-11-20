/// <reference types="node" />
// The reminder policy (lib/reminders.ts, reworked 2026-11-18): which
// notifications the phone should hold, and what the reconciler changes to get there.
process.env.TZ = "Europe/Paris";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { en } from "@/constants/translations/en";
import { makeDeadline, withDeadline } from "@/lib/deadline";
import {
  DEFAULT_REMINDER_PREFERENCES,
  diffNotifications,
  LEGACY_NOTIFICATION_ID_PREFIX,
  MAX_SCHEDULED,
  NOTIFICATION_ID_PREFIX,
  nextReminderFor,
  planNotifications,
  planTaskReminders,
  reminderBadge,
  shouldDismissPresentedNotification,
  type ReminderPreferences,
} from "@/lib/reminders";
import { applyReminderChange } from "@/lib/taskReminder";
import { archiveTaskDelta, completeTaskDelta, editTaskDelta } from "@/lib/taskOperations";
import type { Task } from "@/types/task";

import { local, makeTask } from "./helpers";

// Tuesday 29 September 2026, 10:00.
const NOW = local(2026, 9, 29, 10);
const PREFS: ReminderPreferences = { ...DEFAULT_REMINDER_PREFERENCES };

function dueTask(id: string, date: string, time?: string, extra: Partial<Task> = {}): Task {
  return withDeadline(makeTask({ id, title: id, ...extra }), makeDeadline({ date, time }));
}

/** A daily routine whose open occurrence is due on `date`. */
function routine(id: string, date: string, time?: string, extra: Partial<Task> = {}): Task {
  const [hour, minute] = time ? time.split(":").map(Number) : [0, 0];
  return dueTask(id, date, time, {
    recurrence: {
      seriesId: `series-${id}`,
      occurrenceDate: date,
      rule: { frequency: "daily", interval: 1, anchorDate: date, hour, minute, allDay: !time, kind: "routine" },
      template: { title: id, estimatedMinutes: 30, importance: 50 },
    },
    ...extra,
  });
}

function at(ms: number): string {
  return new Date(ms).toString().slice(0, 21);
}

function times(task: Task, prefs = PREFS, now = NOW) {
  return planTaskReminders(task, prefs, now, en).map((entry) => ({ kind: entry.kind, at: at(entry.fireAt) }));
}

describe("presented notification cleanup", () => {
  it("clears every app-owned notification only in explicit clear mode", () => {
    const openTaskIds = new Set(["open-task"]);
    assert.equal(shouldDismissPresentedNotification(`${NOTIFICATION_ID_PREFIX}summary`, undefined, openTaskIds), false);
    assert.equal(shouldDismissPresentedNotification(`${NOTIFICATION_ID_PREFIX}summary`, undefined, openTaskIds, true), true);
    assert.equal(shouldDismissPresentedNotification(`${NOTIFICATION_ID_PREFIX}task`, "open-task", openTaskIds, true), true);
    assert.equal(shouldDismissPresentedNotification(`${LEGACY_NOTIFICATION_ID_PREFIX}old`, undefined, openTaskIds), true);
    assert.equal(shouldDismissPresentedNotification("trial-end", undefined, openTaskIds, true), false);
  });
});

describe("tasks with a time", () => {
  it("one reminder at the start by default, saying when it starts and for how long", () => {
    const [reminder, ...rest] = planTaskReminders(dueTask("exam", "2026-10-15", "19:00"), PREFS, NOW, en);
    assert.equal(rest.length, 0);
    assert.equal(reminder.kind, "reminder");
    assert.equal(at(reminder.fireAt), "Thu Oct 15 2026 19:00");
    assert.equal(reminder.title, "exam starts now");
    assert.match(reminder.body, /^Starts at 7:00/);
    assert.equal(reminder.data.url, "/task/exam");
  });

  it("the Settings default lead applies, a task's own lead wins, and \"use my default\" goes back to it", () => {
    const task = dueTask("dentist", "2026-10-15", "15:00");
    assert.deepEqual(times(task, { ...PREFS, defaultLead: 15 }), [{ kind: "reminder", at: "Thu Oct 15 2026 14:45" }]);
    const own = { ...task, reminders: applyReminderChange(undefined, { lead: 1440 }) };
    assert.deepEqual(times(own, { ...PREFS, defaultLead: 15 }), [{ kind: "reminder", at: "Wed Oct 14 2026 15:00" }]);
    assert.equal(planTaskReminders(own, PREFS, NOW, en)[0].title, "dentist tomorrow");
    const back = { ...own, reminders: applyReminderChange(own.reminders, { lead: null }) };
    assert.deepEqual(times(back, { ...PREFS, defaultLead: 15 }), [{ kind: "reminder", at: "Thu Oct 15 2026 14:45" }]);
  });

  it("an alarm rings as an alarm — and without Pro, as a notification, its choice kept", () => {
    const task = dueTask("gym", "2026-10-15", "07:00", { reminders: { alarm: true, lead: 15 } });
    const [alarm] = planTaskReminders(task, PREFS, NOW, en);
    assert.equal(alarm.kind, "alarm");
    assert.equal(alarm.channel, "alarms");
    assert.equal(alarm.data.taskTitle, "gym");
    assert.equal(at(alarm.fireAt), "Thu Oct 15 2026 06:45");
    const [plain] = planTaskReminders(task, { ...PREFS, alarmsAllowed: false }, NOW, en);
    assert.equal(plain.kind, "reminder");
    assert.deepEqual(task.reminders, { alarm: true, lead: 15 });
  });

  it("a task set to Off gets nothing", () => {
    assert.deepEqual(planTaskReminders(dueTask("exam", "2026-10-15", "19:00", { reminders: { muted: true } }), PREFS, NOW, en), []);
  });

  it("a deadline already passed gets nothing more, and completed or archived tasks get none", () => {
    assert.deepEqual(planTaskReminders(dueTask("late", "2026-09-20", "18:00"), { ...PREFS, overdueAlerts: true }, NOW, en), []);
    const task = dueTask("exam", "2026-10-15", "19:00");
    assert.deepEqual(planTaskReminders({ ...task, status: "completed" }, PREFS, NOW, en), []);
    assert.deepEqual(planTaskReminders({ ...task, status: "archived" }, PREFS, NOW, en), []);
  });

  it("the overdue alert comes when the task should have been finished", () => {
    const task = dueTask("call", "2026-10-15", "15:00", { estimatedMinutes: 60 });
    assert.deepEqual(times(task, { ...PREFS, overdueAlerts: true }), [
      { kind: "reminder", at: "Thu Oct 15 2026 15:00" },
      { kind: "late", at: "Thu Oct 15 2026 16:00" },
    ]);
    const noLength = dueTask("pills", "2026-10-15", "15:00", { estimatedMinutes: 0 });
    assert.equal(times(noLength, { ...PREFS, overdueAlerts: true })[1].at, "Thu Oct 15 2026 15:15");
  });

  it("a daily routine with a time gets its next days' reminders too, under their own ids", () => {
    const plan = planTaskReminders(routine("read", "2026-09-29", "20:00", { reminders: { alarm: true } }), PREFS, NOW, en);
    assert.equal(plan.length, 8, "today plus a week ahead");
    assert.ok(plan.every((entry) => entry.kind === "alarm"));
    assert.equal(new Set(plan.map((entry) => entry.id)).size, plan.length);
    assert.equal(plan[0].taskId, "read");
    assert.equal(plan[1].taskId, undefined, "a day ahead isn't a task yet");
    assert.equal(plan[1].completable, false);
  });
});

describe("tasks without a time: the morning summary", () => {
  it("never a notification of their own", () => {
    assert.deepEqual(planTaskReminders(dueTask("essay", "2026-10-15"), PREFS, NOW, en), []);
  });

  it("five of them on one day are ONE summary, with the one to start with", () => {
    const tasks = ["Pay rent", "Call mom", "Buy groceries", "Laundry", "Email Sam"].map((title, index) =>
      dueTask(title, "2026-09-30", undefined, { importance: index === 0 ? 100 : 50 }),
    );
    const plan = planNotifications(tasks, PREFS, NOW, en).filter((entry) => entry.fireAt < local(2026, 10, 1).getTime());
    assert.equal(plan.length, 1);
    const [summary] = plan;
    assert.equal(summary.kind, "summary");
    assert.equal(at(summary.fireAt), "Wed Sep 30 2026 08:00");
    assert.equal(summary.title, "Your day is sorted. Start with Pay rent");
    assert.match(summary.body, /^Then .+ \+1\. The rest can wait\.$/);
  });

  it("lists the day's routines, and a day with only routines still gets one", () => {
    // Today's 8:00 has passed: the first summary is tomorrow's.
    const tasks = [dueTask("Pay rent", "2026-10-01"), routine("Vitamins", "2026-09-29")];
    const [sep30, oct1, oct2] = planNotifications(tasks, PREFS, NOW, en);
    assert.equal(sep30.title, "1 routine today");
    assert.equal(sep30.body, "Routines: Vitamins.");
    assert.equal(oct1.title, "Just one thing today: Pay rent");
    assert.equal(oct1.body, "Routines: Vitamins.");
    assert.equal(oct2.title, "Just one thing today: Pay rent", "still open the next morning, so still listed");
  });

  it("Off leaves a task out; the summary switch off sends none", () => {
    const off = dueTask("Pay rent", "2026-09-30", undefined, { reminders: { muted: true } });
    assert.deepEqual(planNotifications([off], PREFS, NOW, en), []);
    assert.deepEqual(planNotifications([dueTask("Pay rent", "2026-09-30")], { ...PREFS, morningSummary: false }, NOW, en), []);
  });

  it("Task Details shows the summary's time for a task without one", () => {
    const task = dueTask("essay", "2026-10-15");
    assert.equal(at(nextReminderFor(task, PREFS, NOW, en)!), "Thu Oct 15 2026 08:00");
    assert.equal(nextReminderFor(task, { ...PREFS, morningSummary: false }, NOW, en), null);
  });
});

describe("Settings switches", () => {
  it("the main switch off sends nothing — and on again brings back every task's own choice", () => {
    const tasks = [
      dueTask("gym", "2026-10-15", "07:00", { reminders: { alarm: true, lead: 15 } }),
      dueTask("call", "2026-10-15", "18:00", { reminders: { lead: 60 } }),
      dueTask("rent", "2026-10-15"),
    ];
    const before = planNotifications(tasks, PREFS, NOW, en);
    assert.deepEqual(planNotifications(tasks, { ...PREFS, enabled: false }, NOW, en), []);
    assert.deepEqual(planNotifications(tasks, PREFS, NOW, en), before);
    assert.deepEqual(tasks[0].reminders, { alarm: true, lead: 15 });
  });

  it("\"Tasks with a time\" off stops their reminders but not the summary", () => {
    const tasks = [dueTask("gym", "2026-09-30", "07:00"), dueTask("rent", "2026-09-30")];
    const plan = planNotifications(tasks, { ...PREFS, timedReminders: false }, NOW, en);
    assert.ok(plan.every((entry) => entry.kind === "summary"));
    assert.equal(plan[0].title, "Your day is sorted. Start with gym");
  });

  it("the card's sign: a bell, an alarm clock, or nothing", () => {
    assert.equal(reminderBadge(dueTask("a", "2026-10-15", "07:00"), PREFS), "notify");
    assert.equal(reminderBadge(dueTask("b", "2026-10-15", "07:00", { reminders: { alarm: true } }), PREFS), "alarm");
    assert.equal(reminderBadge(dueTask("b", "2026-10-15", "07:00", { reminders: { alarm: true } }), { ...PREFS, alarmsAllowed: false }), "notify");
    assert.equal(reminderBadge(dueTask("c", "2026-10-15"), PREFS), null);
    assert.equal(reminderBadge(dueTask("d", "2026-10-15", "07:00", { reminders: { muted: true } }), PREFS), null);
    assert.equal(reminderBadge(dueTask("e", "2026-10-15", "07:00"), { ...PREFS, enabled: false }), null);
  });
});

describe("reminders at the same minute", () => {
  it("become one notification naming the tasks; an alarm still rings on its own", () => {
    const tasks = [
      dueTask("Team call", "2026-10-15", "14:00"),
      dueTask("Send the invoice", "2026-10-15", "14:00"),
      dueTask("Pick up the package", "2026-10-15", "14:00"),
      dueTask("Gym", "2026-10-15", "14:00", { reminders: { alarm: true } }),
    ];
    const plan = planNotifications(tasks, { ...PREFS, morningSummary: false }, NOW, en);
    assert.equal(plan.length, 2);
    const group = plan.find((entry) => entry.kind === "group")!;
    assert.equal(group.title, "3 tasks at 2:00 PM");
    assert.equal(group.body, "Team call, Send the invoice, Pick up the package");
    assert.ok(plan.some((entry) => entry.kind === "alarm"));
  });
});

describe("reconciling with what's scheduled", () => {
  it("the same plan twice changes nothing — no duplicates", () => {
    const plan = planNotifications([dueTask("essay", "2026-10-15", "19:00")], PREFS, NOW, en);
    const scheduled = plan.map((entry) => ({ id: entry.id, signature: entry.data.signature }));
    assert.deepEqual(diffNotifications(plan, scheduled), { cancel: [], schedule: [] });
  });

  it("a moved deadline cancels the old reminder and schedules the new one, under the same id", () => {
    const task = dueTask("essay", "2026-10-15", "19:00");
    const before = planTaskReminders(task, PREFS, NOW, en);
    const moved = editTaskDelta(task, { deadline: { date: "2026-10-20", time: "19:00" } }, undefined, NOW, []).upserts[0];
    const after = planTaskReminders(moved, PREFS, NOW, en);
    const { cancel, schedule } = diffNotifications(after, before.map((entry) => ({ id: entry.id, signature: entry.data.signature })));
    assert.deepEqual(cancel, [before[0].id]);
    assert.equal(schedule.length, 1);
    assert.equal(schedule[0].id, before[0].id);
    assert.equal(new Date(schedule[0].fireAt).getDate(), 20);
  });

  it("switching a task to an alarm reschedules it", () => {
    const task = dueTask("gym", "2026-10-15", "07:00");
    const before = planTaskReminders(task, PREFS, NOW, en).map((entry) => ({ id: entry.id, signature: entry.data.signature }));
    const alarm = editTaskDelta(task, { reminder: { mode: "alarm" } }, undefined, NOW, []).upserts[0];
    assert.deepEqual(alarm.reminders, { alarm: true });
    const { cancel, schedule } = diffNotifications(planTaskReminders(alarm, PREFS, NOW, en), before);
    assert.deepEqual(cancel, [before[0].id]);
    assert.equal(schedule[0].kind, "alarm");
  });

  it("completing, archiving or deleting a task cancels its reminders", () => {
    const task = dueTask("essay", "2026-10-15", "19:00");
    const scheduled = planTaskReminders(task, PREFS, NOW, en).map((entry) => ({ id: entry.id, signature: entry.data.signature }));
    const completed = completeTaskDelta(task, NOW, [task]).upserts[0];
    assert.deepEqual(diffNotifications(planTaskReminders(completed, PREFS, NOW, en), scheduled).cancel, [scheduled[0].id]);
    const archived = archiveTaskDelta(task, NOW).upserts[0];
    assert.deepEqual(diffNotifications(planTaskReminders(archived, PREFS, NOW, en), scheduled).cancel, [scheduled[0].id]);
  });

  it("clears the overdue alerts scheduled before this engine, and leaves anything else alone", () => {
    const { cancel } = diffNotifications([], [{ id: "overdue-task-1" }, { id: "someone-elses" }, { id: "alarm-snooze-x" }]);
    assert.deepEqual(cancel, ["overdue-task-1"]);
  });

  it("stays within the platform's limit, soonest first", () => {
    const tasks = Array.from({ length: 80 }, (_, index) =>
      dueTask(`t${index}`, `2026-10-${String(1 + (index % 28)).padStart(2, "0")}`, `${String(8 + (index % 12)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}`),
    );
    const plan = planNotifications(tasks, PREFS, NOW, en);
    assert.equal(plan.length, MAX_SCHEDULED);
    assert.ok(plan.every((entry, index) => index === 0 || plan[index - 1].fireAt <= entry.fireAt));
  });
});
