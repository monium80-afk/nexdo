import { useRef, useState } from "react";

import { generateAdvice, type TaskAdvice } from "@/lib/ai/generateAdvice";
import { suggestBreakdown } from "@/lib/ai/suggestBreakdown";
import { showPlanLimit } from "@/lib/paywall";
import { PlanLimitError } from "@/lib/plan";
import { useTaskStore } from "@/store/useTaskStore";
import type { Task } from "@/types/task";

export type AiRequest<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error" };

const IDLE_ADVICE: AiRequest<TaskAdvice> = { status: "idle" };

type BreakdownStatus = "idle" | "loading" | "error";

/**
 * On-demand AI help for one task in a running session:
 * - advice: temporary UI state, shown under the task title;
 * - breakdown: the AI's steps replace the task's unfinished ones (finished
 *   steps stay checked off), and "Regenerate" asks for a different split.
 */
export function useTaskAiAssist(task: Task, availableMinutes?: number) {
  const replaceRemainingSteps = useTaskStore((state) => state.replaceRemainingSteps);

  // Both pieces of state remember which task they describe, and the hook hands
  // back nothing when that isn't the task on screen. The Next page's stack
  // reuses its mounted cards as you swipe, so a card is handed a different task
  // mid-life — and tagging the state is what keeps the previous task's advice
  // from appearing under the new task's title. Doing it this way rather than
  // clearing the state in a [task.id] effect also keeps the reset in the same
  // render as the swap, instead of one frame and one extra render later.
  const [adviceState, setAdviceState] = useState<{ taskId: string; request: AiRequest<TaskAdvice> }>({
    taskId: task.id,
    request: IDLE_ADVICE,
  });
  const [breakdownState, setBreakdownState] = useState<{ taskId: string; status: BreakdownStatus }>({
    taskId: task.id,
    status: "idle",
  });

  const advice = adviceState.taskId === task.id ? adviceState.request : IDLE_ADVICE;
  const breakdownStatus: BreakdownStatus = breakdownState.taskId === task.id ? breakdownState.status : "idle";

  // Bumped by every new request and every dismiss, so a slow response for a
  // request the user has already replaced or closed is simply dropped. This
  // covers the same-task case; the taskId tags above cover the other one.
  const adviceRequestId = useRef(0);
  const breakdownRequestId = useRef(0);

  const requestAdvice = async () => {
    const requestId = ++adviceRequestId.current;
    const taskId = task.id;
    setAdviceState({ taskId, request: { status: "loading" } });
    // generateAdvice falls back to heuristic advice offline; the one thing it
    // throws is the month's breakdowns-and-advice being used up.
    let result: TaskAdvice;
    try {
      result = await generateAdvice(task, availableMinutes);
    } catch (error) {
      if (requestId !== adviceRequestId.current) return;
      setAdviceState({ taskId, request: IDLE_ADVICE });
      if (error instanceof PlanLimitError) showPlanLimit(error.meter);
      return;
    }
    if (requestId !== adviceRequestId.current) return;
    setAdviceState({
      taskId,
      request: result.headline || result.detail ? { status: "ready", data: result } : { status: "error" },
    });
  };

  const dismissAdvice = () => {
    adviceRequestId.current += 1;
    setAdviceState({ taskId: task.id, request: IDLE_ADVICE });
  };

  const regenerateBreakdown = async () => {
    const requestId = ++breakdownRequestId.current;
    const taskId = task.id;
    setBreakdownState({ taskId, status: "loading" });
    try {
      // The task's current unfinished steps go along with the request, so the
      // AI proposes a different split rather than the same one again.
      const steps = await suggestBreakdown(task, { availableMinutes });
      if (requestId !== breakdownRequestId.current) return;
      if (steps.length === 0) {
        setBreakdownState({ taskId, status: "error" });
        return;
      }
      replaceRemainingSteps(taskId, steps);
      setBreakdownState({ taskId, status: "idle" });
    } catch (error) {
      if (requestId !== breakdownRequestId.current) return;
      // Out of this month's breakdowns: not a failure to retry.
      if (error instanceof PlanLimitError) {
        setBreakdownState({ taskId, status: "idle" });
        showPlanLimit(error.meter);
        return;
      }
      console.warn("[useTaskAiAssist] breakdown failed", error);
      setBreakdownState({ taskId, status: "error" });
    }
  };

  const cancelBreakdown = () => {
    breakdownRequestId.current += 1;
    setBreakdownState({ taskId: task.id, status: "idle" });
  };

  return { advice, requestAdvice, dismissAdvice, breakdownStatus, regenerateBreakdown, cancelBreakdown };
}
