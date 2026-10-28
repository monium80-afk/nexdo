/// <reference types="node" />
// Its own file (so its own process): lib/supabaseSync.ts remembers a missing
// column for a few minutes, which would leak into other tests.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { useTaskStore } from "@/store/useTaskStore";
import { deleteTaskRowsIfUnchanged, upsertTaskRows } from "@/lib/supabaseSync";

import { fakeDb } from "./stubs/supabase";

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

describe("sync before the recurrence migration has been run", () => {
  it("rejects a mixed batch before saving any plain rows", async () => {
    fakeDb.reset();
    const plainId = useTaskStore.getState().addTask({ title: "Call mom", estimatedMinutes: 15, priorityLevel: "medium" });
    const repeatingId = useTaskStore.getState().addTask({
      title: "Gym",
      estimatedMinutes: 60,
      priorityLevel: "medium",
      recurrence: { frequency: "daily" },
    });

    describe("cleaning up created task rows", () => {
      it("deletes only when the row still has the version this save wrote", async () => {
        fakeDb.reset();
        fakeDb.tables.set(
          "tasks",
          new Map([["next", { id: "next", user_id: "user_1", updated_at: "2026-10-11T12:00:00.000Z" }]]),
        );

        await deleteTaskRowsIfUnchanged([{ id: "next", updatedAt: "2026-10-11T11:00:00.000Z" }], "user_1");
        assert.ok(fakeDb.rows("tasks").some((row) => row.id === "next"), "a newer remote version is left in place");

        await deleteTaskRowsIfUnchanged([{ id: "next", updatedAt: "2026-10-11T12:00:00.000Z" }], "user_1");
        assert.equal(fakeDb.rows("tasks").some((row) => row.id === "next"), false);
      });
    });
    await flush();
    const tasks = useTaskStore.getState().tasks.filter((task) => task.id === plainId || task.id === repeatingId);
    fakeDb.reset();
    fakeDb.missingColumns.add("recurrence");

    await assert.rejects(upsertTaskRows(tasks, "user_1"), /Repeating tasks can't be saved/);
    assert.deepEqual(fakeDb.writes, []);
    assert.deepEqual(fakeDb.rows("tasks"), []);
  });

  it("still saves plain tasks, and keeps repeating ones unsaved (and retried) instead of saving them without their rule", async () => {
    fakeDb.reset();
    fakeDb.missingColumns.add("recurrence");
    useTaskStore.setState({ tasks: [], unsynced: {}, syncUserId: "user_1", ownerId: "user_1" });

    const plain = useTaskStore.getState().addTask({ title: "Call mom", estimatedMinutes: 15, priorityLevel: "medium" });
    await flush();
    const saved = fakeDb.rows("tasks").find((row) => row.id === plain);
    assert.ok(saved);
    assert.ok(!("recurrence" in saved));
    assert.ok(!(plain in useTaskStore.getState().unsynced));

    const repeating = useTaskStore.getState().addTask({
      title: "Gym",
      estimatedMinutes: 60,
      priorityLevel: "medium",
      recurrence: { frequency: "daily" },
    });
    await flush();
    assert.equal(fakeDb.rows("tasks").find((row) => row.id === repeating), undefined);
    assert.ok(repeating in useTaskStore.getState().unsynced);
  });
});
