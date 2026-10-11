import { rankTasksForNext } from "@/lib/scoring";
import type { Task } from "@/types/task";

export type EnergyLevel = "ready" | "low" | "procrastinating";

export const TIME_OPTIONS: number[] = [15, 25, 30, 45, 60, 90];

// Labels live in the translations (next.energy).
export const ENERGY_LEVELS: EnergyLevel[] = ["ready", "low", "procrastinating"];

const COMPLEXITY_WEIGHT = { simple: 0, medium: 1, complex: 2 };
const MAX_SESSION_TASKS = 6;

// Re-orders the priority-ranked pending list to match how much focus the
// user says they have right now — doesn't change *which* tasks are
// eligible, just which ones surface first when packing the time budget.
function orderForEnergy(tasks: Task[], energy: EnergyLevel): Task[] {
  if (energy === "ready") return tasks;
  if (energy === "low") {
    return tasks
      .map((task, index) => ({ task, index }))
      .sort((a, b) => COMPLEXITY_WEIGHT[a.task.complexity] - COMPLEXITY_WEIGHT[b.task.complexity] || a.index - b.index)
      .map((entry) => entry.task);
  }
  // procrastinating: shortest task first, to build momentum.
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => a.task.estimatedMinutes - b.task.estimatedMinutes || a.index - b.index)
    .map((entry) => entry.task);
}

// Greedy first-fit bin-packing: walks the energy-ordered candidates and
// takes whatever still fits the remaining budget. Not optimal, but simple
// and predictable enough to teach and to reason about from the UI.
export function buildSessionPlan(tasks: Task[], availableMinutes: number, energy: EnergyLevel): Task[] {
  const candidates = orderForEnergy(rankTasksForNext(tasks), energy);
  if (candidates.length === 0) return [];

  const picked: Task[] = [];
  let remaining = availableMinutes;

  for (const task of candidates) {
    if (picked.length >= MAX_SESSION_TASKS) break;
    if (task.estimatedMinutes <= remaining) {
      picked.push(task);
      remaining -= task.estimatedMinutes;
    }
  }

  // Never return an empty plan while work exists — surface the shortest
  // task even if it slightly overruns the stated budget.
  if (picked.length === 0) {
    picked.push([...candidates].sort((a, b) => a.estimatedMinutes - b.estimatedMinutes)[0]);
  }

  return picked;
}

export function sumEstimatedMinutes(tasks: Task[]): number {
  return tasks.reduce((sum, task) => sum + task.estimatedMinutes, 0);
}
