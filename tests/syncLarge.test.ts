/// <reference types="node" />
// Accounts with more rows than Supabase returns in one request (1,000), and a
// task saved while the list was being read — the cases a re-sync on coming
// back to the app (hooks/useAuthSync.ts) has to get right.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

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
});

describe("re-reading the list while tasks change", () => {
  it("tasks added and edited while the read is out stay as they are now; one deleted elsewhere long ago goes", async () => {
    const longAgo = new Date(Date.now() - 3_600_000).toISOString();
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
    // "kept" is saved to the account; "deleted-elsewhere" was saved once but
    // its row is gone — another device deleted it. Neither waits to be saved.
    seedTable("tasks", [taskRow("kept", longAgo)]);
    useTaskStore.setState({ tasks: [local("kept", longAgo), local("deleted-elsewhere", longAgo)], unsynced: {} });

    // The read goes out, and its answer is held back while the user adds a
    // task and renames another — both saved before the stale answer arrives.
    const release = fakeDb.holdReads();
    const reading = useTaskStore.getState().hydrateFromSupabase(USER);
    let answered = false;
    void reading.then(() => (answered = true));
    await flush();
    const added = useTaskStore.getState().addTask({ title: "Added during the read", estimatedMinutes: 20, priorityLevel: "medium" });
    useTaskStore.getState().updateTask("kept", { title: "Renamed during the read" });
    await flush();
    assert.ok(fakeDb.rows("tasks").some((row) => row.id === added), "the new task's save landed during the read");
    assert.deepEqual(useTaskStore.getState().unsynced, {}, "both saves are confirmed — nothing marks them as pending");

    assert.equal(answered, false, "the read is still out");
    release();
    assert.equal(await reading, true);
    await flush();
    const tasks = useTaskStore.getState().tasks;
    assert.ok(tasks.some((task) => task.id === added), "the task added during the read stays");
    assert.equal(tasks.find((task) => task.id === "kept")?.title, "Renamed during the read", "the stale answer doesn't undo the rename");
    assert.ok(!tasks.some((task) => task.id === "deleted-elsewhere"));
    assert.equal(fakeDb.rows("tasks").find((row) => row.id === "kept")?.title, "Renamed during the read");
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
