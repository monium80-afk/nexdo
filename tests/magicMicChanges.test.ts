/// <reference types="node" />
// Magic mic's cards and its Discard, read off the task list: the list as it
// was when the mic opened against the list now (lib/magicMicChanges.ts) —
// for the tasks the mic itself changed, and only those.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { changedTaskIds, discardSnapshots, micChanges } from "@/lib/magicMicChanges";
import type { Subtask, Task } from "@/types/task";

import { makeTask } from "./helpers";

const gym = makeTask({ id: "gym", title: "Gym", updatedAt: "2026-10-31T08:00:00.000Z" });
const report = makeTask({ id: "report", title: "Report", updatedAt: "2026-10-31T08:00:00.000Z" });
const call = makeTask({ id: "call", title: "Call Mom", updatedAt: "2026-10-31T08:00:00.000Z" });

const baselineOf = (tasks: Task[]) => new Map(tasks.map((task) => [task.id, task]));

const steps = (): Subtask[] => [
  { id: "s1", label: "Outline", estimatedMinutes: 10, order: 0, status: "current" },
  { id: "s2", label: "Draft", estimatedMinutes: 20, order: 1, status: "pending" },
];

describe("Magic mic's cards", () => {
  it("shows nothing until something changes — a recalculated score doesn't count", () => {
    const baseline = baselineOf([gym, report]);
    const rescored = [{ ...gym, priorityScore: gym.priorityScore + 5 }, report];
    assert.deepEqual(micChanges(baseline, rescored, new Map(), ["gym", "report"]), []);
    assert.deepEqual(changedTaskIds([gym, report], rescored), []);
  });

  it("marks what was added, changed, finished and removed, latest change on top", () => {
    const baseline = baselineOf([gym, report, call]);
    const added = makeTask({ id: "new", title: "Buy milk" });
    const moved = { ...report, updatedAt: "2026-10-31T09:00:00.000Z" };
    const done = { ...call, status: "completed" as const, updatedAt: "2026-10-31T09:01:00.000Z" };
    const now = [added, moved, done]; // the gym task was deleted
    const changedAt = new Map([
      ["report", 1],
      ["call", 2],
      ["gym", 3],
      ["new", 4],
    ]);

    const cards = micChanges(baseline, now, changedAt, ["report", "call", "gym", "new"]);
    assert.deepEqual(
      cards.map((card) => [card.task.id, card.mark]),
      [
        ["new", "added"],
        ["gym", "removed"],
        ["call", "completed"],
        ["report", "updated"],
      ],
    );
    // A removed task is drawn as it was.
    assert.equal(cards[1].task, gym);
  });

  it("treats a skipped occurrence as gone from the list", () => {
    const skipped = { ...gym, status: "skipped" as const, updatedAt: "2026-10-31T09:00:00.000Z" };
    const cards = micChanges(baselineOf([gym]), [skipped], new Map(), ["gym"]);
    assert.deepEqual(cards.map((card) => card.mark), ["removed"]);
  });

  it("has no card for a change that was undone", () => {
    const baseline = baselineOf([gym]);
    assert.deepEqual(micChanges(baseline, [gym], new Map([["gym", 1]]), ["gym"]), []);
  });

  // The user's report, 2026-11-02: cards for tasks nobody spoke about.
  it("shows only what the mic did — not what moved underneath it", () => {
    const withSteps = { ...report, subtasks: steps() };
    const baseline = baselineOf([gym, withSteps, call]);
    const added = makeTask({ id: "new", title: "Buy milk" });
    // Edited on another device while the mic was open.
    const elsewhere = { ...call, title: "Call Mom back", updatedAt: "2026-10-31T09:05:00.000Z" };
    // Synced in from another device.
    const synced = makeTask({ id: "synced", title: "Water plants" });
    const now = [added, synced, gym, withSteps, elsewhere];
    const cards = micChanges(baseline, now, new Map(), ["new"]);
    assert.deepEqual(cards.map((card) => [card.task.id, card.mark]), [["new", "added"]]);
  });

  it("isn't fooled by a re-read of the account: same moment, same steps, new copies", () => {
    const withSteps = { ...report, subtasks: steps() };
    const baseline = baselineOf([withSteps, gym]);
    // The database writes the time as "+00:00", and every step list comes back as a new array.
    const reread = [
      { ...withSteps, updatedAt: "2026-10-31T08:00:00+00:00", subtasks: steps() },
      { ...gym, updatedAt: "2026-10-31T08:00:00.000+00:00" },
    ];
    // Even for tasks the mic touched, nothing actually differs.
    assert.deepEqual(micChanges(baseline, reread, new Map(), ["report", "gym"]), []);
    assert.deepEqual(changedTaskIds([withSteps, gym], reread), []);
  });

  it("still sees a real change to the steps", () => {
    const withSteps = { ...report, subtasks: steps() };
    const ticked = {
      ...withSteps,
      subtasks: steps().map((step) => (step.id === "s1" ? { ...step, status: "completed" as const } : step)),
    };
    const cards = micChanges(baselineOf([withSteps]), [ticked], new Map(), ["report"]);
    assert.deepEqual(cards.map((card) => card.mark), ["updated"]);
  });
});

describe("Named tasks", () => {
  it("shows a task the user only named, unchanged, newest on top", () => {
    const baseline = baselineOf([gym, report, call]);
    const added = makeTask({ id: "new", title: "Buy milk" });
    const now = [added, gym, report, call];
    const cards = micChanges(baseline, now, new Map([["new", 10]]), ["new"], [
      { taskId: "gym", at: 5 },
      { taskId: "report", at: 20 },
    ]);
    assert.deepEqual(
      cards.map((card) => [card.task.id, card.mark]),
      [
        ["report", "shown"],
        ["new", "added"],
        ["gym", "shown"],
      ],
    );
    assert.equal(cards[0].task, report);
  });

  it("lets a change to a named task win over its plain card", () => {
    const moved = { ...report, updatedAt: "2026-10-31T09:00:00.000Z" };
    const cards = micChanges(baselineOf([report]), [moved], new Map([["report", 30]]), ["report"], [
      { taskId: "report", at: 20 },
    ]);
    assert.deepEqual(cards.map((card) => card.mark), ["updated"]);
  });

  it("never brings a named task into Discard", () => {
    assert.deepEqual(discardSnapshots(baselineOf([gym]), [gym], []), []);
  });
});

describe("Discard", () => {
  it("puts back every change and takes away what was added", () => {
    const baseline = baselineOf([gym, report]);
    const added = makeTask({ id: "new", title: "Buy milk" });
    const moved = { ...report, updatedAt: "2026-10-31T09:00:00.000Z" };
    const snapshots = discardSnapshots(baseline, [moved, added], ["report", "new", "gym"]);
    assert.deepEqual(
      snapshots.map((snapshot) => [snapshot.taskId, snapshot.before?.updatedAt ?? null]),
      [
        ["report", report.updatedAt],
        ["new", null],
        ["gym", gym.updatedAt],
      ],
    );
  });

  it("has nothing to do when nothing changed", () => {
    assert.deepEqual(discardSnapshots(baselineOf([gym]), [gym], ["gym"]), []);
  });

  it("leaves alone what the mic didn't do", () => {
    const baseline = baselineOf([gym, report]);
    const added = makeTask({ id: "new", title: "Buy milk" });
    const elsewhere = { ...report, updatedAt: "2026-10-31T09:00:00.000Z" };
    const synced = makeTask({ id: "synced", title: "Water plants" });
    const snapshots = discardSnapshots(baseline, [added, synced, elsewhere], ["new"]);
    assert.deepEqual(snapshots, [{ taskId: "new", before: null }]);
  });
});
