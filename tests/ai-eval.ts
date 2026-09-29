/// <reference types="node" />
// Live eval of the AI chat's task operations against the real model.
//
//   npm run eval:ai            (needs GEMINI_API_KEY in .env; ~40 Gemini calls, a few cents)
//
// Everything is real except storage: the chat and task stores run as in the
// app, the request goes through the inbox route's own validation and model
// loop (resolveInboxMessage), and the database is the in-memory fake from
// tests/stubs. Each case starts from the same seeded task list, sends what a
// user would type, answers "yes" if the app asks, and then checks the tasks —
// not just the wording of the reply. Not part of `npm test`: it costs money and
// the model isn't deterministic across versions.

import { isDeepStrictEqual } from "node:util";

import { parseBody, resolveInboxMessage } from "@/app/api/inbox+api";
import { useChatStore } from "@/store/useChatStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTaskStore } from "@/store/useTaskStore";
import type { Task } from "@/types/task";

import { setApiHandler } from "./stubs/api";
import { fakeDb } from "./stubs/supabase";

const DAY = 24 * 60 * 60 * 1000;

setApiHandler(async (path, body) => {
  if (path !== "/api/inbox") throw new Error(`unexpected ${path}`);
  const parsed = parseBody(JSON.parse(JSON.stringify(body)));
  if (!parsed) throw new Error("the inbox route would reject this request");
  return resolveInboxMessage(parsed);
});

const flush = () => new Promise((resolve) => setImmediate(resolve));

function at(days: number, hour = 18, minute = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

async function say(text: string): Promise<string> {
  useChatStore.getState().sendMessage(text);
  const started = Date.now();
  await flush();
  while (useChatStore.getState().isAiTyping && Date.now() - started < 90_000) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await flush();
  const messages = useChatStore.getState().messages;
  return messages[messages.length - 1]?.text ?? "";
}

const tasks = () => useTaskStore.getState().tasks;
const byTitle = (title: string): Task | undefined => tasks().find((task) => task.title === title);
const pending = () => useChatStore.getState().pendingActions;

/** The same list for every case. */
function seed() {
  const add = useTaskStore.getState().addTask;
  add({ title: "Essay", estimatedMinutes: 90, priorityLevel: "high", dueDate: at(2) });
  add({ title: "Groceries", estimatedMinutes: 30, priorityLevel: "low", dueDate: at(3, 10, 30) });
  add({ title: "Call the dentist", estimatedMinutes: 15, priorityLevel: "medium" });
  add({ title: "Business plan", estimatedMinutes: 120, priorityLevel: "medium", dueDate: at(5) });
  add({ title: "Client pitch for business", estimatedMinutes: 60, priorityLevel: "medium", dueDate: at(6) });
  add({ title: "Smith project: draft", estimatedMinutes: 60, priorityLevel: "medium", dueDate: at(4) });
  add({ title: "Smith project: review", estimatedMinutes: 30, priorityLevel: "medium", dueDate: at(7) });
  add({ title: "Pay electricity bill", estimatedMinutes: 15, priorityLevel: "high", dueDate: at(-2, 9) });
  add({ title: "Math assignment", estimatedMinutes: 45, priorityLevel: "medium", dueDate: at(1) });
  add({ title: "Gym", estimatedMinutes: 60, priorityLevel: "medium", dueDate: at(1, 7), recurrence: { frequency: "weekly" } });
  const chem = add({ title: "Chemistry assignment", estimatedMinutes: 60, priorityLevel: "high", dueDate: at(-3) });
  useTaskStore.getState().completeTask(chem);
  useTaskStore.setState((state) => ({
    tasks: state.tasks.map((task) => (task.id === chem ? { ...task, completedAt: at(-1, 16, 10) } : task)),
  }));
}

type Snapshot = Map<string, Task>;
type Case = {
  name: string;
  say: string;
  /** Say "yes" if the app asks for confirmation. */
  confirm?: boolean;
  check: (reply: string, before: Snapshot, answer: string) => string | null;
};

const unchanged = (before: Snapshot) =>
  tasks().length === before.size && tasks().every((task) => isDeepStrictEqual(task, before.get(task.id)));

/** Exactly the tasks with these titles are gone — every other seeded task is still there. */
const onlyDeleted = (before: Snapshot, titles: string[]) => {
  const left = new Set(tasks().map((task) => task.id));
  const wrong = [...before.values()].filter((task) => left.has(task.id) === titles.includes(task.title));
  if (wrong.length > 0) return `wrong set deleted (${wrong.map((task) => task.title).join(", ")})`;
  return left.size === before.size - titles.length ? null : "a task was added";
};

const daysMoved = (before: Snapshot, title: string) => {
  const now = byTitle(title);
  const then = [...before.values()].find((task) => task.title === title);
  if (!now?.dueDate || !then?.dueDate) return null;
  return Math.round((Date.parse(now.dueDate) - Date.parse(then.dueDate)) / DAY);
};

const DENIES_EXISTENCE = /(don'?t|do not|can'?t|cannot|couldn'?t) (see|find|have)|no (such|task)|doesn'?t exist|not (on|in) your (list|tasks)/i;

const CASES: Case[] = [
  // What already worked must keep working.
  {
    name: "capture: a bare task becomes a draft",
    say: "call the plumber",
    check: () => (pending().some((entry) => entry.action.type === "CREATE_TASK") ? null : "no draft"),
  },
  {
    name: "capture: two tasks in one message",
    say: "finish my physics homework thursday and book a haircut tomorrow",
    check: () => {
      const drafts = pending().flatMap((entry) => (entry.action.type === "CREATE_TASK" ? entry.action.drafts : []));
      return drafts.length === 2 ? null : `${drafts.length} drafts`;
    },
  },
  {
    name: "single delete",
    say: "delete the groceries task",
    check: (_, before) => onlyDeleted(before, ["Groceries"]),
  },
  {
    name: "single complete",
    say: "I called the dentist",
    check: () => (byTitle("Call the dentist")?.status === "completed" ? null : "not completed"),
  },
  {
    name: "time budget redirects to Next",
    say: "I only have 30 minutes right now",
    check: () => (useChatStore.getState().redirectToNext?.minutes === 30 ? null : "no redirect"),
  },
  {
    name: "off-topic changes nothing",
    say: "what's the weather like?",
    check: (reply, before) => (unchanged(before) && reply ? null : "something changed"),
  },
  // Single edits.
  {
    name: "modify one task (deadline with a time)",
    say: "make the essay due friday at 3pm",
    check: () => {
      const due = byTitle("Essay")?.dueDate;
      if (!due) return "no deadline";
      const date = new Date(due);
      return date.getDay() === 5 && date.getHours() === 15 ? null : `due ${date.toString()}`;
    },
  },
  {
    name: "modify importance",
    say: "make the groceries high priority",
    check: () => (byTitle("Groceries")?.importance === 75 ? null : `importance ${byTitle("Groceries")?.importance}`),
  },
  // Bulk.
  {
    name: "postpone all tasks by two weeks",
    say: "Postpone all my tasks by two weeks.",
    confirm: true,
    check: (_, before) => {
      const moved = ["Essay", "Groceries", "Business plan", "Math assignment"].map((title) => daysMoved(before, title));
      return moved.every((days) => days === 14) ? null : `moved ${moved.join(",")} days`;
    },
  },
  {
    name: "add an hour to every task",
    say: "Add one hour to the estimated duration of every task.",
    confirm: true,
    check: (_, before) => {
      const essay = byTitle("Essay")!.estimatedMinutes - [...before.values()].find((t) => t.title === "Essay")!.estimatedMinutes;
      const dentist = byTitle("Call the dentist")!.estimatedMinutes;
      return essay === 60 && dentist === 75 ? null : `essay +${essay}, dentist ${dentist}`;
    },
  },
  {
    name: "importance of the business tasks only",
    say: "Change the importance of all my business tasks to high.",
    confirm: true,
    check: () => {
      const business = ["Business plan", "Client pitch for business"].map((title) => byTitle(title)?.importance);
      const other = byTitle("Groceries")?.importance;
      return business.every((value) => value === 75) && other === 25 ? null : `business ${business}, groceries ${other}`;
    },
  },
  {
    name: "delete a project's tasks",
    say: "Delete all tasks related to the Smith project.",
    confirm: true,
    check: (_, before) => onlyDeleted(before, ["Smith project: draft", "Smith project: review"]),
  },
  {
    name: "overdue tasks to next Monday, keeping their time",
    say: "Reschedule all my overdue tasks to next Monday.",
    confirm: true,
    check: () => {
      const bill = byTitle("Pay electricity bill")?.dueDate;
      if (!bill) return "no deadline";
      const date = new Date(bill);
      const days = Math.round((Date.parse(bill) - Date.now()) / DAY);
      return date.getDay() === 1 && date.getHours() === 9 && days >= 0 && days <= 14 ? null : `due ${date.toString()}`;
    },
  },
  {
    name: "incomplete tasks to next week",
    say: "Move all my incomplete tasks to next week.",
    confirm: true,
    check: (_, before) => {
      const moved = ["Essay", "Math assignment"].map((title) => daysMoved(before, title));
      return moved.every((days) => days !== null && days >= 3 && days <= 14) ? null : `moved ${moved.join(",")} days`;
    },
  },
  {
    name: "mark the assignments done (only the open ones)",
    say: "Mark all the assignments as done.",
    confirm: true,
    check: () =>
      byTitle("Math assignment")?.status === "completed" && byTitle("Essay")?.status === "pending" ? null : "wrong set",
  },
  {
    name: "ambiguous direction asks first",
    say: "Move all my deadlines forward by three days.",
    check: (reply, before) => (unchanged(before) && reply.includes("?") ? null : "changed without asking"),
  },
  {
    name: "destructive: delete everything waits for a yes",
    say: "delete everything",
    check: (reply, before) =>
      unchanged(before) && pending().some((entry) => entry.action.type === "OPERATE") ? null : "no confirmation",
  },
  // Completed tasks.
  {
    name: "a completed task is acknowledged, not denied",
    say: "What happened to the chemistry assignment I finished?",
    check: (reply) => (/complet|finish|done/i.test(reply) && !DENIES_EXISTENCE.test(reply) ? null : "denied or missed it"),
  },
  {
    name: "when was the last task completed",
    say: "When did I complete my last task?",
    check: (reply) => (/yesterday|4:10|16:10/i.test(reply) ? null : "no completion time"),
  },
  {
    name: "tasks completed this week are listed",
    say: "Show me the tasks I completed this week.",
    check: (reply) => {
      // Finished yesterday — which, on a Monday, was last week (weeks start on Monday, lib/ai/parseDate.ts).
      const thisWeek = new Date().getDay() !== 1;
      if (/Chemistry assignment/.test(reply) === thisWeek) return null;
      return thisWeek ? "not listed" : "listed last week's task";
    },
  },
  {
    name: "change a completed task's deadline, keeping it completed",
    say: "Change the deadline of the task I already completed to Friday.",
    check: () => {
      const chem = byTitle("Chemistry assignment");
      return chem?.status === "completed" && chem.dueDate && new Date(chem.dueDate).getDay() === 5 ? null : "not updated";
    },
  },
  {
    name: "reopen the task finished yesterday",
    say: "Reopen the task I finished yesterday.",
    check: () => (byTitle("Chemistry assignment")?.status === "pending" ? null : "not reopened"),
  },
  {
    name: "delete the completed assignment",
    say: "Delete the completed assignment.",
    confirm: true,
    check: (_, before) => onlyDeleted(before, ["Chemistry assignment"]),
  },
  // Repeating tasks.
  {
    name: "create a repeating task",
    // Not "gym": the seeded list has a Gym task, and the duplicate rule rightly treats that as an edit.
    say: "yoga class every monday and thursday at 7am",
    check: () => {
      const draft = pending()
        .flatMap((entry) => (entry.action.type === "CREATE_TASK" ? entry.action.drafts : []))
        .find((entry) => entry.recurrence);
      return draft?.recurrence?.frequency === "weekly" && draft.recurrence.weekdays?.includes(1) ? null : "no weekly draft";
    },
  },
  {
    name: "a repeating task's scope is asked, not guessed",
    say: "move gym to tuesday",
    check: (reply, before) => (unchanged(before) && reply.includes("?") ? null : "changed without asking"),
  },
  {
    name: "stop a task repeating",
    say: "stop repeating the gym task",
    check: () => (byTitle("Gym") && !byTitle("Gym")!.recurrence ? null : "still repeating"),
  },
];

async function run() {
  useSettingsStore.setState({ language: "en", aiAutoMode: false });
  const failures: string[] = [];
  let passed = 0;
  for (const testCase of CASES) {
    fakeDb.reset();
    useTaskStore.setState({ tasks: [], unsynced: {}, syncUserId: "eval", ownerId: "eval" });
    useChatStore.setState({ messages: [], pendingActions: [], lastUndo: null, recentlyMentionedTaskIds: [], redirectToNext: null });
    seed();
    // Copies, so a change made in place still shows up against them.
    const before: Snapshot = new Map(tasks().map((task) => [task.id, structuredClone(task)]));

    let reply = await say(testCase.say);
    const firstReply = reply;
    if (testCase.confirm && pending().some((entry) => entry.action.type !== "CREATE_TASK")) reply = await say("yes");
    const problem = testCase.check(reply, before, firstReply);
    if (problem) {
      failures.push(`✖ ${testCase.name}: ${problem}\n    user: ${testCase.say}\n    reply: ${firstReply}${reply !== firstReply ? `\n    after yes: ${reply}` : ""}`);
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
