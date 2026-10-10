/// <reference types="node" />
// End-to-end through the real stores: what reaches the (fake) database when
// tasks repeat, finish, expire and move in bulk — and the inbox route
// (onboarding's brain dump) when its model makes no progress or runs out of
// time. The AI chat that used to drive the route from here was removed on
// 2026-10-08.
process.env.TZ = "Europe/Paris";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { resolveInboxMessage, type InboxRequestBody } from "@/app/api/inbox+api";
import { GeminiTimeoutError } from "@/lib/ai/gemini";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTaskStore } from "@/store/useTaskStore";
import type { Task } from "@/types/task";

import { apiCalls } from "./stubs/api";
import { fakeDb } from "./stubs/supabase";

const USER = "user_1";
const DAY = 24 * 60 * 60 * 1000;

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

/** A local date `days` from today at hour:minute. */
function at(days: number, hour = 18, minute = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function task(id: string): Task | undefined {
  return useTaskStore.getState().tasks.find((candidate) => candidate.id === id);
}

function dbRow(id: string) {
  return fakeDb.rows("tasks").find((row) => row.id === id);
}

function seed(input: Parameters<ReturnType<typeof useTaskStore.getState>["addTask"]>[0]): string {
  return useTaskStore.getState().addTask(input);
}

beforeEach(async () => {
  fakeDb.reset();
  apiCalls.length = 0;
  useSettingsStore.setState({ language: "en" });
  useTaskStore.setState({ tasks: [], unsynced: {}, syncUserId: USER, ownerId: USER });
  await flush();
});

describe("repeating tasks in the store", () => {
  it("completing an occurrence saves it and creates the next one, once; reopening takes the next one back", async () => {
    const id = seed({ title: "Gym", estimatedMinutes: 60, priorityLevel: "medium", dueDate: at(1, 7), recurrence: { frequency: "weekly" } });
    await flush();
    const seriesId = task(id)!.recurrence!.seriesId;

    useTaskStore.getState().completeTask(id);
    await flush();
    const occurrences = useTaskStore.getState().tasks.filter((entry) => entry.recurrence?.seriesId === seriesId);
    assert.equal(occurrences.length, 2);
    const next = occurrences.find((entry) => entry.status === "pending")!;
    assert.match(next.id, new RegExp(`^${seriesId}@\\d{4}-\\d{2}-\\d{2}$`));
    assert.equal(new Date(next.dueDate!).getHours(), 7);
    assert.equal(Math.round((Date.parse(next.dueDate!) - Date.parse(task(id)!.dueDate!)) / DAY), 7);
    // Both rows went up in one request.
    assert.deepEqual(fakeDb.writes.at(-1), { table: "tasks", kind: "upsert", ids: [id, next.id] });
    assert.equal(dbRow(id)?.status, "completed");

    // Completing it again (a double tap, a replayed sync) creates nothing new.
    useTaskStore.getState().completeTask(id);
    await flush();
    assert.equal(useTaskStore.getState().tasks.filter((entry) => entry.recurrence?.seriesId === seriesId).length, 2);

    useTaskStore.getState().reopenTask(id);
    await flush();
    assert.equal(task(next.id), undefined);
    assert.equal(dbRow(next.id), undefined);
    assert.equal(task(id)?.status, "pending");
  });

  it("deleting one occurrence skips to the next; deleting the series removes every occurrence", async () => {
    const id = seed({ title: "Standup", estimatedMinutes: 15, priorityLevel: "medium", dueDate: at(1, 9), recurrence: { frequency: "daily" } });
    await flush();
    const seriesId = task(id)!.recurrence!.seriesId;
    useTaskStore.getState().deleteTask(id, "this");
    await flush();
    const remaining = useTaskStore.getState().tasks.filter((entry) => entry.recurrence?.seriesId === seriesId);
    assert.equal(remaining.length, 1);
    assert.notEqual(remaining[0].id, id);

    useTaskStore.getState().deleteTask(remaining[0].id, "series");
    await flush();
    assert.equal(useTaskStore.getState().tasks.length, 0);
    assert.equal(fakeDb.rows("tasks").length, 0);
  });
});

describe("finished tasks are deleted a week after they were completed", () => {
  it("deletes only the ones whose week is up, on the phone and in the database", async () => {
    const old = seed({ title: "Old", estimatedMinutes: 30, priorityLevel: "low" });
    const recent = seed({ title: "Recent", estimatedMinutes: 30, priorityLevel: "low" });
    const open = seed({ title: "Open", estimatedMinutes: 30, priorityLevel: "low" });
    useTaskStore.getState().executeOperation({ kind: "complete", target: { taskIds: [old] } }, new Date(Date.now() - 7 * DAY));
    useTaskStore.getState().executeOperation({ kind: "complete", target: { taskIds: [recent] } }, new Date(Date.now() - 7 * DAY + 60_000));
    await flush();

    assert.equal(useTaskStore.getState().deleteExpiredCompleted(), 1);
    await flush();
    assert.equal(task(old), undefined);
    assert.equal(dbRow(old), undefined);
    assert.equal(task(recent)?.status, "completed");
    assert.equal(task(open)?.status, "pending");
    assert.deepEqual(fakeDb.writes.at(-1), { table: "tasks", kind: "delete", ids: [old] });

    // Nothing left to delete: no request at all.
    fakeDb.writes = [];
    assert.equal(useTaskStore.getState().deleteExpiredCompleted(), 0);
    await flush();
    assert.deepEqual(fakeDb.writes, []);
  });

  it("reopening a task and finishing it again starts the week over", async () => {
    const id = seed({ title: "Report", estimatedMinutes: 30, priorityLevel: "medium" });
    useTaskStore.getState().executeOperation({ kind: "complete", target: { taskIds: [id] } }, new Date(Date.now() - 10 * DAY));
    useTaskStore.getState().reopenTask(id);
    // Open again, however long ago it was first finished.
    assert.equal(useTaskStore.getState().deleteExpiredCompleted(), 0);

    useTaskStore.getState().completeTask(id);
    await flush();
    assert.equal(useTaskStore.getState().deleteExpiredCompleted(new Date(Date.now() + 6 * DAY)), 0);
    assert.equal(task(id)?.status, "completed");
    assert.equal(useTaskStore.getState().deleteExpiredCompleted(new Date(Date.now() + 7 * DAY + 60_000)), 1);
    await flush();
    assert.equal(task(id), undefined);
    assert.equal(dbRow(id), undefined);
  });

  it("a finished occurrence of a repeating task goes; the open one stays", async () => {
    const id = seed({ title: "Gym", estimatedMinutes: 60, priorityLevel: "medium", dueDate: at(1, 7), recurrence: { frequency: "weekly" } });
    useTaskStore.getState().completeTask(id);
    await flush();

    assert.equal(useTaskStore.getState().deleteExpiredCompleted(new Date(Date.now() + 8 * DAY)), 1);
    await flush();
    const left = useTaskStore.getState().tasks;
    assert.equal(left.length, 1);
    assert.equal(left[0].status, "pending");
    assert.equal(fakeDb.rows("tasks").length, 1);
  });
});

describe("bulk operations reach the database in one request", () => {
  it("postponing every open task writes all of them together, and nothing else", async () => {
    const a = seed({ title: "Essay", estimatedMinutes: 90, priorityLevel: "high", dueDate: at(2) });
    const b = seed({ title: "Groceries", estimatedMinutes: 30, priorityLevel: "low", dueDate: at(3, 10, 30) });
    seed({ title: "Read", estimatedMinutes: 30, priorityLevel: "low" });
    const done = seed({ title: "Old", estimatedMinutes: 30, priorityLevel: "low", dueDate: at(-1) });
    useTaskStore.getState().completeTask(done);
    await flush();
    fakeDb.writes = [];

    useTaskStore.getState().executeOperation({ kind: "update", target: { filter: {} }, changes: { dueShift: { amount: 2, unit: "weeks" } } });
    await flush();
    assert.equal(fakeDb.writes.length, 1);
    assert.deepEqual([...fakeDb.writes[0].ids].sort(), [a, b].sort());
    assert.equal(new Date(dbRow(b)!.due_date as string).getHours(), 10);
  });
});

describe("AI Breakdown's confirmed steps", () => {
  const draft = (id: string, label: string, minutes: number, completed = false) => ({ id, label, estimatedMinutes: minutes, completed });

  it("become the task's steps exactly, in order — kept ids, new ones, one saved row", async () => {
    const id = seed({
      title: "Essay",
      estimatedMinutes: 90,
      priorityLevel: "high",
      steps: [
        { id: "outline", label: "Outline", estimatedMinutes: 30 },
        { id: "draft", label: "Draft", estimatedMinutes: 60 },
      ],
    });
    useTaskStore.getState().completeStep(id, "outline");
    await flush();
    fakeDb.writes = [];

    useTaskStore.getState().setSteps(id, [draft("outline", "Outline", 30, true), draft("new-1", "Intro", 20), draft("new-2", "Body", 40)]);
    await flush();
    const saved = task(id)!;
    assert.deepEqual(
      saved.subtasks!.map((step) => [step.id, step.status]),
      [["outline", "completed"], ["new-1", "current"], ["new-2", "pending"]],
    );
    assert.equal(saved.currentStepId, "new-1");
    assert.equal(saved.estimatedMinutes, 60, "the steps left, timed");
    assert.equal(saved.status, "pending");
    assert.equal(fakeDb.writes.length, 1);
  });

  it("with every step done, finish the task", async () => {
    const id = seed({ title: "Call", estimatedMinutes: 10, priorityLevel: "low", steps: [{ id: "dial", label: "Dial", estimatedMinutes: 10 }] });
    useTaskStore.getState().setSteps(id, [draft("dial", "Dial", 10, true)]);
    await flush();
    assert.equal(task(id)!.status, "completed");
    assert.equal(dbRow(id)?.status, "completed");
  });
});

describe("the inbox route, when the model makes no progress", () => {
  /** A model that adds a task per message it's given, handing the first message back whole, as if nothing of it were done. */
  function echoingModel(asked: string[]) {
    return async ({ userContent }: { userContent: string }) => {
      // The request JSON is the last line, after any language notes.
      const { message } = JSON.parse(userContent.split("\n").at(-1)!) as { message: string };
      asked.push(message);
      const title = message.replace(/^\w/, (letter) => letter.toUpperCase());
      return {
        intent: "create_task",
        action: { type: "CREATE_TASK", fields: { title }, confirmationRequired: true },
        remainingMessage: asked.length === 1 ? ` ${message.toUpperCase()} ` : null,
        reply: `Added ${title}.`,
      };
    };
  }

  const body = (message: string): InboxRequestBody => ({
    message,
    now: new Date().toISOString(),
    recentTaskIds: [],
    tasks: [],
    history: [],
    language: "en",
  });

  it("re-reads a compound message piece by piece instead of dropping the rest", async () => {
    const asked: string[] = [];
    const result = await resolveInboxMessage(body("buy milk, call mom"), echoingModel(asked) as never);
    assert.deepEqual(asked.slice(1).sort(), ["buy milk", "call mom"]);
    // The stuck turn's own "buy milk" is set aside, not added twice.
    assert.deepEqual(result.actions.map((entry) => entry.fields.title).sort(), ["Buy milk", "Call mom"]);
  });

  it("keeps the one action of a single instruction, with nothing more to look for", async () => {
    const asked: string[] = [];
    const result = await resolveInboxMessage(body("buy milk"), echoingModel(asked) as never);
    assert.deepEqual(asked, ["buy milk"]);
    assert.deepEqual(result.actions.map((entry) => entry.fields.title), ["Buy milk"]);
  });
});

describe("the inbox route, when time runs out", () => {
  it("answers with the apology (so the message is refunded) instead of re-sending every piece", async () => {
    let calls = 0;
    const deadlines = new Set<number>();
    const timingOut = async ({ deadline }: { deadline?: number }) => {
      calls += 1;
      if (deadline !== undefined) deadlines.add(deadline);
      throw new GeminiTimeoutError("no answer in time");
    };
    const result = await resolveInboxMessage(
      { message: "buy milk, call mom, book the dentist", now: new Date().toISOString(), recentTaskIds: [], tasks: [], history: [], language: "en" },
      timingOut as never,
    );
    assert.equal(calls, 1, "no recovery calls after a timeout");
    assert.equal(deadlines.size, 1, "the call was given the request's deadline");
    assert.equal(result.unavailable, true);
  });
});
