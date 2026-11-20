/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyIntent } from "@/lib/ai/classifyIntent";
import { useSettingsStore } from "@/store/useSettingsStore";
import type { Task } from "@/types/task";

import { makeTask } from "./helpers";

async function classifyOffline(text: string, tasks: Task[] = []) {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const previousConsent = useSettingsStore.getState().aiConsent;
  useSettingsStore.setState({ aiConsent: true });
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  console.warn = () => {};
  try {
    return await classifyIntent({ text, now: new Date("2026-11-15T12:00:00Z"), recentTaskIds: [], tasks });
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    useSettingsStore.setState({ aiConsent: previousConsent });
  }
}

describe("offline bulk deletion classification", () => {
  it("limits overdue deletion to overdue tasks", async () => {
    const result = await classifyOffline("delete all overdue tasks");
    const action = result.actions[0];
    assert.equal(action.type, "OPERATE");
    if (action.type === "OPERATE") {
      assert.deepEqual(action.operation.target, { filter: { status: "overdue" } });
    }
  });

  it("asks for clarification when it cannot represent an added qualifier", async () => {
    const result = await classifyOffline("delete all overdue tasks assigned to school");
    assert.equal(result.actions[0].type, "CLARIFY");
  });

  it("preserves an unqualified request to delete all tasks", async () => {
    const result = await classifyOffline("delete all my tasks");
    const action = result.actions[0];
    assert.equal(action.type, "OPERATE");
    if (action.type === "OPERATE") {
      assert.deepEqual(action.operation.target, { filter: { status: "all" } });
    }
  });

  it("recognizes a task-creation request before a destructive verb in its title", async () => {
    const result = await classifyOffline("create a task to delete Pay rent");
    const action = result.actions[0];
    assert.equal(action.type, "CREATE_TASK");
    if (action.type === "CREATE_TASK") assert.equal(action.drafts[0].title, "Delete Pay rent");
  });

  it("keeps a direct destructive command on the delete path", async () => {
    const task = makeTask({ id: "rent", title: "Pay rent" });
    const result = await classifyOffline("delete Pay rent", [task]);
    const action = result.actions[0];
    assert.equal(action.type, "OPERATE");
    if (action.type === "OPERATE") {
      assert.deepEqual(action.operation, { kind: "delete", target: { taskIds: ["rent"] } });
    }
  });

  it("does not turn a failed reopen or negated completion into a completion", async () => {
    const result = await classifyOffline("Report is not done", [makeTask({ id: "report", title: "Report", status: "pending" })]);
    assert.equal(result.actions[0].type, "UNKNOWN");
  });

  it("reopens a completed referenced task", async () => {
    const result = await classifyOffline("Report is not done", [makeTask({ id: "report", title: "Report", status: "completed" })]);
    const action = result.actions[0];
    assert.equal(action.type, "OPERATE");
    if (action.type === "OPERATE") assert.equal(action.operation.kind, "reopen");
  });
});

describe("offline bulk completion classification", () => {
  it("keeps overdue scope and clarifies qualifiers it cannot represent", async () => {
    const overdue = await classifyOffline("mark all overdue tasks as done");
    const action = overdue.actions[0];
    assert.equal(action.type, "OPERATE");
    if (action.type === "OPERATE") assert.deepEqual(action.operation.target, { filter: { status: "overdue" } });

    const unclear = await classifyOffline("mark all high priority tasks as done");
    assert.equal(unclear.actions[0].type, "CLARIFY");
  });

  it("keeps the unqualified request to complete all pending tasks", async () => {
    for (const text of ["mark all tasks as done", "I finished everything"]) {
      const result = await classifyOffline(text);
      const action = result.actions[0];
      assert.equal(action.type, "OPERATE");
      if (action.type === "OPERATE") assert.deepEqual(action.operation.target, { filter: { status: "pending" } });
    }
  });
});
