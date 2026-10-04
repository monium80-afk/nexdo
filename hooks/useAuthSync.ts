import { useAuth, useClerk, useUser } from "@clerk/expo";
import { useEffect } from "react";
import { AppState } from "react-native";

import { setApiTokenGetter } from "@/lib/api";
import { openPaywall } from "@/lib/paywall";
import { posthog } from "@/lib/posthog";
import { identifyPurchaser, isPurchasesEnabled } from "@/lib/purchases";
import { setClerkTokenGetter } from "@/lib/supabase";
import { useChatStore } from "@/store/useChatStore";
import { useOnboardingStore, waitForOnboardingHydration } from "@/store/useOnboardingStore";
import { useTaskStore } from "@/store/useTaskStore";

/**
 * Slack, not a meaningful boundary: a sign-up creates the account and its
 * first session in the same Clerk request, milliseconds apart.
 */
const NEW_ACCOUNT_WINDOW_MS = 60_000;

/**
 * Whether the account was made by the sign-up that opened this session,
 * rather than on some earlier visit. Logging back in only adds a new session
 * to an account that already existed. Both timestamps are Clerk's, so the
 * phone's clock can't skew the answer — and it holds whichever way Google or
 * Apple routed the user: an SSO "sign up" with a known account quietly signs
 * in, and an SSO "log in" with an unknown one quietly signs up.
 */
function isNewAccount(accountCreatedAt: Date | null | undefined, sessionCreatedAt: Date | undefined) {
  if (!accountCreatedAt || !sessionCreatedAt) return false;
  return sessionCreatedAt.getTime() - accountCreatedAt.getTime() < NEW_ACCOUNT_WINDOW_MS;
}

/**
 * Turns the tasks the AI pulled out of the onboarding brain dump into real
 * ones, but only for an account created by this onboarding run. Until sign-up
 * they only ever existed as previews in useOnboardingStore (see
 * app/onboarding-plan.tsx), and without this step the whole dump was thrown
 * away at the door.
 *
 * Someone logging back into an existing account already has their list, so a
 * dump they made on the way in is dropped rather than mixed into it. It is
 * still claimed out of the store, so it can't linger into a later sign-up.
 *
 * Deliberately after hydrateFromSupabase has settled: adding first would race
 * the merge, which decides what a signed-in user's task list actually is.
 *
 * Returns whether any were saved — true once per new account, since the
 * drafts are claimed only once.
 */
function claimOnboardingDrafts(accountIsNew: boolean): boolean {
  const drafts = useOnboardingStore.getState().claimDrafts();
  if (drafts.length === 0 || !accountIsNew) return false;

  const { addTask } = useTaskStore.getState();
  drafts.forEach((draft) =>
    addTask({
      title: draft.title,
      estimatedMinutes: draft.estimatedMinutes,
      dueDate: draft.dueDate,
      // A draft only has a time if the user said one; otherwise its day alone.
      dueHasTime: draft.dueHasTime ?? false,
      priorityLevel: draft.priorityLevel,
      // The AI groups linked items under one task, and that grouping is the
      // plan the user already approved on the Plan step — keep it.
      steps: draft.steps?.map((step, index) => ({
        id: `subtask-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 6)}`,
        label: step.title,
        estimatedMinutes: step.estimatedMinutes,
      })),
      // "Gym every Monday" in the brain dump stays a repeating task.
      recurrence: draft.recurrence,
    }),
  );
  posthog.capture("onboarding_drafts_saved", { task_count: drafts.length });
  return true;
}

export function useAuthSync() {
  const { getToken } = useAuth();
  const clerk = useClerk();
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

    hydrateTasks(userId).then(async () => {
      if (!isActive || useTaskStore.getState().syncUserId !== userId) return;
      // Now that the list is the account's: series set to skip missed
      // occurrences move on to the current one (a no-op if already done), and
      // tasks finished a week ago or longer are deleted.
      useTaskStore.getState().applyMissedOccurrences();
      useTaskStore.getState().deleteExpiredCompleted();
      subscribeTasks(userId);
      await waitForOnboardingHydration();
      if (!isActive || useTaskStore.getState().syncUserId !== userId) return;
      const savedDrafts = claimOnboardingDrafts(isNewAccount(clerk.user?.createdAt, clerk.session?.createdAt));
      // The end of setup for a new account: the tasks from its brain dump are
      // on the list, and this is the one moment Pro is offered unasked.
      if (savedDrafts && isPurchasesEnabled) openPaywall();
    });
    hydrateChat(userId).then(() => {
      if (isActive && useChatStore.getState().syncUserId === userId) subscribeChat(userId);
    });

    // Back in the foreground after a while: scores move with the clock (a task
    // that turned overdue overnight), a "skip missed" series may have a new
    // occurrence due, and a finished task's week may be up. Unsaved changes
    // get another try too.
    const appState = AppState.addEventListener("change", (state) => {
      if (state !== "active" || useTaskStore.getState().syncUserId !== userId) return;
      useTaskStore.getState().applyMissedOccurrences();
      useTaskStore.getState().deleteExpiredCompleted();
      void useTaskStore.getState().saveUnsyncedTasks();
    });

    return () => {
      isActive = false;
      appState.remove();
      unsubscribeTasks();
      unsubscribeChat();
    };
  }, [userId, getToken, clerk, hydrateTasks, subscribeTasks, unsubscribeTasks, hydrateChat, subscribeChat, unsubscribeChat]);

  // Nexdo Pro belongs to the account, so RevenueCat knows the user by their
  // Clerk id. Sign-out resets it (resetPurchaser, from the sign-out buttons).
  useEffect(() => {
    if (userId) void identifyPurchaser(userId);
  }, [userId]);
}