import { useAuth, useUser } from "@clerk/expo";
import { useEffect } from "react";

import { setApiTokenGetter } from "@/lib/api";
import { posthog } from "@/lib/posthog";
import { setClerkTokenGetter } from "@/lib/supabase";
import { useChatStore } from "@/store/useChatStore";
import { useOnboardingStore } from "@/store/useOnboardingStore";
import { useTaskStore } from "@/store/useTaskStore";

/**
 * Turns the tasks the AI pulled out of the onboarding brain dump into real
 * ones, now that there is an account to hang them on. Until sign-up they only
 * ever existed as previews in useOnboardingStore (see app/onboarding-plan.tsx),
 * and without this step the whole dump was thrown away at the door.
 *
 * Deliberately after hydrateFromSupabase has settled: adding first would race
 * the merge, which decides what a signed-in user's task list actually is.
 * Returning users simply have nothing to claim.
 */
function claimOnboardingDrafts() {
  const drafts = useOnboardingStore.getState().claimDrafts();
  if (drafts.length === 0) return;

  const { addTask } = useTaskStore.getState();
  drafts.forEach((draft) =>
    addTask({
      title: draft.title,
      estimatedMinutes: draft.estimatedMinutes,
      dueDate: draft.dueDate,
      priorityLevel: draft.priorityLevel,
      // The AI groups linked items under one task, and that grouping is the
      // plan the user already approved on the Plan step — keep it.
      steps: draft.steps?.map((step, index) => ({
        id: `subtask-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 6)}`,
        label: step.title,
        estimatedMinutes: step.estimatedMinutes,
      })),
    }),
  );
  posthog.capture("onboarding_drafts_saved", { task_count: drafts.length });
}

export function useAuthSync() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const userId = user?.id;
  const hydrateTasks = useTaskStore((state) => state.hydrateFromSupabase);
  const subscribeTasks = useTaskStore((state) => state.subscribeToRealtime);
  const unsubscribeTasks = useTaskStore((state) => state.unsubscribeFromRealtime);
  const hydrateChat = useChatStore((state) => state.hydrateFromSupabase);
  const subscribeChat = useChatStore((state) => state.subscribeToRealtime);
  const unsubscribeChat = useChatStore((state) => state.unsubscribeFromRealtime);

  useEffect(() => {
    if (!userId) return;
    let isActive = true;
    setClerkTokenGetter(() => getToken());
    setApiTokenGetter(() => getToken());

    hydrateTasks(userId).then(() => {
      if (!isActive || useTaskStore.getState().syncUserId !== userId) return;
      subscribeTasks(userId);
      claimOnboardingDrafts();
    });
    hydrateChat(userId).then(() => {
      if (isActive && useChatStore.getState().syncUserId === userId) subscribeChat(userId);
    });

    return () => {
      isActive = false;
      unsubscribeTasks();
      unsubscribeChat();
    };
  }, [userId, getToken, hydrateTasks, subscribeTasks, unsubscribeTasks, hydrateChat, subscribeChat, unsubscribeChat]);
}