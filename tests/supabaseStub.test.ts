/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { fakeDb, supabase } from "./stubs/supabase";

beforeEach(() => fakeDb.reset());

describe("the Supabase test stub", () => {
  it("deep-clones rows on upsert and snapshots reads before a held response is released", async () => {
    const row = { id: "task", nested: { items: [{ label: "original" }] } };
    await supabase.from("tasks").upsert(row);
    row.nested.items[0].label = "mutated input";
    assert.deepEqual(fakeDb.rows("tasks")[0].nested, { items: [{ label: "original" }] });

    const release = fakeDb.holdReads();
    const read = new Promise<{ data?: Record<string, unknown>[] | null; error: unknown }>((resolve) => {
      supabase.from("tasks").select().then(resolve);
    });
    const stored = fakeDb.tables.get("tasks")!.get("task")!;
    (stored.nested as { items: { label: string }[] }).items[0].label = "mutated storage";
    release();

    const result = await read;
    assert.deepEqual(result.data?.[0].nested, { items: [{ label: "original" }] });
  });

  it("snapshots upsert rows before a held write is released", async () => {
    const row = { id: "task", nested: { label: "original" } };
    const release = fakeDb.holdUpserts();
    const writing = new Promise<void>((resolve) => {
      supabase.from("tasks").upsert(row).then(() => resolve());
    });
    row.nested.label = "mutated while waiting";
    release();
    await writing;

    assert.deepEqual(fakeDb.rows("tasks")[0], { id: "task", nested: { label: "original" } });
  });

  it("returns deleted rows after delete.select and keeps ordinary selects read-only", async () => {
    fakeDb.tables.set("tasks", new Map([
      ["keep", { id: "keep", owner: "other" }],
      ["remove", { id: "remove", owner: "user" }],
    ]));

    const selected = await supabase.from("tasks").select();
    assert.equal(selected.error, null);
    assert.equal(fakeDb.writes.length, 0);

    const deleted = await supabase.from("tasks").delete().eq("owner", "user").select();
    assert.deepEqual(deleted.data, [{ id: "remove", owner: "user" }]);
    assert.deepEqual(fakeDb.rows("tasks"), [{ id: "keep", owner: "other" }]);
  });
});
