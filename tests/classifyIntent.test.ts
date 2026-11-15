/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyIntent } from "@/lib/ai/classifyIntent";
import { useSettingsStore } from "@/store/useSettingsStore";

async function classifyOffline(text: string) {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const previousConsent = useSettingsStore.getState().aiConsent;
  useSettingsStore.setState({ aiConsent: true });
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  console.warn = () => {};
  try {
    return await classifyIntent({ text, now: new Date("2026-11-15T12:00:00Z"), recentTaskIds: [], tasks: [] });
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
});
