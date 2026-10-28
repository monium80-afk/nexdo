/// <reference types="node" />
// A focus session's task list: taking a task out of the run keeps the focus
// on the task the user was working on.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { useSessionStore } from "@/store/useSessionStore";

function startOn(focused: string) {
  const taskIds = ["a", "b", "c", "d"];
  useSessionStore.getState().start({ taskIds, plannedMinutes: 25, energy: "ready" });
  useSessionStore.getState().focusTask(taskIds.indexOf(focused));
}

const focused = () => {
  const session = useSessionStore.getState().session!;
  return session.taskIds[session.activeIndex];
};

beforeEach(() => useSessionStore.setState({ session: null }));

describe("dropping a task from a focus session", () => {
  it("keeps the focus on the same task when one before it goes", () => {
    startOn("c");
    useSessionStore.getState().dropTask("a");
    assert.deepEqual(useSessionStore.getState().session?.taskIds, ["b", "c", "d"]);
    assert.equal(focused(), "c");
  });

  it("moves the focus on to the next task when the focused one goes, or back to the last", () => {
    startOn("c");
    useSessionStore.getState().dropTask("c");
    assert.equal(focused(), "d");
    useSessionStore.getState().dropTask("d");
    assert.equal(focused(), "b");
  });

  it("leaves the focus alone when a later task goes, or one that isn't in the run", () => {
    startOn("b");
    useSessionStore.getState().dropTask("d");
    useSessionStore.getState().dropTask("zzz");
    assert.deepEqual(useSessionStore.getState().session?.taskIds, ["a", "b", "c"]);
    assert.equal(focused(), "b");
  });

  it("ends the session when the last task goes", () => {
    useSessionStore.getState().start({ taskIds: ["a"], plannedMinutes: 25, energy: "ready" });
    useSessionStore.getState().dropTask("a");
    assert.equal(useSessionStore.getState().session, null);
  });
});
