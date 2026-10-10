/// <reference types="node" />
// What happens to changes that haven't reached Supabase yet: a delete made
// offline, a save and a delete of the same task racing each other, a delete
// from another device, and signing out while a request is still on its way.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { useTaskStore } from "@/store/useTaskStore";

import { fakeDb } from "./stubs/supabase";

const USER = "user_1";
const OFFLINE = { code: "08006", message: "network request failed" };

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function addTask(title: string): string {
  return useTaskStore.getState().addTask({ title, estimatedMinutes: 30, priorityLevel: "medium" });
}

function localTask(id: string) {
  return useTaskStore.getState().tasks.find((task) => task.id === id);
}

function dbRow(id: string) {
  return fakeDb.rows("tasks").find((row) => row.id === id);
}

beforeEach(async () => {
  fakeDb.reset();
  useTaskStore.setState({ tasks: [], unsynced: {}, pendingDeletes: {}, syncUserId: USER, ownerId: USER });
  await flush();
});

describe("task deletes that haven't reached Supabase", () => {
  it("a failed delete is remembered, and the next sync sends it again instead of bringing the task back", async () => {
    const id = addTask("Old errand");
    await flush();
    fakeDb.nextError = OFFLINE;
    useTaskStore.getState().deleteTask(id);
    await flush();
    assert.ok(dbRow(id), "the delete didn't get through");
    assert.ok(id in useTaskStore.getState().pendingDeletes);

    await useTaskStore.getState().hydrateFromSupabase(USER);
    await flush();
    assert.equal(localTask(id), undefined, "still deleted on the phone");
    assert.equal(dbRow(id), undefined, "and now in the account too");
    assert.deepEqual(useTaskStore.getState().pendingDeletes, {});
  });

  it("a delete still unsent at sign-out is set aside and sent at the next sign-in here", async () => {
    const id = addTask("Old errand");
    await flush();
    fakeDb.nextError = OFFLINE;
    useTaskStore.getState().deleteTask(id);
    await flush();

    await useTaskStore.getState().handleSignOut();
    assert.deepEqual(useTaskStore.getState().pendingDeletes, {});
    await useTaskStore.getState().hydrateFromSupabase(USER);
    await flush();
    assert.equal(localTask(id), undefined);
    assert.equal(dbRow(id), undefined);
  });

  it("a task deleted while signed out of any account leaves nothing to send", () => {
    useTaskStore.setState({ syncUserId: null, ownerId: null });
    const id = addTask("Scratch");
    useTaskStore.getState().deleteTask(id);
    assert.deepEqual(useTaskStore.getState().pendingDeletes, {});
  });
});

describe("saves and deletes of one task reach Supabase in order", () => {
  it("an edit still on its way when the task is deleted can't bring its row back", async () => {
    const id = addTask("Draft");
    await flush();
    const release = fakeDb.holdUpserts();
    useTaskStore.getState().updateTask(id, { title: "Draft v2" });
    useTaskStore.getState().deleteTask(id);
    await flush();
    assert.ok(dbRow(id), "the delete waits for the edit sent before it");

    release();
    await flush();
    assert.equal(dbRow(id), undefined);
    assert.deepEqual(
      fakeDb.writes.slice(-2).map((write) => write.kind),
      ["upsert", "delete"],
    );
  });
});

describe("realtime deletes from another device", () => {
  it("keeps an edit this phone hasn't saved yet, and puts it back up", async () => {
    useTaskStore.getState().subscribeToRealtime(USER);
    const edited = addTask("Shared");
    const untouched = addTask("Also shared");
    await flush();
    fakeDb.nextError = OFFLINE;
    useTaskStore.getState().updateTask(edited, { title: "Shared, edited offline" });
    await flush();
    assert.ok(edited in useTaskStore.getState().unsynced);

    for (const id of [edited, untouched]) {
      fakeDb.tables.get("tasks")!.delete(id);
      fakeDb.emit("tasks", { eventType: "DELETE", old: { id, user_id: USER } });
    }
    await flush();
    assert.equal(localTask(edited)?.title, "Shared, edited offline");
    assert.equal(dbRow(edited)?.title, "Shared, edited offline", "and it went up again");
    assert.equal(localTask(untouched), undefined, "a task with nothing unsaved goes, as before");
    useTaskStore.getState().unsubscribeFromRealtime();
  });
});

describe("signing out while a save is on its way", () => {
  it("doesn't mistake the cleared list for a delete and remove the row", async () => {
    const id = addTask("Essay");
    await flush();
    const release = fakeDb.holdUpserts();
    const saving = useTaskStore.getState().saveTaskNow(id, (current) => ({
      ...current,
      title: "Essay (reassessed)",
      updatedAt: new Date(Date.now() + 1).toISOString(),
    }));
    await flush();
    await useTaskStore.getState().handleSignOut();
    release();
    const result = await saving;
    await flush();

    assert.equal(result.ok, false);
    assert.equal(dbRow(id)?.title, "Essay (reassessed)");
  });
});
