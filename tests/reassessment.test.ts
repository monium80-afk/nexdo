/// <reference types="node" />
// Task Details' "add context" box, end to end through the real stores: the
// note → the request the app builds (checked by the route's own validator) →
// the model's answer (scripted here, run through the route's own
// normalizer) → what reaches the (fake) database → the report the user reads.
// tests/ai-eval-reassess.ts checks the real model separately.
process.env.TZ = "Europe/Paris";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  normalizeReassessment,
  parseReassessBody,
  type ReassessRequestBody,
  type ReassessResponseBody,
} from "@/app/api/reassess+api";
import type { ReassessmentChange } from "@/lib/reassessment";
import { computePriorityScore } from "@/lib/scoring";
import { recalcAll } from "@/lib/taskPipeline";
import { useReassessStore, type ReassessState } from "@/store/useReassessStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTaskStore } from "@/store/useTaskStore";
import type { Subtask, Task } from "@/types/task";

import { makeTask } from "./helpers";
import { apiCalls, setApiHandler } from "./stubs/api";
import { fakeDb } from "./stubs/supabase";

const USER = "user_1";

/** A local date `days` from today at hour:minute. */
function at(days: number, hour = 18, minute = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function step(id: string, label: string, estimatedMinutes: number, status: Subtask["status"] = "pending", order = 0): Subtask {
  return { id, label, estimatedMinutes, status, order };
}

/** Puts one task on the list, scored like the store would. */
function seed(overrides: Partial<Task> & { id: string }): Task {
  const task = makeTask({ createdAt: at(-1), ...overrides });
  const [scored] = recalcAll([task]);
  useTaskStore.setState({ tasks: [scored] });
  return scored;
}

const task = (id: string) => useTaskStore.getState().tasks.find((entry) => entry.id === id)!;
const dbRow = (id: string) => fakeDb.rows("tasks").find((row) => row.id === id);
const stateOf = (id: string): ReassessState | undefined => useReassessStore.getState().byTask[id];
const fields = (changes: ReassessmentChange[]) => changes.map((change) => change.field);

function report(id: string) {
  const state = stateOf(id);
  assert.equal(state?.status, "done", `expected a report, got ${JSON.stringify(state)}`);
  return (state as Extract<ReassessState, { status: "done" }>).report;
}

const NO_FIELDS: Omit<ReassessResponseBody, "outcome" | "summary"> = {
  question: null,
  title: null,
  description: null,
  dueDatePhrase: null,
  dueDateShift: null,
  removeDeadline: false,
  stepsDone: [],
  steps: null,
  estimatedMinutes: null,
  priority: null,
  advice: null,
};

/**
 * The next /api/reassess call answers with `answer`. The request goes through
 * the route's own validator and the answer through its own normalizer, so a
 * test can't pass on a request or answer the real route would refuse.
 */
function modelAnswers(answer: Record<string, unknown>, check?: (body: ReassessRequestBody) => void) {
  setApiHandler((path, body) => {
    assert.equal(path, "/api/reassess");
    const parsed = parseReassessBody(JSON.parse(JSON.stringify(body)));
    assert.ok(parsed, "the route would reject this request");
    check?.(parsed);
    return normalizeReassessment({ ...NO_FIELDS, summary: "", ...answer });
  });
}

const submit = (id: string, text: string, replacesNote?: string) =>
  useReassessStore.getState().submit(id, { text, replacesNote });

beforeEach(() => {
  fakeDb.reset();
  apiCalls.length = 0;
  useSettingsStore.setState({ language: "en" });
  useTaskStore.setState({ tasks: [], unsynced: {}, syncUserId: USER, ownerId: USER });
  useReassessStore.setState({ byTask: {} });
});

describe("reassessing a task for new context", () => {
  it("more work: re-plans the steps, lengthens the estimate and revises the advice — the deadline stays", async () => {
    const due = at(12, 9);
    seed({
      id: "chem",
      title: "Prepare chemistry exam",
      dueDate: due,
      estimatedMinutes: 180,
      importance: 75,
      subtasks: [step("st-1", "Review chapters 1–3", 180, "current")],
      currentStepId: "st-1",
    });
    const note = "I also have to study chapters 4 and 5, and I have a chemistry practice exam tomorrow.";
    modelAnswers(
      {
        outcome: "update",
        steps: [
          { id: "s1", title: "Review chapters 1–3", estimatedMinutes: 150 },
          { id: null, title: "Review chapters 4 and 5", estimatedMinutes: 120 },
          { id: null, title: "Take the practice exam", estimatedMinutes: 60 },
        ],
        estimatedMinutes: 330,
        advice: "Use **tomorrow's practice exam** as a checkpoint.",
        summary: "Chapters 4 and 5 add a second block of review.",
      },
      (body) => {
        // The model sees the task as saved, the steps by alias, and the note separately.
        assert.equal(body.newContext, note);
        assert.deepEqual(body.steps, [{ id: "s1", title: "Review chapters 1–3", estimatedMinutes: 180 }]);
        assert.deepEqual(body.task.contextNotes, []);
      },
    );

    await submit("chem", note);

    const saved = task("chem");
    assert.equal(saved.dueDate, due, "the practice exam date is not the deadline");
    assert.equal(saved.estimatedMinutes, 330);
    assert.deepEqual(
      saved.subtasks!.map((subtask) => [subtask.label, subtask.estimatedMinutes, subtask.status]),
      [
        ["Review chapters 1–3", 150, "current"],
        ["Review chapters 4 and 5", 120, "pending"],
        ["Take the practice exam", 60, "pending"],
      ],
    );
    assert.equal(saved.subtasks![0].id, "st-1", "the existing step is kept, not replaced");
    assert.equal(saved.currentStepId, "st-1");
    assert.equal(saved.aiContext.advice, "Use **tomorrow's practice exam** as a checkpoint.");
    assert.deepEqual(saved.aiContext.notes, [note]);
    // The score is the app's own formula on the new values.
    assert.equal(saved.priorityScore, computePriorityScore(saved));

    const { changes, deadlineUnchanged, summary } = report("chem");
    // 180 → 330 minutes is more work, which counts for more (Effort) and eats
    // into the slack before the deadline — so the score moves and says so.
    assert.deepEqual(fields(changes), ["duration", "score", "subtasks", "advice"]);
    assert.deepEqual(changes[0], { field: "duration", from: 180, to: 330 });
    assert.deepEqual(changes[2], {
      field: "subtasks",
      summary: { added: 2, removed: 0, completed: 0, renamed: 0, retimed: 1, reordered: false },
    });
    assert.deepEqual(changes[3], { field: "advice", kind: "added" });
    assert.equal(deadlineUnchanged, true);
    assert.equal(summary, "Chapters 4 and 5 add a second block of review.");

    // Saved to Supabase in one write, and the phone shows exactly what was saved.
    assert.deepEqual(fakeDb.writes, [{ table: "tasks", kind: "upsert", ids: ["chem"] }]);
    assert.equal(dbRow("chem")?.estimated_minutes, 330);
    assert.deepEqual((dbRow("chem")?.ai_context as Task["aiContext"]).notes, [note]);
    assert.equal(useTaskStore.getState().unsynced.chem, undefined);
  });

  it("more work raises the score — the longer a task takes, the more it counts", async () => {
    const before = seed({ id: "essay", title: "Essay", dueDate: at(2), estimatedMinutes: 90, importance: 50 });
    modelAnswers({ outcome: "update", estimatedMinutes: 150, summary: "Two more sources to read." });

    await submit("essay", "I still need to read two more sources.");

    const after = task("essay");
    assert.ok(after.priorityScore > before.priorityScore, `${before.priorityScore} → ${after.priorityScore}`);
    assert.deepEqual(report("essay").changes, [
      { field: "duration", from: 90, to: 150 },
      { field: "score", from: before.priorityScore, to: after.priorityScore },
    ]);
  });

  it("reports a score change when the new workload no longer fits before the deadline", async () => {
    const dueSoon = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const before = seed({ id: "slides", title: "Slides", dueDate: dueSoon, estimatedMinutes: 60, importance: 50 });
    modelAnswers({ outcome: "update", estimatedMinutes: 180, summary: "The deck needs three more sections." });

    await submit("slides", "I still have three more sections to build.");

    const after = task("slides");
    assert.ok(after.priorityScore > before.priorityScore, "more work than time left makes it more urgent");
    assert.deepEqual(report("slides").changes, [
      { field: "duration", from: 60, to: 180 },
      { field: "score", from: before.priorityScore, to: after.priorityScore },
    ]);
  });

  it("a new deadline: moves it, keeps its time of day, rescores — and touches nothing else", async () => {
    const before = seed({
      id: "hist",
      title: "History essay",
      dueDate: at(2, 23, 59),
      estimatedMinutes: 120,
      subtasks: [step("a", "Outline", 30, "current", 0), step("b", "Draft", 90, "pending", 1)],
      currentStepId: "a",
    });
    modelAnswers({ outcome: "update", dueDatePhrase: "next monday", summary: "Due next Monday now." });

    await submit("hist", "The teacher gave us until next Monday.");

    const after = task("hist");
    const due = new Date(after.dueDate!);
    assert.equal(due.getDay(), 1);
    assert.equal(due.getHours(), 23);
    assert.equal(due.getMinutes(), 59);
    assert.equal(after.estimatedMinutes, 120);
    assert.deepEqual(after.subtasks, before.subtasks);
    assert.deepEqual(fields(report("hist").changes), ["deadline", "score"]);
    assert.equal(report("hist").deadlineUnchanged, false);
  });

  it("one property: only the priority changes (and the score it drives)", async () => {
    const before = seed({
      id: "pitch",
      title: "Client pitch",
      dueDate: at(6),
      estimatedMinutes: 60,
      importance: 50,
      subtasks: [step("a", "Slides", 40, "current", 0), step("b", "Rehearse", 20, "pending", 1)],
      currentStepId: "a",
    });
    modelAnswers({ outcome: "update", priority: "high", summary: "This pitch decides the contract." });

    await submit("pitch", "If this pitch goes well we win the whole contract.");

    const after = task("pitch");
    assert.equal(after.importance, 80);
    assert.equal(after.dueDate, before.dueDate);
    assert.equal(after.estimatedMinutes, before.estimatedMinutes);
    assert.deepEqual(after.subtasks, before.subtasks);
    assert.equal(after.title, before.title);
    assert.deepEqual(report("pitch").changes, [
      { field: "priority", from: "medium", to: "high" },
      { field: "score", from: before.priorityScore, to: after.priorityScore },
    ]);
  });

  it("\"this is really important\" makes it critical — above High, and said so", async () => {
    const before = seed({ id: "visa", title: "Visa form", dueDate: at(6), estimatedMinutes: 45, importance: 80 });
    modelAnswers({ outcome: "update", priority: "critical", summary: "The whole trip depends on it." });

    await submit("visa", "This is really important, the whole trip depends on it.");

    const after = task("visa");
    assert.equal(after.importance, 100);
    assert.ok(after.priorityScore > before.priorityScore);
    assert.deepEqual(report("visa").changes, [
      { field: "priority", from: "high", to: "critical" },
      { field: "score", from: before.priorityScore, to: after.priorityScore },
    ]);
  });

  it("an answer that repeats current values reports nothing as changed", async () => {
    const before = seed({ id: "rep", title: "Report", dueDate: at(4, 17), estimatedMinutes: 60, importance: 50 });
    modelAnswers({ outcome: "update", title: "Report", estimatedMinutes: 60, priority: "medium", summary: "Same as before." });

    await submit("rep", "It's the usual monthly report.");

    const after = task("rep");
    assert.equal(after.title, before.title);
    assert.equal(after.estimatedMinutes, before.estimatedMinutes);
    assert.equal(after.importance, before.importance);
    assert.deepEqual(report("rep").changes, []);
    assert.equal(report("rep").deadlineUnchanged, false);
  });

  it("context that changes nothing: the note is kept, the task isn't touched, and the user is told", async () => {
    const before = seed({
      id: "exam",
      title: "History essay",
      dueDate: at(3, 23, 59),
      estimatedMinutes: 120,
      subtasks: [step("a", "Draft", 120, "current")],
      currentStepId: "a",
      aiContext: { notes: [], advice: "Start with **the thesis**." },
    });
    // A stray field next to "no_change" is ignored by the route.
    modelAnswers({ outcome: "no_change", title: "Something else", summary: "Where it's handed in doesn't change the work." });

    await submit("exam", "It's handed in to room 204.");

    const after = task("exam");
    for (const key of ["title", "dueDate", "estimatedMinutes", "importance", "notes", "subtasks", "currentStepId"] as const) {
      assert.deepEqual(after[key], before[key], key);
    }
    assert.equal(after.aiContext.advice, "Start with **the thesis**.");
    assert.deepEqual(after.aiContext.notes, ["It's handed in to room 204."]);
    assert.deepEqual(report("exam"), {
      changes: [],
      deadlineUnchanged: false,
      summary: "Where it's handed in doesn't change the work.",
      keptUserEdits: false,
    });
    assert.equal(fakeDb.writes.length, 1, "the note itself is saved");
  });

  it("finished and edited steps: progress is kept, irrelevant steps go, new ones come in", async () => {
    seed({
      id: "trip",
      title: "Plan the trip",
      estimatedMinutes: 70,
      subtasks: [
        step("a", "Book flights", 30, "completed", 0),
        step("b", "Book the hotel", 40, "current", 1),
        step("c", "Rent a car", 30, "pending", 2),
      ],
      currentStepId: "b",
    });
    modelAnswers(
      {
        outcome: "update",
        // "s2" is the car — the note makes it unnecessary; "s1" is the hotel, already done.
        stepsDone: ["s1"],
        steps: [{ id: null, title: "Buy train passes", estimatedMinutes: 20 }],
        estimatedMinutes: 20,
        summary: "The hotel is booked and trains replace the car.",
      },
      (body) => {
        assert.deepEqual(body.doneSteps, [{ title: "Book flights", estimatedMinutes: 30 }]);
        assert.deepEqual(
          body.steps.map((entry) => entry.id),
          ["s1", "s2"],
        );
      },
    );

    await submit("trip", "I booked the hotel already, and we'll take trains instead of renting a car.");

    const after = task("trip");
    assert.deepEqual(
      after.subtasks!.map((subtask) => [subtask.id.startsWith("subtask-") ? "new" : subtask.id, subtask.status]),
      [
        ["a", "completed"],
        ["b", "completed"],
        ["new", "current"],
      ],
    );
    assert.equal(after.estimatedMinutes, 20);
    assert.equal(after.status, "pending", "a reassessment never completes the task itself");
    assert.deepEqual(report("trip").changes.find((change) => change.field === "subtasks"), {
      field: "subtasks",
      summary: { added: 1, removed: 1, completed: 1, renamed: 0, retimed: 0, reordered: false },
    });
  });

  it("a new length for a task with steps re-times the steps so both agree", async () => {
    seed({
      id: "deck",
      title: "Pitch deck",
      estimatedMinutes: 60,
      subtasks: [step("a", "Outline", 30, "current", 0), step("b", "Design", 30, "pending", 1)],
      currentStepId: "a",
    });
    modelAnswers({ outcome: "update", estimatedMinutes: 90, summary: "The deck needs twice the slides." });

    await submit("deck", "It needs 20 slides, not 10.");

    const after = task("deck");
    assert.equal(after.estimatedMinutes, 90);
    assert.equal(after.subtasks!.reduce((sum, subtask) => sum + subtask.estimatedMinutes, 0), 90);
    assert.deepEqual(report("deck").changes.find((change) => change.field === "subtasks"), {
      field: "subtasks",
      summary: { added: 0, removed: 0, completed: 0, renamed: 0, retimed: 2, reordered: false },
    });
  });

  it("an edited note replaces the old one, and the model is told which", async () => {
    seed({ id: "call", title: "Call the bank", dueDate: at(4, 10), aiContext: { notes: ["They open at 9", "Due Friday"] } });
    modelAnswers({ outcome: "update", dueDatePhrase: "monday", summary: "Now due Monday." }, (body) => {
      assert.equal(body.replacesNote, "Due Friday");
      assert.deepEqual(body.task.contextNotes, ["They open at 9"]);
    });

    await submit("call", "Due Monday", "Due Friday");

    assert.deepEqual(task("call").aiContext.notes, ["They open at 9", "Due Monday"]);
    assert.equal(new Date(task("call").dueDate!).getDay(), 1);
  });

  it("the advice it keeps survives the notes being edited by hand", async () => {
    seed({ id: "adv", title: "Tax return" });
    modelAnswers({ outcome: "update", advice: "Gather **last year's forms** first.", summary: "" });
    await submit("adv", "I have to include the freelance income this year.");
    useTaskStore.getState().setContextNotes("adv", []);
    assert.equal(task("adv").aiContext.advice, "Gather **last year's forms** first.");
  });
});

describe("unclear context", () => {
  it("asks instead of guessing, changes nothing, and reassesses the note with the answer", async () => {
    // 9:00, so "Friday at 5pm" is a change whichever weekday the test runs on.
    const before = seed({ id: "q", title: "Quarterly report", dueDate: at(3, 9), estimatedMinutes: 90 });
    modelAnswers({ outcome: "clarify", question: "When is the quarterly report due now?" });

    await submit("q", "The deadline changed.");

    assert.deepEqual(stateOf("q"), {
      status: "clarify",
      question: "When is the quarterly report due now?",
      pending: { submission: { text: "The deadline changed.", replacesNote: undefined }, noteText: "The deadline changed." },
    });
    assert.deepEqual(task("q"), before, "nothing — not even the note — is saved yet");
    assert.equal(fakeDb.writes.length, 0);

    modelAnswers({ outcome: "update", dueDatePhrase: "friday at 5pm", summary: "Due Friday now." }, (body) => {
      assert.deepEqual(body.clarification, { note: "The deadline changed.", question: "When is the quarterly report due now?" });
      assert.equal(body.newContext, "Friday at 5pm");
    });
    await submit("q", "Friday at 5pm");

    const due = new Date(task("q").dueDate!);
    assert.equal(due.getDay(), 5);
    assert.equal(due.getHours(), 17);
    assert.deepEqual(task("q").aiContext.notes, ["The deadline changed.\nFriday at 5pm"]);
    assert.deepEqual(fields(report("q").changes).slice(0, 1), ["deadline"]);
  });

  it("a deadline phrase the app can't read becomes a question, not a guessed date", async () => {
    const before = seed({ id: "lab", title: "Lab report", dueDate: at(5) });
    modelAnswers({ outcome: "update", dueDatePhrase: "whenever the professor decides", summary: "" });

    await submit("lab", "The professor will tell us the new deadline.");

    assert.equal(stateOf("lab")?.status, "clarify");
    assert.deepEqual(task("lab"), before);
    assert.equal(fakeDb.writes.length, 0);
  });

  it("moving a deadline the task doesn't have is asked about too", async () => {
    seed({ id: "free", title: "Read the book" });
    modelAnswers({ outcome: "update", dueDateShift: { amount: 2, unit: "days" }, summary: "" });

    await submit("free", "I get two more days.");

    assert.equal(stateOf("free")?.status, "clarify");
    assert.equal(task("free").dueDate, undefined);
  });
});

describe("failures never leave the task half-changed", () => {
  it("the AI failing changes nothing; trying again works", async () => {
    const before = seed({ id: "f", title: "Groceries", estimatedMinutes: 30 });
    setApiHandler(() => {
      throw new Error("/api/reassess failed: 502");
    });

    await submit("f", "I also need to pick up a cake.");

    assert.equal(stateOf("f")?.status, "error");
    assert.equal((stateOf("f") as Extract<ReassessState, { status: "error" }>).reason, "ai");
    assert.deepEqual(task("f"), before);
    assert.equal(fakeDb.writes.length, 0);

    modelAnswers({ outcome: "update", estimatedMinutes: 45, summary: "One more stop." });
    await useReassessStore.getState().retry("f");
    assert.equal(task("f").estimatedMinutes, 45);
    assert.deepEqual(task("f").aiContext.notes, ["I also need to pick up a cake."]);
  });

  it("an answer the route can't use is a failure, not a change", async () => {
    const before = seed({ id: "u", title: "Groceries" });
    setApiHandler(() => normalizeReassessment({ outcome: "clarify", question: null }));

    await submit("u", "Something about the groceries.");

    assert.equal(stateOf("u")?.status, "error");
    assert.deepEqual(task("u"), before);
  });

  it("the database refusing the save changes nothing on the phone either", async () => {
    const before = seed({ id: "d", title: "Essay", estimatedMinutes: 60, dueDate: at(3) });
    modelAnswers({ outcome: "update", estimatedMinutes: 120, summary: "Double the length." });
    fakeDb.nextError = { code: "57014", message: "canceling statement due to statement timeout" };

    await submit("d", "It has to be 4,000 words, not 2,000.");

    assert.equal((stateOf("d") as Extract<ReassessState, { status: "error" }>).reason, "save");
    assert.deepEqual(task("d"), before, "no field, note or score changed");
    assert.equal(dbRow("d"), undefined);
    assert.deepEqual(useTaskStore.getState().unsynced, {});
  });

  it("signed out, the phone's copy is the save — marked for upload later", async () => {
    useTaskStore.setState({ syncUserId: null });
    seed({ id: "o", title: "Essay", estimatedMinutes: 60 });
    modelAnswers({ outcome: "update", estimatedMinutes: 90, summary: "" });

    await submit("o", "Add a bibliography.");

    assert.equal(task("o").estimatedMinutes, 90);
    assert.equal(useTaskStore.getState().unsynced.o, task("o").updatedAt);
    assert.equal(fakeDb.writes.length, 0);
  });
});

describe("repeated and overlapping submissions", () => {
  it("a second note while one is being reassessed is ignored — one request, one note", async () => {
    seed({ id: "dup", title: "Essay", estimatedMinutes: 60 });
    let answer!: (value: unknown) => void;
    setApiHandler(() => new Promise((resolve) => (answer = resolve)));

    const first = submit("dup", "Add a bibliography.");
    await submit("dup", "Add a bibliography.");
    assert.equal(apiCalls.length, 1);
    assert.equal(stateOf("dup")?.status, "running");

    answer(normalizeReassessment({ ...NO_FIELDS, outcome: "update", estimatedMinutes: 75, summary: "" }));
    await first;
    assert.deepEqual(task("dup").aiContext.notes, ["Add a bibliography."]);
    assert.equal(task("dup").estimatedMinutes, 75);
  });

  it("edits the user makes while Nexdo works win over its suggestions for the same things", async () => {
    seed({
      id: "race",
      title: "Research paper",
      dueDate: at(5, 12),
      estimatedMinutes: 90,
      subtasks: [step("a", "Find sources", 60, "current", 0), step("b", "Write summary", 30, "pending", 1)],
      currentStepId: "a",
    });
    let answer!: (value: unknown) => void;
    setApiHandler(() => new Promise((resolve) => (answer = resolve)));
    const pending = submit("race", "Only three sources are needed, and it's due Friday.");

    // Meanwhile: the user ticks the first step and moves the deadline themselves.
    useTaskStore.getState().completeStep("race", "a");
    const userDeadline = at(9, 12);
    useTaskStore.getState().updateTask("race", { dueDate: userDeadline });

    answer(
      normalizeReassessment({
        ...NO_FIELDS,
        outcome: "update",
        dueDatePhrase: "friday",
        steps: [
          { id: "s1", title: "Find three sources", estimatedMinutes: 30 },
          { id: "s2", title: "Write summary", estimatedMinutes: 25 },
        ],
        summary: "Fewer sources, and due Friday.",
      }),
    );
    await pending;

    const after = task("race");
    assert.equal(after.dueDate, userDeadline, "the user's own deadline stands");
    assert.deepEqual(
      after.subtasks!.map((subtask) => [subtask.id, subtask.label, subtask.status]),
      [
        ["a", "Find sources", "completed"],
        ["b", "Write summary", "current"],
      ],
    );
    assert.equal(after.estimatedMinutes, 25, "what's left, re-timed by the plan");
    const done = report("race");
    assert.equal(done.keptUserEdits, true);
    assert.equal(done.summary, "", "the model's reason would describe the skipped deadline too");
    assert.ok(!fields(done.changes).includes("deadline"));
  });

  it("a change landing during the save itself is rebuilt on, not overwritten", async () => {
    seed({
      id: "mid",
      title: "Pack",
      estimatedMinutes: 30,
      subtasks: [step("a", "Clothes", 15, "current", 0), step("b", "Toiletries", 15, "pending", 1)],
      currentStepId: "a",
    });
    let builds = 0;
    const result = await useTaskStore.getState().saveTaskNow("mid", (current) => {
      builds += 1;
      // The first build's request is "in flight" when the user ticks a step.
      if (builds === 1) useTaskStore.getState().completeStep("mid", "a");
      return { ...current, title: "Pack for the trip", updatedAt: new Date(Date.now() + builds).toISOString() };
    });

    assert.equal(result.ok, true);
    assert.equal(builds, 2);
    assert.equal(task("mid").title, "Pack for the trip");
    assert.equal(task("mid").subtasks!.find((subtask) => subtask.id === "a")!.status, "completed");
    assert.equal(dbRow("mid")?.title, "Pack for the trip");
  });
});

describe("the route's boundary", () => {
  it("keeps only usable fields from the model", () => {
    const answer = normalizeReassessment({
      outcome: "update",
      title: "estimatedMinutes: 30, priority: high",
      steps: [
        { id: "s1", title: "Keep", estimatedMinutes: 2 },
        { id: "s1", title: "Twice", estimatedMinutes: 99_999 },
        { id: null, title: "", estimatedMinutes: 10 },
      ],
      estimatedMinutes: -5,
      priority: "urgent",
      dueDateShift: { amount: 0, unit: "days" },
      stepsDone: "s2",
      summary: "ok",
    });
    assert.equal(answer.title, null, "leaked reasoning isn't a title");
    assert.deepEqual(answer.steps, [
      { id: "s1", title: "Keep", estimatedMinutes: 5 },
      { id: null, title: "Twice", estimatedMinutes: 1440 },
    ]);
    assert.equal(answer.estimatedMinutes, null, "a negative length is garbage, not a change");
    assert.equal(answer.priority, null);
    assert.equal(answer.dueDateShift, null);
    assert.deepEqual(answer.stepsDone, []);
  });

  it("refuses an answer with no outcome, or a question with nothing to ask", () => {
    assert.throws(() => normalizeReassessment({ summary: "hi" }));
    assert.throws(() => normalizeReassessment({ outcome: "clarify", question: "  " }));
  });

  it("refuses a request without a task or a note", () => {
    assert.equal(parseReassessBody({ task: { id: "x", title: "X" }, newContext: "   " }), null);
    assert.equal(parseReassessBody({ newContext: "hello" }), null);
  });
});
