/// <reference types="node" />
// What a focus session reports as it ends, and what finishing a task reports:
// one end event per session, so a funnel from `session_started` can tell
// finished sessions from abandoned ones.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { useSessionStore } from "@/store/useSessionStore";
import { useTaskStore } from "@/store/useTaskStore";

import { captured } from "./stubs/noop";

const MINUTE = 60_000;

/** A running session on `taskIds` that started `minutesAgo` minutes ago. */
function runFor(taskIds: string[], plannedMinutes: number, minutesAgo: number) {
  useSessionStore.getState().start({ taskIds, plannedMinutes, energy: "ready" });
  useSessionStore.setState((state) => ({
    session: state.session && { ...state.session, runningSince: Date.now() - minutesAgo * MINUTE },
  }));
  captured.length = 0;
}

const events = (name: string) => captured.filter((entry) => entry.event === name);

beforeEach(() => {
  useSessionStore.setState({ session: null });
  useTaskStore.setState({ tasks: [], unsynced: {}, syncUserId: null, ownerId: null });
  captured.length = 0;
});

describe("a focus session's end", () => {
  it("reports a session stopped before its time as ended early", () => {
    runFor(["a"], 25, 10);
    useSessionStore.getState().leave();
    assert.deepEqual(captured, [
      {
        event: "session_ended",
        properties: { outcome: "ended_early", elapsed_minutes: 10, planned_minutes: 25, task_count: 1 },
      },
    ]);
  });

  it("reports a session whose clock ran its full time as completed", () => {
    runFor(["a"], 25, 30);
    useSessionStore.getState().leave();
    assert.deepEqual(events("session_completed").map((entry) => entry.properties?.outcome), ["time_up"]);
    assert.equal(events("session_ended").length, 0);
  });

  it("reports a session whose task was finished in it as completed", () => {
    runFor(["a"], 25, 5);
    useSessionStore.getState().leave("task_completed");
    assert.deepEqual(captured, [
      {
        event: "session_completed",
        properties: { outcome: "task_completed", elapsed_minutes: 5, planned_minutes: 25, task_count: 1 },
      },
    ]);
  });

  it("reports nothing when there is no session to leave", () => {
    useSessionStore.getState().leave();
    assert.equal(captured.length, 0);
  });

  it("reports the old session when a new one replaces it, or its last task is dropped", () => {
    runFor(["a"], 25, 3);
    useSessionStore.getState().start({ taskIds: ["b"], plannedMinutes: 25, energy: "ready" });
    useSessionStore.getState().dropTask("b");
    assert.deepEqual(events("session_ended").map((entry) => entry.properties?.elapsed_minutes), [3, 0]);
  });
});

describe("finishing a task", () => {
  it("reports the time spent on it when a session was running on it", () => {
    const id = useTaskStore.getState().addTask({ title: "Write report", estimatedMinutes: 30, priorityLevel: "medium" });
    runFor([id], 30, 12);
    useTaskStore.getState().completeTask(id);
    assert.deepEqual(events("task_completed"), [
      { event: "task_completed", properties: { had_session: true, minutes_in_session: 12 } },
    ]);
  });

  it("reports it without a session, and only once", () => {
    const id = useTaskStore.getState().addTask({ title: "Call the bank", estimatedMinutes: 10, priorityLevel: "low" });
    useTaskStore.getState().completeTask(id);
    useTaskStore.getState().completeTask(id);
    assert.deepEqual(events("task_completed"), [
      { event: "task_completed", properties: { had_session: false, minutes_in_session: 0 } },
    ]);
  });

  it("reports it when ticking the last step finishes the task", () => {
    const id = useTaskStore.getState().addTask({
      title: "Pack",
      estimatedMinutes: 10,
      priorityLevel: "low",
      steps: [{ id: "s1", label: "Clothes", estimatedMinutes: 10 }],
    });
    const stepId = useTaskStore.getState().tasks.find((task) => task.id === id)!.subtasks![0].id;
    captured.length = 0;
    useTaskStore.getState().completeStep(id, stepId);
    assert.equal(events("task_completed").length, 1);
  });
});
