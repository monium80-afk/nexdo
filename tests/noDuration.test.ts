/// <reference types="node" />
// Tasks with no duration — a goal kept up through the day ("drink 2 L of
// water") rather than a sitting of work. Stored as 0 minutes; nothing along
// the way may turn that into a made-up length.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { formatTaskLength } from "@/lib/formatDuration";
import { createLiveToolRunner, type LiveToolCall } from "@/lib/liveVoiceTools";
import { effortScore, urgencyScore } from "@/lib/priority";
import { templateFromTask } from "@/lib/recurrence";
import { editTaskDelta, reopenTaskDelta } from "@/lib/taskOperations";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTaskStore } from "@/store/useTaskStore";

import { makeTask } from "./helpers";

const NOW = new Date(2026, 9, 8, 10, 0);

beforeEach(() => {
  useSettingsStore.setState({ language: "en" });
  useTaskStore.setState({ tasks: [], unsynced: {}, syncUserId: null, ownerId: null });
});

describe("a task with no duration", () => {
  it("reads as such wherever a length is shown", () => {
    assert.equal(formatTaskLength(0), "No duration");
    assert.equal(formatTaskLength(45), "45 mins");
  });

  it("can be set on purpose, and given a length again", () => {
    const water = makeTask({ id: "water", estimatedMinutes: 30 });
    const [cleared] = editTaskDelta(water, { estimatedMinutes: 0 }, undefined, NOW, [water]).upserts;
    assert.equal(cleared.estimatedMinutes, 0);

    const [lengthened] = editTaskDelta(cleared, { estimatedMinutesDelta: 15 }, undefined, NOW, [cleared]).upserts;
    assert.equal(lengthened.estimatedMinutes, 15);
  });

  it("taking time off a real length never lands on no duration", () => {
    const call = makeTask({ id: "call", estimatedMinutes: 10 });
    const [shorter] = editTaskDelta(call, { estimatedMinutesDelta: -30 }, undefined, NOW, [call]).upserts;
    assert.equal(shorter.estimatedMinutes, 1);
  });

  it("keeps none when it repeats, and when it's reopened", () => {
    assert.equal(templateFromTask(makeTask({ id: "steps", estimatedMinutes: 0 })).estimatedMinutes, 0);

    const done = makeTask({ id: "done", estimatedMinutes: 0, status: "completed", completedAt: NOW.toISOString() });
    const [reopened] = reopenTaskDelta(done, NOW, [done]).upserts;
    assert.equal(reopened.estimatedMinutes, 0);
  });

  it("scores as average effort, with no work taken off the time it has left", () => {
    const due = new Date(2026, 9, 9, 23, 59).toISOString();
    assert.equal(effortScore({ dueDate: due, estimatedMinutes: 0, importance: 50 }), 50);
    assert.equal(
      urgencyScore({ dueDate: due, estimatedMinutes: 0, importance: 50 }, NOW),
      urgencyScore({ dueDate: due, estimatedMinutes: 0.0001, importance: 50 }, NOW),
    );
  });

  it("Magic mic adds one with no duration when the model says 0, instead of guessing a length", () => {
    const runner = createLiveToolRunner(new Map());
    const call: LiveToolCall = { id: "c1", name: "add_task", args: { title: "Drink 2 L of water", estimatedMinutes: 0 } };
    assert.equal(runner.run(call).ok, true);
    assert.equal(useTaskStore.getState().tasks.find((task) => task.title === "Drink 2 L of water")?.estimatedMinutes, 0);
  });
});
