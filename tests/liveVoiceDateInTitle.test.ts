/// <reference types="node" />
// Magic mic: a day left in a new task's name ("Reading today", seen on the
// phone 2026-11-14) becomes its deadline instead (splitDateFromTitle).
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createLiveToolRunner, draftFromAddTask, splitDateFromTitle } from "@/lib/liveVoiceTools";
import { toLocalDateKey } from "@/lib/localDate";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTaskStore } from "@/store/useTaskStore";

import { local } from "./helpers";

const now = local(2026, 11, 14, 9);

afterEach(() => {
  useSettingsStore.setState({ language: "en" });
  useTaskStore.setState({ tasks: [] });
});

describe("a date left in the title", () => {
  it("comes out of the name and becomes the deadline", () => {
    assert.deepEqual(splitDateFromTitle("Reading today", now), { title: "Reading", dueDatePhrase: "2026-11-14" });
    assert.deepEqual(splitDateFromTitle("Call mom tomorrow at 6", now), { title: "Call mom", dueDatePhrase: "2026-11-15 at 18:00" });
  });

  it("at the start too, and in the app's language", () => {
    assert.equal(splitDateFromTitle("Tomorrow call mom", now).title, "call mom");
    useSettingsStore.setState({ language: "fr" });
    assert.deepEqual(splitDateFromTitle("Lire aujourd'hui", now), { title: "Lire", dueDatePhrase: "2026-11-14" });
  });

  it("leaves a name alone when the date words are inside it, a repeat, or the whole thing", () => {
    assert.deepEqual(splitDateFromTitle("Read Today magazine", now), { title: "Read Today magazine" });
    assert.deepEqual(splitDateFromTitle("Weekly review", now), { title: "Weekly review" });
    assert.deepEqual(splitDateFromTitle("Reading", now), { title: "Reading" });
    assert.deepEqual(splitDateFromTitle("Tomorrow", now), { title: "Tomorrow" });
  });

  it("onboarding's brain dump drafts get the same", () => {
    const draft = draftFromAddTask({ title: "Reading today", estimatedMinutes: 30 }, now);
    assert.equal(draft?.title, "Reading");
    assert.ok(draft?.dueDate);
  });

  it("Magic mic's add_task makes a task called Reading, due today", () => {
    const runner = createLiveToolRunner(new Map());
    const result = runner.run({ id: "c1", name: "add_task", args: { title: "Reading today", estimatedMinutes: 30 } });
    assert.equal(result.ok, true);
    const task = useTaskStore.getState().tasks.find((entry) => entry.title === "Reading");
    assert.ok(task, "no task called Reading");
    // The runner works on the real clock: due on today's date.
    assert.equal(task.deadline?.date, toLocalDateKey(new Date()));
  });

  it("a deadline the model gave separately wins over the one in the name", () => {
    const runner = createLiveToolRunner(new Map());
    runner.run({ id: "c2", name: "add_task", args: { title: "Reading tomorrow", dueDatePhrase: "next friday", estimatedMinutes: 30 } });
    const task = useTaskStore.getState().tasks.find((entry) => entry.title === "Reading");
    assert.ok(task?.deadline);
    // Next Friday, not tomorrow.
    assert.equal(new Date(`${task.deadline.date}T12:00:00`).getDay(), 5);
  });
});
