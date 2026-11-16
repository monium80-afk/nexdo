/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { useTaskStore } from "@/store/useTaskStore";
import { useUndoStore } from "@/store/useUndoStore";

import { makeTask } from "./helpers";

beforeEach(() => {
  useUndoStore.setState({ toast: null });
  useTaskStore.setState({ tasks: [], syncUserId: "account-a" });
});

describe("undo toast account ownership", () => {
  it("does not restore snapshots after the active account changes", () => {
    const before = makeTask({ id: "shared-id", title: "Account A task" });
    useTaskStore.setState({
      tasks: [{ ...before, title: "Changed in account A", updatedAt: "2026-11-15T12:00:00.000Z" }],
      syncUserId: "account-a",
    });
    useUndoStore.getState().show("Undo change", [{ taskId: before.id, before }]);

    useTaskStore.setState({
      tasks: [makeTask({ id: "shared-id", title: "Account B task" })],
      syncUserId: "account-b",
    });
    useUndoStore.getState().undo();

    assert.equal(useTaskStore.getState().tasks[0].title, "Account B task");
    assert.equal(useUndoStore.getState().toast, null);
  });

  it("restores snapshots for the account that owns them", () => {
    const before = makeTask({ id: "task-a", title: "Before" });
    useTaskStore.setState({
      tasks: [{ ...before, title: "After", updatedAt: "2026-11-15T12:00:00.000Z" }],
      syncUserId: "account-a",
    });
    useUndoStore.getState().show("Undo change", [{ taskId: before.id, before }]);
    useUndoStore.getState().undo();

    assert.equal(useTaskStore.getState().tasks[0].title, "Before");
    assert.equal(useUndoStore.getState().toast, null);
  });
});
