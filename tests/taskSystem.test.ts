/// <reference types="node" />
// The task system end to end, through the real stores and a fake database:
// AI extraction (scripted model answers) → preview cards → what's saved and
// what the user is told; AI updates from Task Details; archiving; repeating
// tasks on launch and sync. tests/ai-eval*.ts check the real model separately.
process.env.TZ = "Europe/Paris";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import type { InboxAction } from "@/app/api/inbox+api";
import { normalizeReassessment, parseReassessBody, type ReassessResponseBody } from "@/app/api/reassess+api";
import { en } from "@/constants/translations/en";
import { makeDeadline, withDeadline } from "@/lib/deadline";
import { toLocalDateKey } from "@/lib/localDate";
import { recommendTasks } from "@/lib/priority";
import { normalizeRule, startSeries } from "@/lib/recurrence";
import { DEFAULT_REMINDER_PREFERENCES, planNotifications } from "@/lib/reminders";
import { matchesFilter } from "@/lib/taskOperations";
import { recalcAll } from "@/lib/taskPipeline";
import { useChatStore } from "@/store/useChatStore";
import { useReassessStore } from "@/store/useReassessStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTaskStore } from "@/store/useTaskStore";
import type { Task } from "@/types/task";

import { makeTask } from "./helpers";
import { apiCalls, setApiHandler } from "./stubs/api";
import { fakeDb } from "./stubs/supabase";

const USER = "user_1";

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function action(partial: Partial<InboxAction> & Pick<InboxAction, "type">): InboxAction {
  return { taskId: null, taskIds: null, filter: null, fields: {}, confirmationRequired: false, ...partial };
}

function modelAnswers(actions: InboxAction[]) {
  setApiHandler((path) => {
    assert.equal(path, "/api/inbox");
    return { intent: "test", actions, reply: actions.map((entry) => entry.reply ?? "").join(" ") };
  });
}

async function say(text: string): Promise<string> {
  useChatStore.getState().sendMessage(text);
  for (let i = 0; i < 50 && useChatStore.getState().isAiTyping; i += 1) await flush();
  await flush();
  const messages = useChatStore.getState().messages;
  return messages[messages.length - 1]?.text ?? "";
}

function pendingDrafts() {
  return useChatStore.getState().pendingActions.flatMap((pending) => (pending.action.type === "CREATE_TASK" ? pending.action.drafts : []));
}

const tasks = () => useTaskStore.getState().tasks;
const dbRow = (id: string) => fakeDb.rows("tasks").find((row) => row.id === id);
const lastReply = () => useChatStore.getState().messages.at(-1)?.text ?? "";

function dayKey(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return toLocalDateKey(date);
}

beforeEach(async () => {
  fakeDb.reset();
  apiCalls.length = 0;
  useSettingsStore.setState({ language: "en", aiAutoMode: false });
  useTaskStore.setState({ tasks: [], unsynced: {}, syncUserId: USER, ownerId: USER });
  useChatStore.setState({ messages: [], pendingActions: [], lastUndo: null, recentlyMentionedTaskIds: [], syncUserId: USER });
  useReassessStore.setState({ byTask: {} });
  await flush();
});

describe("AI extraction: independent cards, added once each", () => {
  const threeTasks = () =>
    modelAnswers([
      action({ type: "CREATE_TASK", fields: { title: "Study chemistry", estimatedMinutes: 120, dueDatePhrase: "tomorrow" } }),
      action({ type: "CREATE_TASK", fields: { title: "Email my professor", estimatedMinutes: 15 } }),
      action({ type: "CREATE_TASK", fields: { title: "Finish math exercises", estimatedMinutes: 60, dueDatePhrase: "friday at 17:00" } }),
    ]);

  it("one message, three cards — each with its own deadline and length", async () => {
    threeTasks();
    await say("Tomorrow I need to study chemistry for two hours, email my professor, and finish my math exercises by Friday at 5pm.");
    const drafts = pendingDrafts();
    assert.deepEqual(drafts.map((draft) => draft.title), ["Study chemistry", "Email my professor", "Finish math exercises"]);
    assert.equal(new Set(drafts.map((draft) => draft.candidateId)).size, 3);
    assert.deepEqual(drafts.map((draft) => draft.estimatedMinutes), [120, 15, 60]);
    // Tomorrow is a day with no time; the professor has no deadline at all; Friday has its time.
    assert.deepEqual([toLocalDateKey(new Date(drafts[0].dueDate!)), drafts[0].dueHasTime], [dayKey(1), false]);
    assert.equal(drafts[1].dueDate, undefined);
    assert.deepEqual([new Date(drafts[2].dueDate!).getHours(), drafts[2].dueHasTime], [17, true]);
    assert.equal(tasks().length, 0, "nothing is added before the user says so");
  });

  it('"Add Task" on one card adds only that task, once — however often it is tapped', async () => {
    threeTasks();
    await say("three tasks");
    const [chemistry] = pendingDrafts();
    await Promise.all([
      useChatStore.getState().confirmPendingDraft(chemistry.candidateId!),
      useChatStore.getState().confirmPendingDraft(chemistry.candidateId!),
    ]);
    await flush();
    assert.deepEqual(tasks().map((task) => task.title), ["Study chemistry"]);
    assert.deepEqual(pendingDrafts().map((draft) => draft.title), ["Email my professor", "Finish math exercises"]);
    assert.equal(lastReply(), 'Added "Study chemistry" to your tasks.');
    // Even a replayed add of the same candidate lands on the same task.
    useTaskStore.getState().applyStructuredAction({ type: "CREATE_TASK", drafts: [chemistry], confirmationTier: "confirm-required" });
    assert.equal(tasks().length, 1);
  });

  it('"Add all" adds each valid card once; a card missing its title stays to be fixed', async () => {
    threeTasks();
    await say("three tasks");
    const [, email, math] = pendingDrafts();
    useChatStore.getState().updatePendingDraft(email.candidateId!, { title: "  " });
    await useChatStore.getState().confirmAllPendingDrafts();
    await useChatStore.getState().confirmAllPendingDrafts();
    await flush();
    assert.deepEqual(tasks().map((task) => task.title).sort(), ["Finish math exercises", "Study chemistry"]);
    assert.deepEqual(pendingDrafts().map((draft) => draft.candidateId), [email.candidateId]);
    assert.ok(tasks().some((task) => task.id.endsWith(math.candidateId!)));
  });

  it("the same task said twice in one message is one card", async () => {
    modelAnswers([
      action({ type: "CREATE_TASK", fields: { title: "Call mum", estimatedMinutes: 10 } }),
      action({ type: "CREATE_TASK", fields: { title: "call Mum!", estimatedMinutes: 10 } }),
    ]);
    await say("call mum, and don't forget to call mum");
    assert.equal(pendingDrafts().length, 1);
  });

  it("a date-only deadline is saved date-only, into its own columns", async () => {
    threeTasks();
    await say("three tasks");
    const [chemistry] = pendingDrafts();
    await useChatStore.getState().confirmPendingDraft(chemistry.candidateId!);
    await flush();
    const saved = tasks()[0];
    assert.deepEqual([saved.deadline?.date, saved.deadline?.time], [dayKey(1), undefined]);
    const row = dbRow(saved.id)!;
    assert.deepEqual([row.deadline_date, row.deadline_time, row.deadline_timezone], [dayKey(1), null, "Europe/Paris"]);
  });

  it("a date that reads two ways is asked about — nothing is guessed or added", async () => {
    modelAnswers([action({ type: "CREATE_TASK", fields: { title: "Submit form", estimatedMinutes: 20, dueDatePhrase: "3/4" } })]);
    const reply = await say("submit the form by 3/4");
    assert.equal(reply, en.ops.dateUnclear("3/4"));
    assert.equal(pendingDrafts().length, 0);
    assert.equal(tasks().length, 0);

    // The server flags it from the user's own words even when the model guessed a date.
    modelAnswers([
      action({ type: "CREATE_TASK", fields: { title: "Submit form", estimatedMinutes: 20, dueDatePhrase: "March 4", dueDateAmbiguous: true } }),
    ]);
    assert.equal(await say("submit the form by 3/4"), en.ops.dateUnclear("March 4"));
  });

  it("a save the database refuses isn't reported as saved", async () => {
    threeTasks();
    await say("three tasks");
    const [chemistry] = pendingDrafts();
    fakeDb.nextError = { code: "500", message: "database unavailable" };
    await useChatStore.getState().confirmPendingDraft(chemistry.candidateId!);
    await flush();
    assert.equal(lastReply(), `Added "Study chemistry" to your tasks. ${en.assistant.notSavedYet}`);
    assert.ok(tasks()[0].id in useTaskStore.getState().unsynced, "kept to retry");
    assert.equal(dbRow(tasks()[0].id), undefined);
  });
});

describe("AI updates from Task Details keep the same task", () => {
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

  function reassessAnswers(answer: Partial<ReassessResponseBody>) {
    setApiHandler((path, body) => {
      assert.equal(path, "/api/reassess");
      assert.ok(parseReassessBody(JSON.parse(JSON.stringify(body))));
      return normalizeReassessment({ ...NO_FIELDS, summary: "", ...answer });
    });
  }

  function seed(task: Task) {
    useTaskStore.setState({ tasks: recalcAll([task]) });
  }

  it('"the exam moved to October 15" moves a date-only deadline to that day — still date-only, same id', async () => {
    seed(withDeadline(makeTask({ id: "chem", title: "Study chemistry", importance: 50 }), makeDeadline({ date: dayKey(20) })));
    reassessAnswers({ outcome: "update", dueDatePhrase: "October 15", summary: "The exam is earlier." });
    await useReassessStore.getState().submit("chem", { text: "My professor moved the exam to October 15." });
    const saved = tasks().find((task) => task.id === "chem")!;
    assert.equal(tasks().length, 1);
    assert.match(saved.deadline!.date, /-10-15$/);
    assert.equal(saved.deadline!.time, undefined);
    assert.equal(saved.importance, 50, "importance untouched");
  });

  it("a longer estimate changes the length and nothing else", async () => {
    seed(withDeadline(makeTask({ id: "essay", title: "Essay", importance: 75, estimatedMinutes: 60 }), makeDeadline({ date: dayKey(5) })));
    reassessAnswers({ outcome: "update", estimatedMinutes: 240, summary: "More research." });
    await useReassessStore.getState().submit("essay", { text: "It's going to take about four hours." });
    const saved = tasks()[0];
    assert.deepEqual([saved.estimatedMinutes, saved.importance, saved.deadline?.date], [240, 75, dayKey(5)]);
  });

  it("removing the deadline clears it — and its reminders", async () => {
    seed(withDeadline(makeTask({ id: "trip", title: "Plan trip" }), makeDeadline({ date: dayKey(5) })));
    reassessAnswers({ outcome: "update", removeDeadline: true, summary: "No date any more." });
    await useReassessStore.getState().submit("trip", { text: "There's no deadline for this any more." });
    const saved = tasks()[0];
    assert.equal(saved.deadline, undefined);
    assert.equal(saved.dueDate, undefined);
    assert.deepEqual(planNotifications([saved], DEFAULT_REMINDER_PREFERENCES, new Date(), en), []);
  });
});

describe("archiving", () => {
  it("an archived task leaves the list, the recommendations and the reminders — and comes back on restore", async () => {
    const id = useTaskStore.getState().addTask({ title: "Old idea", estimatedMinutes: 30, priorityLevel: "medium", deadline: { date: dayKey(3) } });
    useTaskStore.getState().archiveTask(id);
    await flush();
    const archived = tasks()[0];
    assert.equal(archived.status, "archived");
    assert.equal(dbRow(id)?.status, "archived");
    assert.ok(dbRow(id)?.closed_at);
    const now = new Date();
    assert.equal(matchesFilter(archived, { status: "all" }, now), false);
    assert.deepEqual(recommendTasks(tasks(), { now }), []);
    assert.deepEqual(planNotifications(tasks(), DEFAULT_REMINDER_PREFERENCES, now, en), []);

    useTaskStore.getState().restoreTask(id);
    await flush();
    assert.equal(tasks()[0].status, "pending");
    assert.equal(tasks()[0].closedAt, undefined);
  });
});

describe("repeating tasks on launch and sync", () => {
  it("opening the app again and again, and re-syncing, never duplicates an occurrence", async () => {
    const rule = normalizeRule({ frequency: "daily", interval: 1, anchorDate: dayKey(-3), hour: 18, minute: 0, allDay: true, missed: "skip" })!;
    const first = startSeries(makeTask({ id: "habit", title: "Memorize Qur'an", createdAt: new Date(Date.now() - 4 * 86_400_000).toISOString() }), rule, "series-habit");
    useTaskStore.setState({ tasks: recalcAll([first]) });

    assert.equal(useTaskStore.getState().applyMissedOccurrences(), 2);
    assert.equal(useTaskStore.getState().applyMissedOccurrences(), 0);
    assert.equal(useTaskStore.getState().applyMissedOccurrences(), 0);
    await flush();

    const ids = tasks().map((task) => task.id).sort();
    assert.deepEqual(ids, ["habit", `series-habit@${dayKey(0)}`]);
    assert.equal(tasks().find((task) => task.id === "habit")?.status, "skipped");

    // A sync brings back the same rows: still one of each.
    await useTaskStore.getState().hydrateFromSupabase(USER);
    assert.deepEqual(tasks().map((task) => task.id).sort(), ids);
    assert.equal(fakeDb.rows("tasks").length, 2);
  });
});
