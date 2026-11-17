/// <reference types="node" />
// A focus session's task list: taking a task out of the run keeps the focus
// on the task the user was working on.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { paceSamples } from "@/lib/pace";
import { useFocusLogStore } from "@/store/useFocusLogStore";
import { useSessionStore } from "@/store/useSessionStore";
import { useTaskStore } from "@/store/useTaskStore";

import { makeTask } from "./helpers";

function startOn(focused: string) {
  const taskIds = ["a", "b", "c", "d"];
  useSessionStore.getState().start({ taskIds, plannedMinutes: 25, energy: "ready" });
  useSessionStore.getState().focusTask(taskIds.indexOf(focused));
}

const focused = () => {
  const session = useSessionStore.getState().session!;
  return session.taskIds[session.activeIndex];
};

beforeEach(() => {
  useSessionStore.setState({ session: null });
  useTaskStore.setState({ tasks: [], syncUserId: null });
  useFocusLogStore.setState({ entries: [], completions: [] });
});

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

describe("logging focus spans when changing tasks", () => {
  it("logs each focused task separately when focusing and dropping tasks", () => {
    const userId = "focus-user";
    useTaskStore.setState({
      syncUserId: userId,
      tasks: [
        makeTask({ id: "a", estimatedMinutes: 10, status: "completed" }),
        makeTask({ id: "b", estimatedMinutes: 8, status: "completed" }),
        makeTask({ id: "c", estimatedMinutes: 5, status: "completed" }),
      ],
    });
    useSessionStore.getState().start({ taskIds: ["a", "b", "c"], plannedMinutes: 10, energy: "ready" });
    const started = useSessionStore.getState().session!;
    const beforeFocus = Date.now();
    useSessionStore.setState({
      session: {
        ...started,
        taskElapsedMs: 60_000,
        taskRunningSince: beforeFocus - 60_000,
      },
    });

    useSessionStore.getState().focusTask(1);
    const afterFocus = useSessionStore.getState().session!;
    assert.deepEqual(useFocusLogStore.getState().entries.map((entry) => [entry.taskId, entry.focusedMinutes]), [["a", 2]]);
    assert.equal(afterFocus.activeIndex, 1);
    assert.equal(afterFocus.runningSince, started.runningSince, "the session countdown keeps running");
    assert.equal(afterFocus.elapsedMs, started.elapsedMs, "focusing another task doesn't reset the countdown");
    assert.equal(afterFocus.taskEstimateMinutes, 8);

    const beforeDrop = Date.now();
    useSessionStore.setState({
      session: {
        ...afterFocus,
        taskElapsedMs: 60_000,
        taskRunningSince: beforeDrop - 60_000,
      },
    });
    useSessionStore.getState().dropTask("b");
    const afterDrop = useSessionStore.getState().session!;
    assert.deepEqual(
      useFocusLogStore.getState().entries.map((entry) => [entry.taskId, entry.focusedMinutes]),
      [
        ["a", 2],
        ["b", 2],
      ],
    );
    assert.equal(afterDrop.taskIds[afterDrop.activeIndex], "c");
    assert.equal(afterDrop.runningSince, started.runningSince, "dropping the focused task keeps the session countdown");

    const beforeLeave = Date.now();
    useSessionStore.setState({
      session: {
        ...afterDrop,
        taskElapsedMs: 0,
        taskRunningSince: beforeLeave - 60_000,
      },
    });
    useSessionStore.getState().leave();

    const entries = useFocusLogStore.getState().entries;
    assert.deepEqual(entries.map((entry) => [entry.taskId, entry.focusedMinutes, entry.estimateMinutes]), [
      ["a", 2, 10],
      ["b", 2, 8],
      ["c", 1, 5],
    ]);
    assert.deepEqual(
      paceSamples(entries).map((sample) => [sample.actual, sample.estimate]),
      [
        [2, 10],
        [2, 8],
        [1, 5],
      ],
    );
  });
});
