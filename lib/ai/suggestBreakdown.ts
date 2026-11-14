import type { BreakdownRequestBody, BreakdownResponseBody } from "@/app/api/breakdown+api";
import { taskToContext } from "@/lib/ai/context";
import type { PlanStep } from "@/lib/ai/types";
import { apiPost } from "@/lib/api";
import { getLanguage } from "@/lib/i18n";
import type { Subtask, Task } from "@/types/task";

function toPlanStep(subtask: Subtask): PlanStep {
  return { title: subtask.label, estimatedMinutes: subtask.estimatedMinutes };
}

// Asks the AI to break down the work still left on a task — see
// app/api/breakdown+api.ts. Unlike generateAdvice there's no heuristic
// fallback: a canned "Gather what you need / Do the core work" plan is
// exactly what this replaces, so a failure throws and the caller offers a
// retry instead.
export async function suggestBreakdown(
  task: Task,
  options: { availableMinutes?: number; previousSuggestion?: PlanStep[] } = {},
): Promise<PlanStep[]> {
  const subtasks = task.subtasks?.slice().sort((a, b) => a.order - b.order) ?? [];

  const body: BreakdownRequestBody = {
    task: taskToContext(task),
    completedSteps: subtasks.filter((subtask) => subtask.status === "completed").map(toPlanStep),
    currentSteps: subtasks.filter((subtask) => subtask.status !== "completed").map(toPlanStep),
    previousSuggestion: options.previousSuggestion ?? [],
    availableMinutes: options.availableMinutes,
    language: getLanguage(),
  };

  const result = await apiPost<BreakdownResponseBody>("/api/breakdown", body);
  return result.steps;
}
