/// <reference types="node" />
// Its own file (so its own process): lib/supabaseSync.ts remembers a missing
// column for a few minutes, which would leak into other tests.
//
// Before supabase/schema.sql has been re-run, the tasks table has no
// deadline_date / reminder_settings / pinned_at / closed_at columns. Saving
// must keep working (a missing column once broke every save for a week), and
// what only the phone can hold for now mustn't be lost on the next sync.
process.env.TZ = "Europe/Paris";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { useTaskStore } from "@/store/useTaskStore";

import { fakeDb } from "./stubs/supabase";

const USER = "user_1";

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

describe("sync before the deadline/reminder migration has been run", () => {
  it("still saves every task — without the new columns — and keeps the date-only deadline on the phone across a re-fetch", async () => {
    fakeDb.reset();
    ["deadline_date", "deadline_time", "deadline_timezone", "reminder_settings", "pinned_at", "closed_at"].forEach((column) =>
      fakeDb.missingColumns.add(column),
    );
    useTaskStore.setState({ tasks: [], unsynced: {}, syncUserId: USER, ownerId: USER });

    const id = useTaskStore.getState().addTask({
      title: "Hand in essay",
      estimatedMinutes: 60,
      priorityLevel: "medium",
      deadline: { date: "2026-10-15" },
    });
    await flush();

    const row = fakeDb.rows("tasks").find((entry) => entry.id === id);
    assert.ok(row, "the task was saved");
    assert.ok(!("deadline_date" in row));
    assert.ok(row.due_date, "the instant is there, so no deadline is lost");
    assert.ok(!(id in useTaskStore.getState().unsynced));

    await useTaskStore.getState().hydrateFromSupabase(USER);
    const task = useTaskStore.getState().tasks.find((entry) => entry.id === id)!;
    assert.deepEqual([task.deadline?.date, task.deadline?.time], ["2026-10-15", undefined], "still date-only, not 23:59");
  });
});
