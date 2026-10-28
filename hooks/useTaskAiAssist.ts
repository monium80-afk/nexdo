import { useRef, useState } from "react";

import { suggestBreakdown } from "@/lib/ai/suggestBreakdown";
import { AiConsentError } from "@/lib/aiConsent";
import type { PlanStep } from "@/lib/ai/types";
import { showPlanLimit } from "@/lib/paywall";
import { PlanLimitError } from "@/lib/plan";
import { useTaskStore } from "@/store/useTaskStore";
import type { StepDraft, Subtask, Task } from "@/types/task";

type BreakdownStatus = "idle" | "loading" | "error";

/**
 * AI Breakdown for one task in a running session: the AI's steps for the work
 * left, handed back to the sheet as a draft — nothing is saved until the user
 * confirms them there. "Regenerate" asks for a different split. (The separate
 * "Get advice" went on 2026-10-28: without knowing the task, it could only say
 * the obvious — "Break it down" now asks to see the task first.)
 */
export function useTaskAiAssist(task: Task, availableMinutes?: number) {
  // The state remembers which task it describes, and the hook hands back
  // nothing when that isn't the task on screen: the Next page's stack reuses
  // its mounted cards as you swipe, so a card is handed a different task
  // mid-life.
  const [breakdownState, setBreakdownState] = useState<{ taskId: string; status: BreakdownStatus }>({
    taskId: task.id,
    status: "idle",
  });

  const breakdownStatus: BreakdownStatus = breakdownState.taskId === task.id ? breakdownState.status : "idle";

  // Bumped by every new request and every cancel, so a slow response for a
  // request the user has already replaced or closed is simply dropped.
  const breakdownRequestId = useRef(0);

  /**
   * New steps for the work left, given the sheet's draft — or null when there
   * are none (failed, out of this month's breakdowns, or replaced by a newer
   * request). The draft's unfinished steps go along with the request, so the
   * AI proposes a different split rather than the same one again.
   */
  const regenerateBreakdown = async (draft: StepDraft[]): Promise<PlanStep[] | null> => {
    const requestId = ++breakdownRequestId.current;
    const taskId = task.id;
    setBreakdownState({ taskId, status: "loading" });
    // Read fresh: what the user just showed Nexdo (BreakdownContextSheet) was
    // saved to the task a moment ago, and the steps should be built from it.
    const current = useTaskStore.getState().tasks.find((entry) => entry.id === taskId) ?? task;
    const subtasks: Subtask[] = draft.map((step, order) => ({
      id: step.id,
      label: step.label,
      estimatedMinutes: step.estimatedMinutes,
      order,
      status: step.completed ? "completed" : "pending",
    }));
    try {
      const steps = await suggestBreakdown({ ...current, subtasks }, { availableMinutes });
      if (requestId !== breakdownRequestId.current) return null;
      if (steps.length === 0) {
        setBreakdownState({ taskId, status: "error" });
        return null;
      }
      setBreakdownState({ taskId, status: "idle" });
      return steps;
    } catch (error) {
      if (requestId !== breakdownRequestId.current) return null;
      // The user said no to AI: nothing failed.
      if (error instanceof AiConsentError) {
        setBreakdownState({ taskId, status: "idle" });
        return null;
      }
      // Out of this month's breakdowns: not a failure to retry.
      if (error instanceof PlanLimitError) {
        setBreakdownState({ taskId, status: "idle" });
        showPlanLimit(error.meter);
        return null;
      }
      console.warn("[useTaskAiAssist] breakdown failed", error);
      setBreakdownState({ taskId, status: "error" });
      return null;
    }
  };

  const cancelBreakdown = () => {
    breakdownRequestId.current += 1;
    setBreakdownState({ taskId: task.id, status: "idle" });
  };

  return { breakdownStatus, regenerateBreakdown, cancelBreakdown };
}
