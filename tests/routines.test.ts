/// <reference types="node" />
// Routines vs repeating tasks (the user's call, 2026-10-28): what a repeat is
// by default, and a missed routine just passing at the end of its day.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildRule, defaultRecurrenceKind, isRoutine, normalizeRule, recurrenceKind, startSeries } from "@/lib/recurrence";
import { skipMissedDelta } from "@/lib/taskOperations";
import type { RecurrenceRule, Task } from "@/types/task";

import { local, makeTask } from "./helpers";

function rule(partial: Partial<RecurrenceRule> & Pick<RecurrenceRule, "frequency" | "anchorDate">): RecurrenceRule {
  const normalized = normalizeRule({ interval: 1, hour: 18, minute: 0, ...partial });
  assert.ok(normalized);
  return normalized;
}

function series(id: string, recurrenceRule: RecurrenceRule): Task {
  return startSeries(makeTask({ id, title: id }), recurrenceRule, `series-${id}`);
}

describe("routine or repeating task, by default", () => {
  it("every 3 days or more often is a routine", () => {
    assert.equal(defaultRecurrenceKind({ frequency: "daily", interval: 1 }), "routine");
    assert.equal(defaultRecurrenceKind({ frequency: "daily", interval: 3 }), "routine");
    // Mon, Wed, Fri: about every 2⅓ days.
    assert.equal(defaultRecurrenceKind({ frequency: "weekly", interval: 1, weekdays: [1, 3, 5] }), "routine");
  });

  it("less often than that is a repeating task", () => {
    assert.equal(defaultRecurrenceKind({ frequency: "daily", interval: 4 }), "task");
    // Mon and Thu: every 3½ days.
    assert.equal(defaultRecurrenceKind({ frequency: "weekly", interval: 1, weekdays: [1, 4] }), "task");
    assert.equal(defaultRecurrenceKind({ frequency: "weekly", interval: 1, weekdays: [6] }), "task");
    assert.equal(defaultRecurrenceKind({ frequency: "weekly", interval: 2, weekdays: [1, 3, 5] }), "task");
    assert.equal(defaultRecurrenceKind({ frequency: "monthly", interval: 1 }), "task");
    assert.equal(defaultRecurrenceKind({ frequency: "yearly", interval: 1 }), "task");
  });

  it("a new series keeps its kind — the default, or the one the user picked", () => {
    const now = local(2026, 10, 28, 9);
    assert.equal(buildRule({ frequency: "daily" }, undefined, now)?.kind, "routine");
    assert.equal(buildRule({ frequency: "monthly" }, undefined, now)?.kind, "task");
    assert.equal(buildRule({ frequency: "daily", kind: "task" }, undefined, now)?.kind, "task");
    assert.equal(buildRule({ frequency: "monthly", kind: "routine" }, undefined, now)?.kind, "routine");
  });

  it("the kind survives storage; an unknown value is dropped, and older series get the default", () => {
    assert.equal(normalizeRule({ frequency: "daily", anchorDate: "2026-10-28", kind: "task" })?.kind, "task");
    const odd = normalizeRule({ frequency: "daily", anchorDate: "2026-10-28", kind: "habit" as never });
    assert.equal(odd?.kind, undefined);
    assert.equal(recurrenceKind(odd!), "routine");
    assert.equal(isRoutine(series("water", rule({ frequency: "daily", anchorDate: "2026-10-28" }))), true);
    assert.equal(isRoutine(series("rent", rule({ frequency: "monthly", anchorDate: "2026-10-28" }))), false);
    assert.equal(isRoutine(makeTask({ id: "one-off" })), false);
  });
});

describe("a missed routine just passes", () => {
  const read = series("read", rule({ frequency: "daily", anchorDate: "2026-10-27", allDay: true, kind: "routine" }));

  it("not on its own day: it's still today's", () => {
    assert.equal(skipMissedDelta(read, local(2026, 10, 27, 23, 30), [read]), null);
  });

  it("the next morning it's skipped, and today's comes in", () => {
    const delta = skipMissedDelta(read, local(2026, 10, 28, 8), [read]);
    assert.ok(delta);
    const [skipped, today] = delta.upserts;
    assert.equal(skipped.id, read.id);
    assert.equal(skipped.status, "skipped");
    assert.equal(today.status, "pending");
    assert.equal(today.deadline?.date, "2026-10-28");
  });

  it("whatever the series' missed setting says", () => {
    const keepRoutine = series("walk", rule({ frequency: "daily", anchorDate: "2026-10-27", kind: "routine", missed: "keep" }));
    assert.equal(skipMissedDelta(keepRoutine, local(2026, 10, 28, 8), [keepRoutine])?.upserts[0].status, "skipped");
  });

  it("a routine every 3 days waits for its own next day — nothing shows in between", () => {
    const stretch = series("stretch", rule({ frequency: "daily", interval: 3, anchorDate: "2026-10-27", allDay: true, kind: "routine" }));
    const delta = skipMissedDelta(stretch, local(2026, 10, 28, 8), [stretch]);
    assert.ok(delta);
    assert.equal(delta.upserts[1]?.deadline?.date, "2026-10-30");
  });

  it("a routine left with today's occurrence open isn't touched, even after its time", () => {
    const timed = series("meds", rule({ frequency: "daily", anchorDate: "2026-10-28", hour: 8, minute: 0, kind: "routine" }));
    assert.equal(skipMissedDelta(timed, local(2026, 10, 28, 20), [timed]), null);
  });
});
