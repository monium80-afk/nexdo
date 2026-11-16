/// <reference types="node" />
// The task system end to end, through the real stores and a fake database:
// what's saved; AI updates from Task Details; archiving; repeating tasks on
// launch and sync. tests/ai-eval-reassess.ts checks the real model separately.
process.env.TZ = "Europe/Paris";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { normalizeReassessment, parseReassessBody, type ReassessResponseBody } from "@/app/api/reassess+api";
import { en } from "@/constants/translations/en";
import { makeDeadline, withDeadline } from "@/lib/deadline";
import { toLocalDateKey } from "@/lib/localDate";
import { recommendTasks } from "@/lib/priority";
import { normalizeRule, startSeries } from "@/lib/recurrence";
import { DEFAULT_REMINDER_PREFERENCES, planNotifications } from "@/lib/reminders";
import { matchesFilter } from "@/lib/taskOperations";
import { recalcAll } from "@/lib/taskPipeline";
import { useReassessStore } from "@/store/useReassessStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTaskStore } from "@/store/useTaskStore";
import type { Task } from "@/types/task";

import { makeTask } from "./helpers";
import { apiCalls, setApiHandler } from "./stubs/api";
import { fakeDb } from "./stubs/supabase";

const USER = "user_1";

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

const tasks = () => useTaskStore.getState().tasks;
const dbRow = (id: string) => fakeDb.rows("tasks").find((row) => row.id === id);

function dayKey(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return toLocalDateKey(date);
}

beforeEach(async () => {
  fakeDb.reset();
  apiCalls.length = 0;
  useSettingsStore.setState({ language: "en" });
  useTaskStore.setState({ tasks: [], unsynced: {}, syncUserId: USER, ownerId: USER });
  useReassessStore.setState({ byTask: {} });
  await flush();
});

describe("saving a new task", () => {
  it("a date-only deadline is saved date-only, into its own columns", async () => {
    const id = useTaskStore.getState().addTask({ title: "Study chemistry", estimatedMinutes: 120, priorityLevel: "high", deadline: { date: dayKey(1) } });
    await flush();
    const saved = tasks().find((task) => task.id === id)!;
    assert.deepEqual([saved.deadline?.date, saved.deadline?.time], [dayKey(1), undefined]);
    const row = dbRow(saved.id)!;
    assert.deepEqual([row.deadline_date, row.deadline_time, row.deadline_timezone], [dayKey(1), null, "Europe/Paris"]);
  });

  it("a save the database refuses is kept on the phone to retry", async () => {
    fakeDb.nextError = { code: "500", message: "database unavailable" };
    const id = useTaskStore.getState().addTask({ title: "Study chemistry", estimatedMinutes: 120, priorityLevel: "high" });
    await flush();
    assert.ok(id in useTaskStore.getState().unsynced, "kept to retry");
    assert.equal(dbRow(id), undefined);
  });
});

describe("AI updates from Task Details keep the same task", () => {
  const NO_FIELDS: Omit<ReassessResponseBody, "outcome" | "summary"> = {
    question: null,
    title: null,
    description: null,
    dueDatePhrase: null,
    dueDateShift: null,
    removeDeadline: false,
    stepsDone: [],
    steps: null,
    estimatedMinutes: null,
    priority: null,
    advice: null,
  };

  function reassessAnswers(answer: Partial<ReassessResponseBody>) {
    setApiHandler((path, body) => {
      assert.equal(path, "/api/reassess");
      assert.ok(parseReassessBody(JSON.parse(JSON.stringify(body))));
      return normalizeReassessment({ ...NO_FIELDS, summary: "", ...answer });
    });
  }

  function seed(task: Task) {
    useTaskStore.setState({ tasks: recalcAll([task]) });
  }

  it('"the exam moved to October 15" moves a date-only deadline to that day — still date-only, same id', async () => {
    seed(withDeadline(makeTask({ id: "chem", title: "Study chemistry", importance: 50 }), makeDeadline({ date: dayKey(20) })));
    reassessAnswers({ outcome: "update", dueDatePhrase: "October 15", summary: "The exam is earlier." });
    await useReassessStore.getState().submit("chem", { text: "My professor moved the exam to October 15." });
    const saved = tasks().find((task) => task.id === "chem")!;
    assert.equal(tasks().length, 1);
    assert.match(saved.deadline!.date, /-10-15$/);
    assert.equal(saved.deadline!.time, undefined);
    assert.equal(saved.importance, 50, "importance untouched");
  });

  it("a longer estimate changes the length and nothing else", async () => {
    seed(withDeadline(makeTask({ id: "essay", title: "Essay", importance: 75, estimatedMinutes: 60 }), makeDeadline({ date: dayKey(5) })));
    reassessAnswers({ outcome: "update", estimatedMinutes: 240, summary: "More research." });
    await useReassessStore.getState().submit("essay", { text: "It's going to take about four hours." });
    const saved = tasks()[0];
    assert.deepEqual([saved.estimatedMinutes, saved.importance, saved.deadline?.date], [240, 75, dayKey(5)]);
  });

  it("removing the deadline clears it — and its reminders", async () => {
    seed(withDeadline(makeTask({ id: "trip", title: "Plan trip" }), makeDeadline({ date: dayKey(5) })));
    reassessAnswers({ outcome: "update", removeDeadline: true, summary: "No date any more." });
    await useReassessStore.getState().submit("trip", { text: "There's no deadline for this any more." });
    const saved = tasks()[0];
    assert.equal(saved.deadline, undefined);
    assert.equal(saved.dueDate, undefined);
    assert.deepEqual(planNotifications([saved], DEFAULT_REMINDER_PREFERENCES, new Date(), en), []);
  });
});

describe("archiving", () => {
  it("an archived task leaves the list, the recommendations and the reminders — and comes back on restore", async () => {
    const id = useTaskStore.getState().addTask({ title: "Old idea", estimatedMinutes: 30, priorityLevel: "medium", deadline: { date: dayKey(3) } });
    useTaskStore.getState().archiveTask(id);
    await flush();
    const archived = tasks()[0];
    assert.equal(archived.status, "archived");
    assert.equal(dbRow(id)?.status, "archived");
    assert.ok(dbRow(id)?.closed_at);
    const now = new Date();
    assert.equal(matchesFilter(archived, { status: "all" }, now), false);
    assert.deepEqual(recommendTasks(tasks(), { now }), []);
    assert.deepEqual(planNotifications(tasks(), DEFAULT_REMINDER_PREFERENCES, now, en), []);

    useTaskStore.getState().restoreTask(id);
    await flush();
    assert.equal(tasks()[0].status, "pending");
    assert.equal(tasks()[0].closedAt, undefined);
  });
});

describe("repeating tasks on launch and sync", () => {
  it("opening the app again and again, and re-syncing, never duplicates an occurrence", async () => {
    const rule = normalizeRule({ frequency: "daily", interval: 1, anchorDate: dayKey(-3), hour: 18, minute: 0, allDay: true, missed: "skip" })!;
    const first = startSeries(makeTask({ id: "habit", title: "Memorize Qur'an", createdAt: new Date(Date.now() - 4 * 86_400_000).toISOString() }), rule, "series-habit");
    useTaskStore.setState({ tasks: recalcAll([first]) });

    assert.equal(useTaskStore.getState().applyMissedOccurrences(), 2);
    assert.equal(useTaskStore.getState().applyMissedOccurrences(), 0);
    assert.equal(useTaskStore.getState().applyMissedOccurrences(), 0);
    await flush();

    const ids = tasks().map((task) => task.id).sort();
    assert.deepEqual(ids, ["habit", `series-habit@${dayKey(0)}`]);
    assert.equal(tasks().find((task) => task.id === "habit")?.status, "skipped");

    // A sync brings back the same rows: still one of each.
    await useTaskStore.getState().hydrateFromSupabase(USER);
    assert.deepEqual(tasks().map((task) => task.id).sort(), ids);
    assert.equal(fakeDb.rows("tasks").length, 2);
  });
});
