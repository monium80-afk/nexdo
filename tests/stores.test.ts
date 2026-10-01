/// <reference types="node" />
// End-to-end through the real stores: what the AI answers → the operation the
// app builds → the confirmation it asks for → what reaches the (fake)
// database → the reply the user reads. The model's answers are scripted here,
// but still go through the inbox route itself; tests/ai-eval.ts checks the real
// model separately.
process.env.TZ = "Europe/Paris";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { parseBody, resolveInboxMessage, type InboxAction, type InboxRequestBody } from "@/app/api/inbox+api";
import { PlanLimitError } from "@/lib/plan";
import { useChatStore } from "@/store/useChatStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTaskStore } from "@/store/useTaskStore";
import type { Task } from "@/types/task";

import { apiCalls, setApiHandler } from "./stubs/api";
import { fakeDb } from "./stubs/supabase";

const USER = "user_1";
const DAY = 24 * 60 * 60 * 1000;

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

/** A local date `days` from today at hour:minute. */
function at(days: number, hour = 18, minute = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function action(partial: Partial<InboxAction> & Pick<InboxAction, "type">): InboxAction {
  return { taskId: null, taskIds: null, filter: null, fields: {}, confirmationRequired: false, ...partial };
}

/**
 * In the next /api/inbox call, the model answers with these actions, one per
 * turn (none: it has nothing to do). The request goes through the route's own
 * validator and the answers through the route itself, so a test can't pass on
 * a request, an action or a confirmation flag the real route would refuse or
 * change.
 */
function modelAnswers(actions: InboxAction[], check?: (body: InboxRequestBody) => void) {
  setApiHandler((path, body) => {
    assert.equal(path, "/api/inbox");
    const parsed = parseBody(JSON.parse(JSON.stringify(body)));
    assert.ok(parsed, "the inbox route would reject this request");
    check?.(parsed);
    const turns = actions.length > 0 ? actions : [action({ type: "NONE" })];
    let turn = 0;
    return resolveInboxMessage(parsed, async () => {
      const answer = turns[turn];
      turn += 1;
      const remainingMessage = turn < turns.length ? `the rest (${turn})` : null;
      return { intent: "test", action: answer, remainingMessage, reply: answer.reply ?? "" };
    });
  });
}

async function say(text: string): Promise<string> {
  useChatStore.getState().sendMessage(text);
  for (let i = 0; i < 50 && useChatStore.getState().isAiTyping; i += 1) await flush();
  await flush();
  const messages = useChatStore.getState().messages;
  return messages[messages.length - 1].text;
}

function task(id: string): Task | undefined {
  return useTaskStore.getState().tasks.find((candidate) => candidate.id === id);
}

function dbRow(id: string) {
  return fakeDb.rows("tasks").find((row) => row.id === id);
}

/** Aliases the app sent the model, by title, from the last request. */
function aliasOf(title: string): string {
  const body = apiCalls[apiCalls.length - 1]?.body as InboxRequestBody | undefined;
  const entry = body?.tasks.find((candidate) => candidate.title === title);
  assert.ok(entry, `"${title}" was not sent to the model`);
  return entry.id;
}

function seed(input: Parameters<ReturnType<typeof useTaskStore.getState>["addTask"]>[0]): string {
  return useTaskStore.getState().addTask(input);
}

beforeEach(async () => {
  fakeDb.reset();
  apiCalls.length = 0;
  useSettingsStore.setState({ language: "en", aiAutoMode: false });
  useTaskStore.setState({ tasks: [], unsynced: {}, syncUserId: USER, ownerId: USER });
  useChatStore.setState({ messages: [], pendingActions: [], lastUndo: null, recentlyMentionedTaskIds: [], planLimit: null, syncUserId: USER });
  await flush();
});

describe("repeating tasks in the store", () => {
  it("completing an occurrence saves it and creates the next one, once; reopening takes the next one back", async () => {
    const id = seed({ title: "Gym", estimatedMinutes: 60, priorityLevel: "medium", dueDate: at(1, 7), recurrence: { frequency: "weekly" } });
    await flush();
    const seriesId = task(id)!.recurrence!.seriesId;

    useTaskStore.getState().completeTask(id);
    await flush();
    const occurrences = useTaskStore.getState().tasks.filter((entry) => entry.recurrence?.seriesId === seriesId);
    assert.equal(occurrences.length, 2);
    const next = occurrences.find((entry) => entry.status === "pending")!;
    assert.match(next.id, new RegExp(`^${seriesId}@\\d{4}-\\d{2}-\\d{2}$`));
    assert.equal(new Date(next.dueDate!).getHours(), 7);
    assert.equal(Math.round((Date.parse(next.dueDate!) - Date.parse(task(id)!.dueDate!)) / DAY), 7);
    // Both rows went up in one request.
    assert.deepEqual(fakeDb.writes.at(-1), { table: "tasks", kind: "upsert", ids: [id, next.id] });
    assert.equal(dbRow(id)?.status, "completed");

    // Completing it again (a double tap, a replayed sync) creates nothing new.
    useTaskStore.getState().completeTask(id);
    await flush();
    assert.equal(useTaskStore.getState().tasks.filter((entry) => entry.recurrence?.seriesId === seriesId).length, 2);

    useTaskStore.getState().reopenTask(id);
    await flush();
    assert.equal(task(next.id), undefined);
    assert.equal(dbRow(next.id), undefined);
    assert.equal(task(id)?.status, "pending");
  });

  it("deleting one occurrence skips to the next; deleting the series removes every occurrence", async () => {
    const id = seed({ title: "Standup", estimatedMinutes: 15, priorityLevel: "medium", dueDate: at(1, 9), recurrence: { frequency: "daily" } });
    await flush();
    const seriesId = task(id)!.recurrence!.seriesId;
    useTaskStore.getState().deleteTask(id, "this");
    await flush();
    const remaining = useTaskStore.getState().tasks.filter((entry) => entry.recurrence?.seriesId === seriesId);
    assert.equal(remaining.length, 1);
    assert.notEqual(remaining[0].id, id);

    useTaskStore.getState().deleteTask(remaining[0].id, "series");
    await flush();
    assert.equal(useTaskStore.getState().tasks.length, 0);
    assert.equal(fakeDb.rows("tasks").length, 0);
  });
});

describe("bulk operations reach the database in one request", () => {
  it("postponing every open task writes all of them together, and nothing else", async () => {
    const a = seed({ title: "Essay", estimatedMinutes: 90, priorityLevel: "high", dueDate: at(2) });
    const b = seed({ title: "Groceries", estimatedMinutes: 30, priorityLevel: "low", dueDate: at(3, 10, 30) });
    seed({ title: "Read", estimatedMinutes: 30, priorityLevel: "low" });
    const done = seed({ title: "Old", estimatedMinutes: 30, priorityLevel: "low", dueDate: at(-1) });
    useTaskStore.getState().completeTask(done);
    await flush();
    fakeDb.writes = [];

    useTaskStore.getState().executeOperation({ kind: "update", target: { filter: {} }, changes: { dueShift: { amount: 2, unit: "weeks" } } });
    await flush();
    assert.equal(fakeDb.writes.length, 1);
    assert.deepEqual([...fakeDb.writes[0].ids].sort(), [a, b].sort());
    assert.equal(new Date(dbRow(b)!.due_date as string).getHours(), 10);
  });
});

describe("AI chat: the reply matches what was written", () => {
  it("postpones all open tasks by two weeks after a confirmation that lists them, then undoes it in one step", async () => {
    const essay = seed({ title: "Essay", estimatedMinutes: 90, priorityLevel: "high", dueDate: at(2) });
    const groceries = seed({ title: "Groceries", estimatedMinutes: 30, priorityLevel: "low", dueDate: at(3) });
    seed({ title: "Read", estimatedMinutes: 30, priorityLevel: "low" });
    await flush();
    const before = task(essay)!.dueDate!;

    modelAnswers([
      action({
        type: "UPDATE_TASKS",
        filter: { status: "pending" },
        fields: { dueDateShift: { amount: 2, unit: "weeks" } },
        confirmationRequired: true,
        reply: "Pushing your open tasks back two weeks.",
      }),
    ]);
    const question = await say("postpone all my tasks by two weeks");
    assert.match(question, /^Move the deadlines of 3 tasks 2 weeks later\?/);
    assert.match(question, /"Essay"/);
    assert.equal(task(essay)!.dueDate, before, "nothing changes before the yes");

    const reply = await say("yes");
    assert.equal(reply, "Moved the deadlines of 2 tasks 2 weeks later. 1 task has no deadline and was left as it is.");
    assert.equal(Math.round((Date.parse(task(essay)!.dueDate!) - Date.parse(before)) / DAY), 14);
    assert.equal(dbRow(groceries)!.due_date, task(groceries)!.dueDate);

    await say("undo");
    assert.equal(task(essay)!.dueDate, before);
  });

  it("sends completed tasks to the AI with their completion time, and reopens one", async () => {
    const chem = seed({ title: "Chemistry assignment", estimatedMinutes: 60, priorityLevel: "high", dueDate: at(-2) });
    useTaskStore.getState().completeTask(chem);
    useTaskStore.setState((state) => ({
      tasks: state.tasks.map((entry) => (entry.id === chem ? { ...entry, completedAt: at(-1, 15, 12) } : entry)),
    }));
    seed({ title: "Groceries", estimatedMinutes: 30, priorityLevel: "low" });
    await flush();

    let alias = "";
    modelAnswers([], (body) => {
      const sent = body.tasks.find((entry) => entry.title === "Chemistry assignment");
      assert.ok(sent, "the completed task is part of the AI's context");
      assert.equal(sent.status, "completed");
      assert.match(sent.completedLabel ?? "", /^Completed yesterday at 3:12/);
      alias = sent.id;
      assert.match(alias, /^t\d+$/, "the model sees a short alias, not the real id");
    });
    await say("what happened to my chemistry assignment?");
    assert.ok(alias);

    modelAnswers([action({ type: "REOPEN_TASK", taskId: alias, reply: "Reopened it." })]);
    const reply = await say("reopen the chemistry assignment I finished yesterday");
    assert.equal(reply, `Reopened "Chemistry assignment" — it's back on your list.`);
    assert.equal(task(chem)!.status, "pending");
    assert.equal(dbRow(chem)!.status, "pending");
  });

  it("editing a completed task keeps it completed, and says so", async () => {
    const chem = seed({ title: "Chemistry assignment", estimatedMinutes: 60, priorityLevel: "high", dueDate: at(-2) });
    useTaskStore.getState().completeTask(chem);
    await flush();
    modelAnswers([]);
    await say("hi");
    const alias = aliasOf("Chemistry assignment");

    modelAnswers([action({ type: "UPDATE_TASK", taskId: alias, fields: { dueDatePhrase: "in 3 days" }, reply: "Moved." })]);
    const reply = await say("change the deadline of the chemistry assignment I completed to in 3 days");
    assert.match(reply, /^Updated "Chemistry assignment" — it's still marked as completed\. New deadline: /);
    assert.equal(task(chem)!.status, "completed");
    assert.equal(dbRow(chem)!.status, "completed");
  });

  it("asks which occurrences before editing a repeating task, and changes nothing meanwhile", async () => {
    const gym = seed({ title: "Gym", estimatedMinutes: 60, priorityLevel: "medium", dueDate: at(1, 7), recurrence: { frequency: "weekly" } });
    await flush();
    modelAnswers([]);
    await say("hi");
    const alias = aliasOf("Gym");
    const taskWrites = () => fakeDb.writes.filter((write) => write.table === "tasks").length;
    const writes = taskWrites();

    modelAnswers([action({ type: "UPDATE_TASK", taskId: alias, fields: { title: "Gym (legs)" }, reply: "Renamed." })]);
    const reply = await say("rename gym to Gym (legs)");
    assert.match(reply, /^"Gym" repeats \(Every week on .+\)\. Should I change just this occurrence, or this one and all future ones\?$/);
    assert.equal(task(gym)!.title, "Gym");
    assert.equal(taskWrites(), writes);

    modelAnswers([action({ type: "UPDATE_TASK", taskId: alias, fields: { title: "Gym (legs)", recurrenceScope: "future" }, reply: "Renamed." })]);
    await say("all future ones");
    assert.equal(task(gym)!.title, "Gym (legs)");
    assert.equal(task(gym)!.recurrence!.template.title, "Gym (legs)");
  });

  it("asks before deleting everything, and a no leaves every task in place", async () => {
    seed({ title: "A", estimatedMinutes: 30, priorityLevel: "low" });
    seed({ title: "B", estimatedMinutes: 30, priorityLevel: "low" });
    await flush();
    modelAnswers([action({ type: "DELETE_TASKS", filter: { status: "all" }, confirmationRequired: true, reply: "Ready." })]);
    const question = await say("delete everything");
    assert.match(question, /^Delete 2 tasks\?/);
    const reply = await say("cancel");
    assert.equal(reply, "No worries — I won't make that change.");
    assert.equal(useTaskStore.getState().tasks.length, 2);
    assert.equal(fakeDb.rows("tasks").length, 2);
  });

  it("reports a task id the model made up instead of acting on it", async () => {
    seed({ title: "A", estimatedMinutes: 30, priorityLevel: "low" });
    await flush();
    modelAnswers([action({ type: "COMPLETE_TASK", taskId: "t99", reply: "Done!" })]);
    const reply = await say("mark it done");
    assert.equal(reply, "I couldn't find that task — it may have been deleted. Nothing was changed.");
    assert.equal(useTaskStore.getState().tasks[0].status, "pending");
  });

  it("reports unresolved bulk task ids instead of applying an empty filter to every task", async () => {
    seed({ title: "A", estimatedMinutes: 30, priorityLevel: "low" });
    await flush();
    modelAnswers([action({ type: "COMPLETE_TASKS", taskIds: ["t99"] })]);
    const reply = await say("complete that task");
    assert.equal(reply, "I couldn't find that task — it may have been deleted. Nothing was changed.");
    assert.equal(useTaskStore.getState().tasks[0].status, "pending");
  });

  it("keeps meaningful filters when the bulk task ids do not resolve", async () => {
    const open = seed({ title: "A", estimatedMinutes: 30, priorityLevel: "low" });
    await flush();
    modelAnswers([action({ type: "COMPLETE_TASKS", taskIds: ["t99"], filter: { status: "pending" } })]);
    assert.match(await say("complete the open tasks"), /^Mark 1 task as done\?/);
    await say("yes");
    assert.equal(useTaskStore.getState().tasks.find((candidate) => candidate.id === open)?.status, "completed");
  });

  it("marks only the keyword-matched assignments done, after confirming the list", async () => {
    const one = seed({ title: "Math assignment", estimatedMinutes: 30, priorityLevel: "medium" });
    const two = seed({ title: "History assignment", estimatedMinutes: 30, priorityLevel: "medium" });
    const other = seed({ title: "Groceries", estimatedMinutes: 30, priorityLevel: "low" });
    await flush();
    modelAnswers([action({ type: "COMPLETE_TASKS", filter: { status: "pending", titleKeywords: ["assignment"] }, confirmationRequired: true })]);
    const question = await say("mark all the assignments as done");
    assert.match(question, /^Mark 2 tasks as done\?/);
    const reply = await say("yes");
    assert.equal(reply, "Marked 2 tasks as done.");
    assert.equal(task(one)!.status, "completed");
    assert.equal(task(two)!.status, "completed");
    assert.equal(task(other)!.status, "pending");
  });

  it("previews a new task with no message, and says Added only once it is added", async () => {
    modelAnswers([
      action({
        type: "CREATE_TASK",
        fields: { title: "Call the plumber", estimatedMinutes: 15 },
        confirmationRequired: true,
        reply: "Added “Call the plumber” (~15m).",
      }),
    ]);
    useChatStore.getState().sendMessage("call the plumber");
    for (let i = 0; i < 50 && useChatStore.getState().isAiTyping; i += 1) await flush();
    await flush();
    // The card is the preview (under "Found 1 task" on screen) — no reply
    // goes into the thread claiming it was added.
    assert.deepEqual(useChatStore.getState().messages.map((message) => message.role), ["user"]);
    assert.equal(useChatStore.getState().isAiTyping, false);
    assert.equal(useChatStore.getState().pendingActions.length, 1);
    assert.equal(useTaskStore.getState().tasks.length, 0);

    const draft = useChatStore.getState().pendingActions[0].action;
    assert.equal(draft.type, "CREATE_TASK");
    await useChatStore.getState().confirmPendingDraft(draft.type === "CREATE_TASK" ? draft.drafts[0].candidateId! : "");
    await flush();
    assert.equal(useChatStore.getState().messages.at(-1)?.text, 'Added "Call the plumber" to your tasks.');
    assert.equal(useTaskStore.getState().tasks[0].title, "Call the plumber");
  });

  it("lists completed tasks from the whole list, not just what the model saw", async () => {
    for (let i = 0; i < 3; i += 1) {
      const id = seed({ title: `Done ${i}`, estimatedMinutes: 10, priorityLevel: "low" });
      useTaskStore.getState().completeTask(id);
    }
    seed({ title: "Open", estimatedMinutes: 10, priorityLevel: "low" });
    await flush();
    modelAnswers([action({ type: "LIST_TASKS", filter: { status: "completed", completedWithin: "this week" }, reply: "Here you go." })]);
    const reply = await say("show me the tasks I completed this week");
    assert.match(reply, /^3 tasks match:\n• Done/);
    assert.ok(!reply.includes("Open"));
  });

  it("says the month's AI messages are used up, instead of guessing offline or claiming an outage", async () => {
    setApiHandler(() => {
      throw new PlanLimitError("chat", "free");
    });
    const reply = await say("buy milk tomorrow at 5pm");
    assert.equal(
      reply,
      "You've used this month's AI chat messages. Nexdo Pro gives you far more each month — and adding tasks by hand is always free.",
    );
    // The offline rules would have drafted "Buy milk" here: nothing may be
    // proposed or changed by a message that wasn't answered.
    assert.equal(useChatStore.getState().pendingActions.length, 0);
    assert.equal(useTaskStore.getState().tasks.length, 0);
    assert.equal(useChatStore.getState().isAiTyping, false);
    // What the chat screen reads to open the paywall.
    assert.equal(useChatStore.getState().planLimit, "chat");
  });
});
