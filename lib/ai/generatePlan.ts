import { ALL_TRANSLATIONS, translate } from "@/lib/i18n";
import type { Subtask, TaskComplexity } from "@/types/task";

const SPLIT_RATIOS = [0.2, 0.6, 0.2];

function createSubtaskId(): string {
  return `subtask-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// complexity gates whether a plan is generated at all — simple tasks get no
// subtasks, so the app doesn't produce a ridiculous plan for "take medication".
export function generatePlan(input: {
  title: string;
  estimatedMinutes: number;
  complexity: TaskComplexity;
}): Subtask[] | undefined {
  if (input.complexity === "simple") return undefined;

  // The step names come from the app language.
  const labels = translate().planTemplate;
  const durations = SPLIT_RATIOS.map((ratio) => Math.round(input.estimatedMinutes * ratio));
  durations[durations.length - 1] += input.estimatedMinutes - durations.reduce((sum, duration) => sum + duration, 0);

  return labels.map((label, index) => ({
    id: createSubtaskId(),
    label,
    estimatedMinutes: durations[index],
    order: index,
    status: index === 0 ? "current" : "pending",
  }));
}

/**
 * Whether these steps are still exactly the generic plan above, with nothing
 * ticked off. Checked against every app language, since the labels were
 * written in whichever one was set when the plan was made. New tasks used to
 * get this plan by default; the task store uses this to recognise and drop it.
 */
export function isUntouchedTemplatePlan(subtasks: Subtask[]): boolean {
  if (subtasks.some((subtask) => subtask.status === "completed")) return false;
  const labels = subtasks
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((subtask) => subtask.label);
  return ALL_TRANSLATIONS.some(
    ({ planTemplate }) =>
      planTemplate.length === labels.length && planTemplate.every((label, index) => label === labels[index]),
  );
}
