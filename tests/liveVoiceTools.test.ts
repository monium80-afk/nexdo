/// <reference types="node" />
// Live voice's tool calls carried out on the real task store: what each call
// changes, the id the model gets back for "that", the guards against the
// duplicates Gemini Live was seen producing, and undo.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { createLiveToolRunner, type LiveToolCall } from "@/lib/liveVoiceTools";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTaskStore } from "@/store/useTaskStore";

let callNumber = 0;
function call(name: string, args: Record<string, unknown> = {}): LiveToolCall {
  callNumber += 1;
  return { id: `call_${callNumber}`, name, args };
}

function tasks() {
  return useTaskStore.getState().tasks;
}

function byTitle(title: string) {
  return tasks().find((task) => task.title === title);
}

/** "Gym" on the list as t1, and a runner that knows it by that id. */
function withGym() {
  const gym = useTaskStore.getState().addTask({ title: "Gym", estimatedMinutes: 60, priorityLevel: "medium" });
  return { gym, runner: createLiveToolRunner(new Map([["t1", gym]])) };
}

beforeEach(() => {
  useSettingsStore.setState({ language: "en", aiAutoMode: false });
  useTaskStore.setState({ tasks: [], unsynced: {}, syncUserId: null, ownerId: null });
});

describe("live voice tools", () => {
  it("adds a task with its deadline worked out on the phone, and gives it the next id", () => {
    const { runner } = withGym();
    const result = runner.run(call("add_task", { title: "Call mom", dueDatePhrase: "tomorrow at 6 pm" }));
    assert.deepEqual(result, { ok: true, taskId: "t2" });

    const task = byTitle("Call mom")!;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const due = new Date(task.dueDate!);
    assert.equal(due.getDate(), tomorrow.getDate());
    assert.equal(due.getHours(), 18);
  });

  it("follows up on the task it just added: \"actually make that Thursday\"", () => {
    // The weekday three days from now, not always Thursday: on a Wednesday
    // "tomorrow" is Thursday already, and the follow-up rightly changes nothing.
    const target = new Date();
    target.setDate(target.getDate() + 3);
    const weekday = target.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();

    const { runner } = withGym();
    runner.run(call("add_task", { title: "Call mom", dueDatePhrase: "tomorrow at 6 pm" }));
    assert.deepEqual(runner.run(call("update_task", { taskId: "t2", dueDatePhrase: weekday })), { ok: true, taskId: "t2" });
    const due = new Date(byTitle("Call mom")!.dueDate!);
    assert.equal(due.getDay(), target.getDay());
    assert.equal(due.getHours(), 18, "keeps the time it already had");
  });

  it("never adds a second copy of a task already on the list", () => {
    const { runner } = withGym();
    const result = runner.run(call("add_task", { title: "gym!" }));
    assert.deepEqual(result, { ok: true, taskId: "t1", note: "Already on the list — nothing added." });
    assert.equal(tasks().length, 1);
  });

  it("ignores the same call made again straight away, even with its arguments reordered", () => {
    const { runner, gym } = withGym();
    runner.run(call("add_task", { title: "Call mom", dueDatePhrase: "tomorrow at 6 pm" }));
    runner.run(call("add_task", { dueDatePhrase: "tomorrow at 6 pm", title: "Call mom" }));
    assert.equal(tasks().length, 2);

    const first = runner.run(call("complete_task", { taskId: "t1" }));
    const echo = runner.run(call("complete_task", { taskId: "t1" }));
    assert.deepEqual(echo, first, "the echo gets the first answer, not 'already completed'");
    assert.equal(tasks().find((task) => task.id === gym)?.status, "completed");
    assert.equal(runner.undoCount(), 2, "two changes, not three");
  });

  it("adds a task again after it was undone, however soon — that's not an echo", () => {
    const { runner } = withGym();
    runner.run(call("add_task", { title: "Buy milk" }));
    runner.run(call("undo_last_change"));
    assert.equal(byTitle("Buy milk"), undefined);
    assert.equal(runner.run(call("add_task", { title: "Buy milk" })).ok, true);
    assert.ok(byTitle("Buy milk"));

    // The same after the Undo button.
    runner.undo();
    assert.equal(byTitle("Buy milk"), undefined);
    runner.run(call("add_task", { title: "Buy milk" }));
    assert.ok(byTitle("Buy milk"));
  });

  it("completes a task again after it was reopened, however soon", () => {
    const { runner, gym } = withGym();
    runner.run(call("complete_task", { taskId: "t1" }));
    runner.run(call("reopen_task", { taskId: "t1" }));
    runner.run(call("complete_task", { taskId: "t1" }));
    assert.equal(tasks().find((task) => task.id === gym)?.status, "completed");
    assert.equal(runner.undoCount(), 3);
  });

  it("completes, reopens, notes and deletes by id", () => {
    const { runner, gym } = withGym();
    runner.run(call("complete_task", { taskId: "t1" }));
    assert.equal(tasks().find((task) => task.id === gym)?.status, "completed");
    runner.run(call("reopen_task", { taskId: "t1" }));
    assert.equal(tasks().find((task) => task.id === gym)?.status, "pending");
    runner.run(call("add_note", { taskId: "t1", note: "Leg day, bring the knee brace" }));
    assert.deepEqual(tasks().find((task) => task.id === gym)?.aiContext.notes, ["Leg day, bring the knee brace"]);
    runner.run(call("delete_task", { taskId: "t1" }));
    assert.equal(tasks().length, 0);
  });

  it("undoes one change at a time, latest first — from the button or said out loud", () => {
    const { runner } = withGym();
    runner.run(call("add_task", { title: "Buy milk" }));
    runner.run(call("delete_task", { taskId: "t1" }));
    assert.deepEqual(tasks().map((task) => task.title), ["Buy milk"]);

    assert.deepEqual(runner.run(call("undo_last_change")), { ok: true });
    assert.deepEqual(tasks().map((task) => task.title).sort(), ["Buy milk", "Gym"]);
    assert.equal(runner.undo(), true);
    assert.deepEqual(tasks().map((task) => task.title), ["Gym"]);
    assert.deepEqual(runner.run(call("undo_last_change")), { ok: false, error: "Nothing to undo." });
  });

  it("\"undo, undo\" undoes twice", () => {
    const { runner } = withGym();
    runner.run(call("add_task", { title: "Buy milk" }));
    runner.run(call("add_task", { title: "Buy bread" }));
    runner.run(call("undo_last_change"));
    runner.run(call("undo_last_change"));
    assert.deepEqual(tasks().map((task) => task.title), ["Gym"]);
  });

  it("changes nothing for an id it never gave out", () => {
    const { runner } = withGym();
    assert.deepEqual(runner.run(call("delete_task", { taskId: "t99" })), { ok: false, error: "No task with that id — nothing changed." });
    assert.equal(tasks().length, 1);
    assert.equal(runner.undoCount(), 0);
  });

  it("reports an edit that changes nothing, and keeps no undo for it", () => {
    const { runner } = withGym();
    const result = runner.run(call("reopen_task", { taskId: "t1" }));
    assert.equal(result.ok, false);
    assert.equal(runner.undoCount(), 0);
  });

  it("reads a repeat rule with weekday names", () => {
    const { runner } = withGym();
    runner.run(call("add_task", { title: "Team standup", dueDatePhrase: "monday at 9 am", repeat: { frequency: "weekly", weekdays: ["mon", "wed"] } }));
    assert.deepEqual(byTitle("Team standup")?.recurrence?.rule.weekdays, [1, 3]);
  });

  it("refuses an unknown tool and a task with no title", () => {
    const { runner } = withGym();
    assert.equal(runner.run(call("launch_rocket")).ok, false);
    assert.equal(runner.run(call("add_task", { title: "  " })).ok, false);
    assert.equal(tasks().length, 1);
  });
});
