/// <reference types="node" />
// Accounts with more rows than Supabase returns in one request (1,000), and a
// task saved while the list was being read — the cases a re-sync on coming
// back to the app (hooks/useAuthSync.ts) has to get right.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { useChatStore } from "@/store/useChatStore";
import { useTaskStore } from "@/store/useTaskStore";

import { fakeDb } from "./stubs/supabase";

const USER = "user_1";

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function taskRow(id: string, updatedAt: string) {
  return {
    id,
    user_id: USER,
    title: `Task ${id}`,
    status: "pending",
    due_date: null,
    estimated_minutes: 30,
    created_at: updatedAt,
    updated_at: updatedAt,
    notes: null,
    subtasks: null,
    current_step_id: null,
    priority_score: 0,
    suitability_score: 0,
    importance: 50,
    complexity: "simple",
    ai_context: { notes: [] },
    skip: null,
    completed_at: null,
  };
}

function seedTable(name: string, rows: { id: string }[]) {
  fakeDb.tables.set(name, new Map(rows.map((row) => [row.id, row])));
}

beforeEach(async () => {
  fakeDb.reset();
  useTaskStore.setState({ tasks: [], unsynced: {}, pendingDeletes: {}, syncUserId: USER, ownerId: USER });
  useChatStore.setState({ messages: [], unsynced: {}, pendingActions: [], lastUndo: null, syncUserId: USER });
  await flush();
});

describe("more rows than one request returns", () => {
  it("every task comes back, past the first 1,000 — none is taken for deleted", async () => {
    const at = new Date(Date.now() - 60_000).toISOString();
    const rows = Array.from({ length: 1205 }, (_, index) => taskRow(`t-${String(index).padStart(5, "0")}`, at));
    seedTable("tasks", rows);
    // Already on the phone, and saved long ago: if its row were missing from
    // the read, the merge would drop it as deleted on another device.
    useTaskStore.setState({ tasks: [], unsynced: {} });

    assert.equal(await useTaskStore.getState().hydrateFromSupabase(USER), true);
    assert.equal(useTaskStore.getState().tasks.length, 1205);
    assert.ok(useTaskStore.getState().tasks.some((task) => task.id === "t-01204"));
  });

  it("the chat loads its newest messages, oldest of them first", async () => {
    const start = Date.parse("2026-01-01T00:00:00Z");
    const rows = Array.from({ length: 350 }, (_, index) => ({
      id: `m-${index}`,
      user_id: USER,
      role: "user",
      text: `Message ${index}`,
      created_at: new Date(start + index * 60_000).toISOString(),
      attachment: null,
      related_task_id: null,
    }));
    seedTable("chat_messages", rows);

    assert.equal(await useChatStore.getState().hydrateFromSupabase(USER), true);
    const texts = useChatStore.getState().messages.map((message) => message.text);
    assert.equal(texts.length, 300);
    assert.equal(texts[0], "Message 50");
    assert.equal(texts.at(-1), "Message 349", "the latest message is there, at the end");
  });
});

describe("re-reading the list while tasks change", () => {
  it("a task saved after the read was sent stays; one deleted elsewhere long ago goes", async () => {
    const longAgo = new Date(Date.now() - 3_600_000).toISOString();
    const justNow = new Date(Date.now() + 1_000).toISOString();
    const local = (id: string, updatedAt: string) => ({
      id,
      title: id,
      status: "pending" as const,
      estimatedMinutes: 30,
      createdAt: updatedAt,
      updatedAt,
      priorityScore: 0,
      suitabilityScore: 0,
      importance: 50,
      complexity: "simple" as const,
      aiContext: { notes: [] },
    });
    // Neither is waiting to be saved and neither is in the account's rows:
    // one was edited while the read was on its way (its save landed too late
    // for it), the other was deleted on another device.
    useTaskStore.setState({ tasks: [local("saved-during-read", justNow), local("deleted-elsewhere", longAgo)], unsynced: {} });

    assert.equal(await useTaskStore.getState().hydrateFromSupabase(USER), true);
    await flush();
    const ids = useTaskStore.getState().tasks.map((task) => task.id);
    assert.ok(ids.includes("saved-during-read"));
    assert.ok(!ids.includes("deleted-elsewhere"));
    assert.ok(fakeDb.rows("tasks").some((row) => row.id === "saved-during-read"), "and it goes up again");
  });

  it("a failed read says so, so it can be tried again", async () => {
    // The fake only fails writes on request; a table that throws when read is
    // what the real client does offline.
    fakeDb.tables.set(
      "tasks",
      new Proxy(new Map(), {
        get: () => {
          throw new Error("offline");
        },
      }) as never,
    );
    const read = await useTaskStore.getState().hydrateFromSupabase(USER);
    fakeDb.tables.delete("tasks");
    assert.equal(read, false);
  });
});
