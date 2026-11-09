import type { StuckRequestBody, StuckResponseBody } from "@/app/api/stuck+api";
import { taskToContext } from "@/lib/ai/context";
import { apiPost } from "@/lib/api";
import { getLanguage } from "@/lib/i18n";
import type { Task } from "@/types/task";

export type NextMove = { action: string; minutes: number };

/**
 * "I'm stuck" in a focus session: one small action to start right now (see
 * app/api/stuck+api.ts). Null when the AI couldn't be reached — the card
 * offers a retry. Throws AiConsentError / PlanLimitError like every AI call.
 */
export async function suggestNextMove(
  task: Task,
  options: { minutesInSession?: number; previousIdeas?: string[] } = {},
): Promise<NextMove | null> {
  const steps = task.subtasks?.slice().sort((a, b) => a.order - b.order) ?? [];
  const toStep = (step: (typeof steps)[number]) => ({ title: step.label, estimatedMinutes: step.estimatedMinutes });
  const body: StuckRequestBody = {
    task: taskToContext(task),
    completedSteps: steps.filter((step) => step.status === "completed").map(toStep),
    openSteps: steps.filter((step) => step.status !== "completed").map(toStep),
    minutesInSession: options.minutesInSession,
    previousIdeas: options.previousIdeas ?? [],
    language: getLanguage(),
  };
  const result = await apiPost<StuckResponseBody>("/api/stuck", body);
  return result.idea;
}
