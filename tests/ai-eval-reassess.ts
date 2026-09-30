/// <reference types="node" />
// Live eval of Task Details' reassessment against the real model.
//
//   npm run eval:reassess      (needs GEMINI_API_KEY in .env; ~10 Gemini calls, about a cent)
//
// Everything is real except storage: the request goes through the reassess
// route's own validation and model call (parseReassessBody → reassessTask),
// the answer through the app's mapping, merge and save, and the database is
// the in-memory fake from tests/stubs. Each case seeds one task, sends a note
// the way the context box does, and checks the saved task and the report —
// not the model's wording. Not part of `npm test`: it costs money and the
// model isn't deterministic across versions.

import { parseReassessBody, reassessTask } from "@/app/api/reassess+api";
import { computePriorityScore } from "@/lib/scoring";
import { recalcAll } from "@/lib/taskPipeline";
import { useReassessStore, type ReassessState } from "@/store/useReassessStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTaskStore } from "@/store/useTaskStore";
import type { AppLanguage } from "@/types/settings";
import type { Subtask, Task } from "@/types/task";

import { setApiHandler } from "./stubs/api";
import { fakeDb } from "./stubs/supabase";

const DAY = 24 * 60 * 60 * 1000;

setApiHandler(async (path, body) => {
  if (path !== "/api/reassess") throw new Error(`unexpected ${path}`);
  const parsed = parseReassessBody(JSON.parse(JSON.stringify(body)));
  if (!parsed) throw new Error("the reassess route would reject this request");
  return reassessTask(parsed);
});

function at(days: number, hour = 18, minute = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function steps(...entries: [string, number, Subtask["status"]?][]): Subtask[] {
  const list = entries.map(([label, minutes, status], index) => ({
    id: `st-${index + 1}`,
    label,
    estimatedMinutes: minutes,
    order: index,
    status: status ?? ("pending" as const),
  }));
  const firstOpen = list.find((entry) => entry.status !== "completed");
  if (firstOpen) firstOpen.status = "current";
  return list;
}

function seed(overrides: Partial<Task>): Task {
  const createdAt = at(-1);
  const subtasks = overrides.subtasks;
  const task: Task = {
    id: "t",
    title: "Task",
    status: "pending",
    estimatedMinutes: subtasks ? subtasks.filter((s) => s.status !== "completed").reduce((sum, s) => sum + s.estimatedMinutes, 0) : 60,
    createdAt,
    updatedAt: createdAt,
    priorityScore: 0,
    suitabilityScore: 0,
    importance: 50,
    complexity: "medium",
    aiContext: { notes: [] },
    currentStepId: subtasks?.find((s) => s.status === "current")?.id,
    ...overrides,
  };
  const [scored] = recalcAll([task]);
  useTaskStore.setState({ tasks: [scored] });
  return scored;
}

const saved = () => useTaskStore.getState().tasks[0];

type Case = {
  name: string;
  task: Partial<Task>;
  say: string;
  language?: AppLanguage;
  check: (before: Task, after: Task, state: ReassessState | undefined) => string | null;
};

const done = (state: ReassessState | undefined) => (state?.status === "done" ? state.report : null);
const changedFields = (state: ReassessState | undefined) => done(state)?.changes.map((change) => change.field) ?? [];
const openSteps = (task: Task) => (task.subtasks ?? []).filter((subtask) => subtask.status !== "completed");
const daysMoved = (before: Task, after: Task) =>
  before.dueDate && after.dueDate ? Math.round((Date.parse(after.dueDate) - Date.parse(before.dueDate)) / DAY) : null;
const describe = (state: ReassessState | undefined) => JSON.stringify(state?.status === "done" ? state.report : state);

const CASES: Case[] = [
  {
    name: "more work (the chemistry example): longer, re-planned, re-advised — same deadline",
    task: {
      title: "Prepare chemistry exam",
      dueDate: at(12, 9),
      importance: 80,
      subtasks: steps(["Review chapters 1–3", 180]),
    },
    say: "I also have to study chapters 4 and 5, and I have a chemistry practice exam tomorrow.",
    check: (before, after, state) => {
      if (!done(state)) return `no report: ${describe(state)}`;
      if (after.dueDate !== before.dueDate) return "deadline moved";
      if (after.estimatedMinutes <= before.estimatedMinutes) return `estimate ${before.estimatedMinutes} → ${after.estimatedMinutes}`;
      if (openSteps(after).length < 2) return `${openSteps(after).length} steps`;
      if (!/4|5/.test(openSteps(after).map((s) => s.label).join(" "))) return "no step for chapters 4–5";
      if (!after.aiContext.advice) return "no advice";
      if (after.priorityScore !== computePriorityScore(after)) return "score not from the formula";
      const fields = changedFields(state);
      return fields.includes("duration") && fields.includes("subtasks") && !fields.includes("deadline")
        ? null
        : `reported ${fields.join(",")}`;
    },
  },
  {
    name: "new deadline: moved, the work left alone",
    task: { title: "History essay", dueDate: at(2, 23, 59), estimatedMinutes: 120 },
    say: "The teacher gave us until next Monday.",
    check: (before, after, state) => {
      const due = after.dueDate ? new Date(after.dueDate) : null;
      if (!due || due.getDay() !== 1) return `due ${due?.toString()}`;
      if (after.estimatedMinutes !== before.estimatedMinutes) return "estimate changed";
      return changedFields(state).includes("deadline") ? null : `reported ${changedFields(state).join(",")}`;
    },
  },
  {
    name: "deadline moved relative to the old one",
    task: { title: "Lab report", dueDate: at(3, 12), estimatedMinutes: 90 },
    say: "The professor gave us two more days.",
    check: (before, after) => (daysMoved(before, after) === 2 && new Date(after.dueDate!).getHours() === 12 ? null : `moved ${daysMoved(before, after)} days`),
  },
  {
    name: "one property: importance only",
    task: { title: "Client pitch", dueDate: at(6), estimatedMinutes: 60, importance: 50 },
    say: "If this pitch goes well we win the whole contract, so it really matters.",
    check: (before, after, state) => {
      // High or critical — "it really matters" can fairly be read as either.
      if (after.importance < 80) return `importance ${after.importance}`;
      if (after.dueDate !== before.dueDate) return "deadline changed";
      if (after.estimatedMinutes !== before.estimatedMinutes) return "estimate changed";
      return changedFields(state).includes("priority") ? null : `reported ${changedFields(state).join(",")}`;
    },
  },
  {
    name: "stressed importance: critical",
    task: { title: "Visa form", dueDate: at(6), estimatedMinutes: 45, importance: 80 },
    say: "This is really important, the whole trip depends on it.",
    check: (before, after) => {
      if (after.importance !== 100) return `importance ${after.importance}`;
      return after.dueDate === before.dueDate ? null : "deadline changed";
    },
  },
  {
    name: "nothing to change: acknowledged, task untouched",
    task: { title: "History essay", dueDate: at(3, 23, 59), estimatedMinutes: 120, subtasks: steps(["Write the essay", 120]) },
    say: "It's handed in to room 204.",
    check: (before, after, state) => {
      if (!done(state)) return `no report: ${describe(state)}`;
      if (after.dueDate !== before.dueDate || after.estimatedMinutes !== before.estimatedMinutes) return "task changed";
      const fields = changedFields(state).filter((field) => field !== "advice");
      return fields.length === 0 ? null : `reported ${fields.join(",")}`;
    },
  },
  {
    name: "ambiguous deadline: asks, saves nothing",
    task: { title: "Quarterly report", dueDate: at(4, 17), estimatedMinutes: 90 },
    say: "The deadline changed.",
    check: (before, after, state) =>
      state?.status === "clarify" && after.updatedAt === before.updatedAt ? null : `state ${describe(state)}`,
  },
  {
    name: "contradictory dates: asks",
    task: { title: "Tax return", dueDate: at(10, 17), estimatedMinutes: 120 },
    say: "It's due on the 15th — or maybe it was the 20th, I'm not sure which.",
    check: (before, after, state) =>
      state?.status === "clarify" && after.dueDate === before.dueDate ? null : `state ${describe(state)}`,
  },
  {
    name: "progress: a step marked done, less time left, nothing reset",
    task: {
      title: "Research paper",
      dueDate: at(6),
      subtasks: steps(["Pick a topic", 20, "completed"], ["Write the outline", 40], ["Draft the paper", 120], ["Edit and cite", 60]),
    },
    say: "I already finished the outline.",
    check: (before, after) => {
      const statusOf = (id: string) => after.subtasks?.find((subtask) => subtask.id === id)?.status;
      if (statusOf("st-1") !== "completed") return "finished step reset";
      // Marked done — not deleted, which would lose the record of the progress.
      if (statusOf("st-2") !== "completed") return `outline ${statusOf("st-2") ?? "removed"}`;
      return after.estimatedMinutes < before.estimatedMinutes ? null : `estimate ${before.estimatedMinutes} → ${after.estimatedMinutes}`;
    },
  },
  {
    name: "a step the note makes unnecessary goes",
    task: {
      title: "Plan the Lisbon trip",
      dueDate: at(14),
      subtasks: steps(["Book flights", 30, "completed"], ["Book the hotel", 30], ["Rent a car", 30], ["Plan day trips", 45]),
    },
    say: "We'll take trains everywhere, so no car rental.",
    check: (_, after) => {
      const labels = (after.subtasks ?? []).map((subtask) => subtask.label).join(" | ");
      if (/rent a car/i.test(labels)) return `still: ${labels}`;
      return after.subtasks?.find((subtask) => subtask.id === "st-1")?.status === "completed" ? null : "finished step lost";
    },
  },
  {
    name: "French note: deadline read on the device, steps written in French",
    language: "fr",
    task: { title: "Dissertation de philosophie", dueDate: at(2, 23, 59), estimatedMinutes: 180 },
    say: "Le professeur nous a donné jusqu'à lundi prochain.",
    check: (_, after) => {
      const due = after.dueDate ? new Date(after.dueDate) : null;
      return due && due.getDay() === 1 ? null : `due ${due?.toString()}`;
    },
  },
];

async function run() {
  const failures: string[] = [];
  let passed = 0;
  for (const testCase of CASES) {
    fakeDb.reset();
    useSettingsStore.setState({ language: testCase.language ?? "en", aiAutoMode: false });
    useTaskStore.setState({ tasks: [], unsynced: {}, syncUserId: "eval", ownerId: "eval" });
    useReassessStore.setState({ byTask: {} });
    const before = seed(testCase.task);

    await useReassessStore.getState().submit(before.id, { text: testCase.say });
    const state = useReassessStore.getState().byTask[before.id];
    const after = saved();
    const problem = testCase.check(before, after, state);
    if (problem) {
      failures.push(
        `✖ ${testCase.name}: ${problem}\n    note: ${testCase.say}\n    report: ${describe(state)}\n    steps: ${JSON.stringify(
          after.subtasks?.map((s) => [s.label, s.estimatedMinutes, s.status]),
        )}`,
      );
      console.log(`✖ ${testCase.name}`);
    } else {
      passed += 1;
      console.log(`✔ ${testCase.name}`);
    }
  }
  console.log(`\n${passed}/${CASES.length} passed`);
  if (failures.length) console.log(`\n${failures.join("\n\n")}`);
  process.exitCode = failures.length ? 1 : 0;
}

run();
