/// <reference types="node" />
// Deadlines: what a phrase means, how it's stored, and how it's shown.
// Europe/Paris, so the October clock change (2026-10-25) is in range.
process.env.TZ = "Europe/Paris";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isAmbiguousDate, looksLikeDate, parseDateRange, parseDeadlinePhrase } from "@/lib/ai/parseDate";
import {
  applyPickedDateTime,
  deadlineFromDate,
  deadlineFromInstant,
  deadlineInstant,
  formatDeadline,
  makeDeadline,
  reconcileDeadline,
  shiftDeadline,
  withDeadline,
} from "@/lib/deadline";
import { editTaskDelta, isOverdue } from "@/lib/taskOperations";
import { getDueInfo } from "@/lib/taskMeta";
import { buildTask } from "@/store/useTaskStore";

import { local, makeTask } from "./helpers";

// Tuesday 29 September 2026, 10:00 in Paris — every relative phrase below is read against this.
const NOW = local(2026, 9, 29, 10);

describe("reading a deadline phrase (device-side, explicit reference time)", () => {
  it("a day without a time is a date-only deadline — no hour is invented", () => {
    assert.deepEqual(parseDeadlinePhrase("October 15", NOW), { date: "2026-10-15", time: undefined });
    assert.deepEqual(parseDeadlinePhrase("tomorrow", NOW), { date: "2026-09-30", time: undefined });
    assert.deepEqual(parseDeadlinePhrase("next Monday", NOW), { date: "2026-10-05", time: undefined });
    assert.deepEqual(parseDeadlinePhrase("in two weeks", NOW), { date: "2026-10-13", time: undefined });
  });

  it('"next <day>" is that day of next week, which runs Monday to Sunday', () => {
    // A Tuesday: next week's Tuesday and Friday, not this week's.
    assert.deepEqual(parseDeadlinePhrase("next Tuesday", NOW), { date: "2026-10-06", time: undefined });
    assert.deepEqual(parseDeadlinePhrase("next Friday", NOW), { date: "2026-10-09", time: undefined });
    // A Saturday: Monday is the day after tomorrow; tomorrow is still this week's Sunday.
    const saturday = local(2026, 10, 3, 10);
    assert.deepEqual(parseDeadlinePhrase("next Monday", saturday), { date: "2026-10-05", time: undefined });
    assert.deepEqual(parseDeadlinePhrase("next Saturday", saturday), { date: "2026-10-10", time: undefined });
    assert.deepEqual(parseDeadlinePhrase("next Sunday", saturday), { date: "2026-10-11", time: undefined });
    assert.deepEqual(parseDeadlinePhrase("lundi prochain", saturday, "fr"), { date: "2026-10-05", time: undefined });
    // Without "next", the next one to come.
    assert.deepEqual(parseDeadlinePhrase("Monday", saturday), { date: "2026-10-05", time: undefined });
    assert.deepEqual(parseDeadlinePhrase("Saturday", saturday), { date: "2026-10-10", time: undefined });
  });

  it("a day with a time is an exact deadline", () => {
    assert.deepEqual(parseDeadlinePhrase("October 15 at 7 PM", NOW), { date: "2026-10-15", time: "19:00" });
    assert.deepEqual(parseDeadlinePhrase("next Friday at 14:30", NOW), { date: "2026-10-09", time: "14:30" });
  });

  it('"in six days" counts from the reference date, in the user\'s time zone', () => {
    assert.deepEqual(parseDeadlinePhrase("in six days", NOW), { date: "2026-10-05", time: undefined });
    // "for two hours" is a duration, not a time — still date-only.
    assert.deepEqual(parseDeadlinePhrase("in six days for two hours", NOW), { date: "2026-10-05", time: undefined });
    // Late in the evening "tomorrow" is still the next local day, whatever UTC says.
    assert.deepEqual(parseDeadlinePhrase("tomorrow", local(2026, 9, 29, 23, 30)), { date: "2026-09-30", time: undefined });
  });

  it("a clock time keeps its minutes, with or without a day beside it", () => {
    assert.deepEqual(parseDeadlinePhrase("dentist tomorrow 9:30", NOW), { date: "2026-09-30", time: "09:30" });
    assert.deepEqual(parseDeadlinePhrase("meeting 17:30", NOW), { date: "2026-09-29", time: "17:30" });
    // Already past at 10:00: tomorrow.
    assert.deepEqual(parseDeadlinePhrase("standup 09:15", NOW), { date: "2026-09-30", time: "09:15" });
    assert.deepEqual(parseDeadlinePhrase("call mom at 7", NOW), { date: "2026-09-29", time: "19:00" });
  });

  it('a lone "3:16" with no day is a reference, not a deadline', () => {
    assert.equal(parseDeadlinePhrase("Read John 3:16", NOW), undefined);
    assert.equal(parseDeadlinePhrase("revise page 4:12", NOW), undefined);
  });

  it("a relative amount of hours is an exact moment", () => {
    assert.deepEqual(parseDeadlinePhrase("in 2 hours", NOW), { date: "2026-09-29", time: "12:00" });
  });

  it("a date that reads two ways is not guessed", () => {
    assert.equal(parseDeadlinePhrase("3/4", NOW), undefined);
    assert.equal(isAmbiguousDate("due 3/4"), true);
    // Only one way to read these.
    assert.deepEqual(parseDeadlinePhrase("10/15", NOW), { date: "2026-10-15", time: undefined });
    assert.deepEqual(parseDeadlinePhrase("15/10/2026", NOW), { date: "2026-10-15", time: undefined });
    assert.equal(isAmbiguousDate("10/15"), false);
  });

  it("tells a date it can't read from words that aren't a date at all", () => {
    assert.equal(looksLikeDate("the 3rd week of term"), true);
    assert.equal(looksLikeDate("soon"), false);
  });

  it("a date already gone stays in the past (overdue), not moved to today", () => {
    assert.deepEqual(parseDeadlinePhrase("September 20", NOW), { date: "2026-09-20", time: undefined });
  });

  it("a year the user said is kept, not replaced by the nearest one", () => {
    assert.deepEqual(parseDeadlinePhrase("March 5, 2028", NOW), { date: "2028-03-05", time: undefined });
    assert.deepEqual(parseDeadlinePhrase("5 March 2028 at 7 PM", NOW), { date: "2028-03-05", time: "19:00" });
    assert.deepEqual(parseDeadlinePhrase("the 3rd of October 2027", NOW), { date: "2027-10-03", time: undefined });
    assert.deepEqual(parseDeadlinePhrase("bis 03.10.2027", NOW, "de"), { date: "2027-10-03", time: undefined });
    assert.deepEqual(parseDeadlinePhrase("el 5 de marzo de 2028", NOW, "es"), { date: "2028-03-05", time: undefined });
    assert.deepEqual(parseDeadlinePhrase("le 5 mars 2028", NOW, "fr"), { date: "2028-03-05", time: undefined });
    // Without one, a month already gone this year is still next year's.
    assert.deepEqual(parseDeadlinePhrase("March 5", NOW), { date: "2027-03-05", time: undefined });
  });
});

describe("reading a filter's date range", () => {
  // Friday is 2 October, Monday 5 October.
  it('"before" and "after" leave the named day out', () => {
    assert.deepEqual(parseDateRange("before friday", NOW), { to: new Date(2026, 9, 1, 23, 59, 59, 999).toISOString() });
    assert.deepEqual(parseDateRange("after monday", NOW), { from: local(2026, 10, 6).toISOString() });
  });

  it('"by", "until" and "from" keep it', () => {
    assert.deepEqual(parseDateRange("by friday", NOW), { to: new Date(2026, 9, 2, 23, 59, 59, 999).toISOString() });
    assert.deepEqual(parseDateRange("until friday", NOW), { to: new Date(2026, 9, 2, 23, 59, 59, 999).toISOString() });
    assert.deepEqual(parseDateRange("from monday", NOW), { from: local(2026, 10, 5).toISOString() });
  });
});

describe("the stored deadline", () => {
  it("no deadline stays no deadline — nothing is filled in", () => {
    const task = buildTask({ title: "Read 20 pages", estimatedMinutes: 30, priorityLevel: "medium" }, NOW);
    assert.equal(task.deadline, undefined);
    assert.equal(task.dueDate, undefined);
    assert.equal(getDueInfo(task, NOW).pillLabel, "No deadline");
    assert.equal(getDueInfo(task, NOW).tone, "upcoming");
  });

  it("a date-only deadline is its day: due by the end of it, shown without a time", () => {
    const task = buildTask(
      { title: "Assignment", estimatedMinutes: 60, priorityLevel: "medium", deadline: { date: "2026-10-15" } },
      NOW,
    );
    assert.equal(task.deadline?.date, "2026-10-15");
    assert.equal(task.deadline?.time, undefined);
    assert.equal(task.deadline?.timeZone, "Europe/Paris");
    const due = new Date(task.dueDate!);
    assert.deepEqual([due.getDate(), due.getHours(), due.getMinutes()], [15, 23, 59]);
    const label = getDueInfo(task, local(2026, 10, 12, 9)).pillLabel;
    assert.equal(label, "Due Thursday");
    assert.equal(getDueInfo(task, NOW).tone, "upcoming");
    assert.equal(getDueInfo(task, local(2026, 10, 12, 9)).tone, "urgent");
    assert.doesNotMatch(label, /\d:\d\d/);
    // Not overdue during its own day.
    assert.equal(isOverdue(task, local(2026, 10, 15, 22)), false);
    assert.equal(isOverdue(task, local(2026, 10, 16, 0, 1)), true);
  });

  it("an exact deadline keeps its time, and shows it", () => {
    const task = buildTask(
      { title: "Assignment", estimatedMinutes: 60, priorityLevel: "medium", deadline: { date: "2026-10-15", time: "19:00" } },
      NOW,
    );
    assert.equal(task.deadline?.time, "19:00");
    assert.equal(new Date(task.dueDate!).getHours(), 19);
    assert.match(getDueInfo(task, local(2026, 10, 12, 9)).pillLabel, /^Due Thursday at 7:00/);
    assert.match(formatDeadline(task.deadline!, "en-US"), /Oct 15, 7:00/);
    assert.doesNotMatch(formatDeadline({ date: "2026-10-15" }, "en-US"), /:/);
  });

  it("an AI draft with no time said is saved date-only", () => {
    const task = buildTask(
      { title: "Essay", estimatedMinutes: 60, priorityLevel: "medium", dueDate: local(2026, 10, 15, 18).toISOString(), dueHasTime: false },
      NOW,
    );
    assert.deepEqual([task.deadline?.date, task.deadline?.time], ["2026-10-15", undefined]);
  });

  it("a past deadline is kept as it is, and overdue", () => {
    const task = buildTask(
      { title: "Late", estimatedMinutes: 30, priorityLevel: "medium", deadline: { date: "2026-09-20" } },
      NOW,
    );
    assert.equal(task.deadline?.date, "2026-09-20");
    assert.equal(isOverdue(task, NOW), true);
    assert.equal(getDueInfo(task, NOW).pillLabel, "Due 9 days ago");
  });

  it("classifies approaching, due-today and exact-time deadlines by the current time", () => {
    const approaching = buildTask(
      { title: "Soon", estimatedMinutes: 30, priorityLevel: "medium", deadline: { date: "2026-10-03" } },
      NOW,
    );
    const dueToday = buildTask(
      { title: "Today", estimatedMinutes: 30, priorityLevel: "medium", deadline: { date: "2026-09-29" } },
      NOW,
    );
    const passedThisMorning = buildTask(
      { title: "Passed", estimatedMinutes: 30, priorityLevel: "medium", deadline: { date: "2026-09-29", time: "09:00" } },
      NOW,
    );

    assert.equal(getDueInfo(approaching, NOW).tone, "urgent");
    assert.equal(getDueInfo(dueToday, NOW).tone, "today");
    assert.equal(getDueInfo(passedThisMorning, NOW).tone, "overdue");
  });

  it("an exact deadline set in another zone stays the same instant here", () => {
    const deadline = makeDeadline({ date: "2026-10-15", time: "19:00" }, "America/New_York")!;
    // 19:00 in New York (EDT, UTC−4) is 01:00 the next day in Paris (CEST, UTC+2).
    assert.equal(deadlineInstant(deadline).toISOString(), "2026-10-15T23:00:00.000Z");
  });
});

describe("reading older and other-device data", () => {
  it("a task with only dueDate (before date-only deadlines) keeps the exact time it always showed", () => {
    const legacy = makeTask({ id: "old", dueDate: local(2026, 10, 1, 18).toISOString() });
    const task = reconcileDeadline(legacy);
    assert.deepEqual([task.deadline?.date, task.deadline?.time], ["2026-10-01", "18:00"]);
    assert.equal(task.dueDate, legacy.dueDate);
  });

  it("a dueDate moved by something that didn't know about the deadline wins", () => {
    const task = withDeadline(makeTask({ id: "t" }), makeDeadline({ date: "2026-10-15" }));
    const movedByOldApp = { ...task, dueDate: local(2026, 10, 20, 18).toISOString() };
    assert.deepEqual(reconcileDeadline(movedByOldApp).deadline?.date, "2026-10-20");
    const removedByOldApp = { ...task, dueDate: undefined };
    assert.equal(reconcileDeadline(removedByOldApp).deadline, undefined);
  });

  it("an exact deadline set in another zone and moved an hour by an older app keeps the move", () => {
    const task = withDeadline(makeTask({ id: "t" }), makeDeadline({ date: "2026-10-20", time: "09:00" }, "America/New_York"));
    const anHourLater = new Date(Date.parse(task.dueDate!) + 60 * 60 * 1000).toISOString();
    const reconciled = reconcileDeadline({ ...task, dueDate: anHourLater });
    assert.equal(reconciled.dueDate, anHourLater);
    // 10:00 in New York is 16:00 here in Paris.
    assert.deepEqual([reconciled.deadline?.date, reconciled.deadline?.time], ["2026-10-20", "16:00"]);
    // Untouched, it stays New York's 9:00.
    assert.deepEqual(reconcileDeadline(task).deadline, task.deadline);
  });

  it("a date-only deadline saved in another zone isn't mistaken for a moved one", () => {
    const task = withDeadline(makeTask({ id: "t" }), makeDeadline({ date: "2026-10-20" }, "America/New_York"));
    // The phone that saved it ended the day six hours after this one does.
    const savedThere = new Date(Date.parse(task.dueDate!) + 6 * 60 * 60 * 1000).toISOString();
    assert.deepEqual(reconcileDeadline({ ...task, dueDate: savedThere }).deadline, task.deadline);
  });

  it("a consistent deadline is left exactly as it is", () => {
    const task = withDeadline(makeTask({ id: "t" }), makeDeadline({ date: "2026-10-15" }));
    assert.deepEqual(reconcileDeadline(task).deadline, task.deadline);
    assert.equal(reconcileDeadline(task).dueDate, task.dueDate);
  });
});

describe("changing a deadline", () => {
  it("moving a date-only deadline to another day keeps it date-only; one with a time keeps its time", () => {
    const dateOnly = withDeadline(makeTask({ id: "a" }), makeDeadline({ date: "2026-10-20" }));
    const moved = editTaskDelta(dateOnly, { deadline: { date: "2026-10-15" }, keepTimeOfDay: true }, undefined, NOW, []).upserts[0];
    assert.deepEqual([moved.deadline?.date, moved.deadline?.time], ["2026-10-15", undefined]);

    const exact = withDeadline(makeTask({ id: "b" }), makeDeadline({ date: "2026-10-20", time: "09:30" }));
    const movedExact = editTaskDelta(exact, { deadline: { date: "2026-10-15" }, keepTimeOfDay: true }, undefined, NOW, []).upserts[0];
    assert.deepEqual([movedExact.deadline?.date, movedExact.deadline?.time], ["2026-10-15", "09:30"]);
  });

  it("removing a deadline clears both fields", () => {
    const task = withDeadline(makeTask({ id: "a" }), makeDeadline({ date: "2026-10-20" }));
    const cleared = editTaskDelta(task, { deadline: null }, undefined, NOW, []).upserts[0];
    assert.equal(cleared.deadline, undefined);
    assert.equal(cleared.dueDate, undefined);
  });

  it("shifting keeps the wall-clock time across the clock change, and a date-only one only moves by whole days", () => {
    const exact = makeDeadline({ date: "2026-10-20", time: "09:00" })!;
    const week = shiftDeadline(exact, { amount: 1, unit: "weeks" })!;
    assert.deepEqual([week.date, week.time], ["2026-10-27", "09:00"]);
    assert.equal(new Date(deadlineInstant(week)).getHours(), 9);

    const dateOnly = makeDeadline({ date: "2026-10-20" })!;
    assert.equal(shiftDeadline(dateOnly, { amount: 2, unit: "hours" }), null);
    assert.equal(shiftDeadline(dateOnly, { amount: 48, unit: "hours" })?.date, "2026-10-22");
  });

  it("picking just another day on iOS's date-and-time spinner keeps a date-only deadline date-only", () => {
    // A date-only deadline shows as the end of its day.
    const endOfDay = new Date(2026, 9, 15, 23, 59, 59, 999);
    const anotherDay = applyPickedDateTime(endOfDay, new Date(2026, 9, 17, 23, 59), "both", false);
    assert.equal(anotherDay.hasTime, false);
    assert.deepEqual(deadlineFromDate(anotherDay.date, anotherDay.hasTime), { date: "2026-10-17", timeZone: "Europe/Paris" });

    // No deadline yet: the spinner opened at the time the card appeared, which nobody chose either.
    const opened = new Date(2026, 9, 1, 14, 37, 12);
    assert.equal(applyPickedDateTime(opened, new Date(2026, 9, 20, 14, 37), "both", false).hasTime, false);

    // Turning the time is choosing one.
    const atNine = applyPickedDateTime(endOfDay, new Date(2026, 9, 17, 9, 0), "both", false);
    assert.equal(atNine.hasTime, true);
    assert.deepEqual([atNine.date.getDate(), atNine.date.getHours(), atNine.date.getMinutes()], [17, 9, 0]);
  });

  it("on Android's separate dialogs, a day keeps the time it had and a time sets one", () => {
    const exact = new Date(2026, 9, 15, 9, 30);
    const moved = applyPickedDateTime(exact, new Date(2026, 9, 18, 0, 0), "date", true);
    assert.deepEqual([moved.date.getDate(), moved.date.getHours(), moved.date.getMinutes(), moved.hasTime], [18, 9, 30, true]);
    const timed = applyPickedDateTime(new Date(2026, 9, 15, 23, 59), new Date(2026, 0, 1, 18, 15), "time", false);
    assert.deepEqual([timed.date.getDate(), timed.date.getHours(), timed.date.getMinutes(), timed.hasTime], [15, 18, 15, true]);
  });

  it("an instant from a picker is read as an exact deadline", () => {
    assert.deepEqual(deadlineFromInstant(local(2026, 10, 3, 8, 15).toISOString()), {
      date: "2026-10-03",
      time: "08:15",
      timeZone: "Europe/Paris",
    });
  });
});
