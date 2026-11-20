/// <reference types="node" />
// The home screen widget's data (lib/widgetData.ts): which task it shows and its label.
process.env.TZ = "Europe/Paris";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { makeDeadline, withDeadline } from "@/lib/deadline";
import { en } from "@/constants/translations/en";
import { buildWidgetData, pickWidgetTask, widgetDueLabel } from "@/lib/widgetData";
import type { Task } from "@/types/task";

import { local, makeTask } from "./helpers";

// Tuesday, Oct 6 2026, mid-morning.
const NOW = local(2026, 10, 6, 10);
const TODAY = "2026-10-06";

function due(id: string, date: string, extra: Partial<Task> = {}, time?: string): Task {
  return withDeadline(makeTask({ id, title: id, ...extra }), makeDeadline({ date, time }));
}

describe("pickWidgetTask", () => {
  it("shows a task due today ahead of a more urgent-looking one due later", () => {
    const tasks = [due("later", "2026-10-07", { importance: 100 }), due("today", TODAY, { importance: 20 })];
    assert.equal(pickWidgetTask(tasks, NOW, TODAY)?.id, "today");
  });

  it("falls back to the best open task when nothing is due today", () => {
    const tasks = [due("friday", "2026-10-09"), makeTask({ id: "someday" })];
    assert.ok(pickWidgetTask(tasks, NOW, TODAY));
  });

  it("never shows a finished task, and is empty with nothing open", () => {
    assert.equal(pickWidgetTask([due("done", TODAY, { status: "completed" })], NOW, TODAY), null);
  });

  it("leaves routines out, as Today does", () => {
    const routine = due("read", TODAY, {
      recurrence: {
        seriesId: "s",
        occurrenceDate: TODAY,
        rule: { frequency: "daily", interval: 1, anchorDate: TODAY, hour: 9, minute: 0, kind: "routine" },
        template: { title: "read", estimatedMinutes: 20, importance: 50 },
      },
    } as Partial<Task>);
    assert.equal(pickWidgetTask([routine], NOW, TODAY), null);
  });
});

describe("buildWidgetData", () => {
  it("signed out: no task, the sign-in words", () => {
    const data = buildWidgetData({ tasks: [due("a", TODAY)], signedIn: false, micLocked: true, now: NOW, today: TODAY, t: en });
    assert.equal(data.task, null);
    assert.equal(data.labels.signIn, en.widget.signIn);
  });

  it("carries the task's title, length and due day", () => {
    const data = buildWidgetData({ tasks: [due("Email the landlord", TODAY, {}, "19:00")], signedIn: true, micLocked: false, now: NOW, today: TODAY, t: en });
    assert.equal(data.task?.title, "Email the landlord");
    assert.equal(data.task?.dueKey, TODAY);
    assert.ok(data.task?.time);
    assert.ok(data.task?.length);
  });
});

describe("widgetDueLabel", () => {
  const data = (dueKey: string | null) =>
    buildWidgetData({ tasks: [dueKey ? due("x", dueKey) : makeTask({ id: "x" })], signedIn: true, micLocked: false, now: NOW, today: TODAY, t: en });

  it("Today, Overdue once the day has passed, the date for later", () => {
    assert.equal(widgetDueLabel(data(TODAY), TODAY).text, "Next · Today");
    const late = widgetDueLabel(data(TODAY), "2026-10-07");
    assert.deepEqual(late, { text: "Next · Overdue", overdue: true });
    assert.match(widgetDueLabel(data("2026-10-09"), TODAY).text, /^Next · .*9/);
    assert.equal(widgetDueLabel(data(null), TODAY).text, "Next");
  });
});
