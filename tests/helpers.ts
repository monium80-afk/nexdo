/// <reference types="node" />
import type { Task } from "@/types/task";

/** A pending task with sensible defaults; override whatever the test is about. */
export function makeTask(overrides: Partial<Task> & { id: string }): Task {
  const createdAt = overrides.createdAt ?? "2026-10-01T08:00:00.000Z";
  return {
    title: overrides.id,
    status: "pending",
    estimatedMinutes: 30,
    createdAt,
    updatedAt: createdAt,
    priorityScore: 0,
    suitabilityScore: 0,
    importance: 50,
    complexity: "simple",
    aiContext: { notes: [] },
    ...overrides,
  };
}

/** A local date-time, the way the device would see it. */
export function local(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}
