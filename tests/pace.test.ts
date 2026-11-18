/// <reference types="node" />
// Your pace and the Insights numbers (lib/pace.ts), from the focus log.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  adjustToPace,
  buildInsights,
  completionDays,
  computePace,
  paceSamples,
  type CompletionEntry,
  type FocusEntry,
} from "@/lib/pace";

import { makeTask } from "./helpers";

// Wednesday, November 4, 2026, 18:00 local time.
const NOW = new Date(2026, 10, 4, 18, 0, 0);

let counter = 0;
function session(overrides: Partial<FocusEntry> & { taskId: string }): FocusEntry {
  counter += 1;
  const startedAt = overrides.startedAt ?? new Date(2026, 10, 4, 9, counter).toISOString();
  return {
    id: `f${counter}`,
    userId: "u1",
    startedAt,
    endedAt: startedAt,
    focusedMinutes: 30,
    estimateMinutes: 30,
    completed: true,
    ...overrides,
  };
}

/** n tasks finished in one session each, given `estimate` minutes and taking `actual`. */
function finished(n: number, estimate: number, actual: number): FocusEntry[] {
  return Array.from({ length: n }, (_, index) =>
    session({ taskId: `t-${estimate}-${actual}-${index}`, estimateMinutes: estimate, focusedMinutes: actual }),
  );
}

describe("pace", () => {
  it("counts a task over several sessions against its first length", () => {
    const samples = paceSamples([
      session({ taskId: "a", estimateMinutes: 60, focusedMinutes: 40, completed: false, startedAt: "2026-11-02T09:00:00Z" }),
      session({ taskId: "a", estimateMinutes: 20, focusedMinutes: 50, completed: true, startedAt: "2026-11-03T09:00:00Z" }),
    ]);
    assert.equal(samples.length, 1);
    assert.equal(samples[0].estimate, 60);
    assert.equal(samples[0].actual, 90);
    assert.equal(samples[0].ratio, 1.5);
  });

  it("leaves out unfinished tasks and forgotten timers", () => {
    const samples = paceSamples([
      session({ taskId: "open", completed: false }),
      session({ taskId: "forgotten", estimateMinutes: 10, focusedMinutes: 240 }),
      session({ taskId: "fine", estimateMinutes: 30, focusedMinutes: 45 }),
    ]);
    assert.deepEqual(samples.map((sample) => sample.actual), [45]);
  });

  it("says nothing before five finished tasks", () => {
    assert.equal(computePace(finished(4, 30, 45)), null);
    assert.equal(computePace(finished(5, 30, 45))?.factor, 1.5);
  });

  it("tells short and long tasks apart", () => {
    const pace = computePace([...finished(3, 15, 15), ...finished(3, 60, 120)]);
    assert.equal(pace?.short?.factor, 1);
    assert.equal(pace?.long?.factor, 2);
    // A short guess stays; a long one doubles, rounded to 5 minutes.
    assert.equal(adjustToPace(15, pace), 15);
    assert.equal(adjustToPace(45, pace), 90);
  });

  it("keeps a length when the user is on pace, or nothing is known yet", () => {
    assert.equal(adjustToPace(30, null), 30);
    assert.equal(adjustToPace(30, computePace(finished(5, 30, 33))), 30);
  });
});

describe("insights", () => {
  it("last 7 days: focus per day, tasks done, sessions", () => {
    const entries = [
      session({ taskId: "a", focusedMinutes: 25, startedAt: new Date(2026, 10, 4, 9, 0).toISOString() }),
      session({ taskId: "b", focusedMinutes: 50, startedAt: new Date(2026, 10, 2, 14, 0).toISOString() }),
      // Eight days ago: outside the week.
      session({ taskId: "c", focusedMinutes: 90, startedAt: new Date(2026, 9, 27, 9, 0).toISOString() }),
    ];
    const insights = buildInsights(entries, [], [], "week", NOW);
    assert.equal(insights.bars.length, 7);
    assert.equal(insights.bars[6].start, "2026-11-04");
    assert.equal(insights.bars[6].focusMinutes, 25);
    assert.equal(insights.bars[4].focusMinutes, 50);
    assert.equal(insights.focusMinutes, 75);
    assert.equal(insights.sessions, 2);
    // All time includes the older one.
    assert.equal(buildInsights(entries, [], [], "all", NOW).focusMinutes, 165);
  });

  it("tasks done come from the log and the list, each once", () => {
    const completions: CompletionEntry[] = [
      { taskId: "a", userId: "u1", at: new Date(2026, 10, 4, 10).toISOString() },
      // Deleted from the list after a week, still counted all time.
      { taskId: "old", userId: "u1", at: new Date(2026, 9, 1, 10).toISOString() },
    ];
    const tasks = [
      makeTask({ id: "a", status: "completed", completedAt: new Date(2026, 10, 4, 10).toISOString() }),
      makeTask({ id: "b", status: "completed", completedAt: new Date(2026, 10, 3, 10).toISOString() }),
      makeTask({ id: "c", status: "pending" }),
    ];
    assert.deepEqual(completionDays(completions, tasks).sort(), ["2026-10-01", "2026-11-03", "2026-11-04"]);
    assert.equal(buildInsights([], completions, tasks, "week", NOW).tasksDone, 2);
    assert.equal(buildInsights([], completions, tasks, "all", NOW).tasksDone, 3);
  });

  it("a streak of days with something done, today not counted against it", () => {
    const day = (d: number) => ({ taskId: `t${d}`, userId: "u1", at: new Date(2026, 10, d, 12).toISOString() });
    // Nov 1, 2, 3 done; nothing yet today (Nov 4).
    assert.equal(buildInsights([], [day(1), day(2), day(3)], [], "week", NOW).streak, 3);
    assert.equal(buildInsights([], [day(1), day(3), day(4)], [], "week", NOW).streak, 2);
    assert.equal(buildInsights([], [day(1)], [], "week", NOW).streak, 0);
  });

  it("the best time of day, once there's enough to say", () => {
    const at = (hour: number) => new Date(2026, 10, 4, hour, 0).toISOString();
    const morning = [8, 9, 10].map((hour) => session({ taskId: `m${hour}`, focusedMinutes: 40, startedAt: at(hour) }));
    const evening = session({ taskId: "e", focusedMinutes: 30, startedAt: at(19) });
    assert.equal(buildInsights([...morning, evening], [], [], "week", NOW).bestTime, "morning");
    assert.equal(buildInsights([evening], [], [], "week", NOW).bestTime, null);
  });
});
