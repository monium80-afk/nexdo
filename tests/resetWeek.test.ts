import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { proposeReset, resetDeadline, slippedTasks } from "@/lib/resetWeek";
import { buildTask } from "@/store/useTaskStore";
import type { Task } from "@/types/task";

// Wednesday 2026-10-14, 10:00 on this machine's clock.
const NOW = new Date(2026, 9, 14, 10, 0, 0);

function task(id: string, input: { date?: string; time?: string; minutes?: number; level?: "high" | "medium" | "low" } = {}): Task {
  const built = buildTask(
    {
      title: id,
      estimatedMinutes: input.minutes ?? 30,
      deadline: input.date ? { date: input.date, time: input.time } : undefined,
      priorityLevel: input.level ?? "medium",
    },
    NOW,
  );
  return { ...built, id };
}

describe("reset my week", () => {
  it("finds open one-off tasks whose day has gone by — not today's, not done, not repeating", () => {
    const late = task("late", { date: "2026-10-12" });
    const today = task("today", { date: "2026-10-14", time: "08:00" });
    const done = { ...task("done", { date: "2026-10-10" }), status: "completed" as const };
    const noDate = task("no-date");
    const repeating = { ...task("repeating", { date: "2026-10-11" }), recurrence: { rule: { frequency: "daily" } } as Task["recurrence"] };
    assert.deepEqual(
      slippedTasks([late, today, done, noDate, repeating], NOW).map((entry) => entry.id),
      ["late"],
    );
  });

  it("puts the most pressing first and spreads the rest over the emptiest days", () => {
    const tasks = [
      task("big-a", { date: "2026-10-10", minutes: 180, level: "high" }),
      task("big-b", { date: "2026-10-11", minutes: 180 }),
      task("big-c", { date: "2026-10-12", minutes: 180, level: "low" }),
    ];
    const proposal = proposeReset(tasks, NOW);
    assert.equal(proposal.get("big-a"), "2026-10-14");
    // Three hours already on today: the next one goes to a later, emptier day.
    assert.notEqual(proposal.get("big-b"), "2026-10-14");
    assert.notEqual(proposal.get("big-c"), proposal.get("big-b"));
  });

  it("counts what's already due on a day", () => {
    const busyToday = task("busy", { date: "2026-10-14", minutes: 300 });
    const late = task("late", { date: "2026-10-12", minutes: 30 });
    assert.equal(proposeReset([busyToday, late], NOW).get("late"), "2026-10-15");
  });

  it("keeps a deadline's time unless that time has already gone by today", () => {
    const late = task("late", { date: "2026-10-12", time: "09:00" });
    assert.deepEqual(resetDeadline(late, "2026-10-14", NOW), { date: "2026-10-14" });
    assert.deepEqual(resetDeadline(late, "2026-10-15", NOW), { date: "2026-10-15", time: "09:00" });
    const evening = task("evening", { date: "2026-10-12", time: "18:00" });
    assert.deepEqual(resetDeadline(evening, "2026-10-14", NOW), { date: "2026-10-14", time: "18:00" });
  });
});
