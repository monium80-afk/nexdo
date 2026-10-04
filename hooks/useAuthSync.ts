import { useAuth, useClerk, useUser } from "@clerk/expo";
import { useEffect } from "react";
import { AppState } from "react-native";

import { setApiTokenGetter } from "@/lib/api";
import { flushLiveUsageReports } from "@/lib/liveUsageReports";
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
 * Back in the app after at least this long, the account's tasks and chat are
 * read again: realtime only delivers changes while the app is open, so
 * anything another device did meanwhile would otherwise wait for a restart.
 */
const RESYNC_AFTER_MS = 30_000;

/** A load that failed (offline at launch) is tried again after these waits, then on coming back to the app. */
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000];

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

    // When the account's tasks and chat were last read in full, and the
    // retry waiting for a load that failed.
    let syncedAt = 0;
    let retries = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let syncing: Promise<void> | null = null;

    // Series set to skip missed occurrences move on to the current one (a
    // no-op if already done), and tasks finished a week ago or longer are
    // deleted. Scores move with the clock too (a task that turned overdue
    // overnight), which both of these recalculate.
    const tidyTasks = () => {
      if (useTaskStore.getState().syncUserId !== userId) return;
      useTaskStore.getState().applyMissedOccurrences();
      useTaskStore.getState().deleteExpiredCompleted();
    };

    // Reads the account's tasks and chat and merges them with the phone's.
    // One at a time; a failed read is tried again on a backoff.
    const sync = (): Promise<void> => {
      syncing ??= (async () => {
        clearTimeout(retryTimer);
        const [tasksRead, chatRead] = await Promise.all([hydrateTasks(userId), hydrateChat(userId)]);
        if (!isActive) return;
        if (tasksRead) tidyTasks();
        if (tasksRead && chatRead) {
          syncedAt = Date.now();
          retries = 0;
        } else if (retries < RETRY_DELAYS_MS.length) {
          retryTimer = setTimeout(() => void sync(), RETRY_DELAYS_MS[retries]);
          retries += 1;
        }
      })().finally(() => {
        syncing = null;
      });
      return syncing;
    };

    void sync().then(async () => {
      if (!isActive || useTaskStore.getState().syncUserId !== userId) return;
      // Realtime from here on, whether or not the first read worked: changes
      // made elsewhere arrive as they happen, and the retry fills in the rest.
      subscribeTasks(userId);
      subscribeChat(userId);
      await waitForOnboardingHydration();
      if (!isActive || useTaskStore.getState().syncUserId !== userId) return;
      const savedDrafts = claimOnboardingDrafts(isNewAccount(clerk.user?.createdAt, clerk.session?.createdAt));
      // The end of setup for a new account: the tasks from its brain dump are
      // on the list, and this is the one moment Pro is offered unasked.
      if (savedDrafts && isPurchasesEnabled) openPaywall();
    });
    // Magic mic sessions whose usage couldn't be reported when they ended
    // (lib/liveUsageReports.ts) — until it is, each counts in full.
    void flushLiveUsageReports(userId);

    // Back in the foreground: after a while (or after a load that never
    // worked), everything is read again — which also sends any unsaved
    // change. Otherwise unsaved changes get another try on their own. Either
    // way the list is tidied, and Magic mic usage reports are retried.
    const appState = AppState.addEventListener("change", (state) => {
      if (state !== "active" || useTaskStore.getState().syncUserId !== userId) return;
      if (Date.now() - syncedAt >= RESYNC_AFTER_MS) {
        retries = 0;
        void sync();
      } else {
        tidyTasks();
        void useTaskStore.getState().saveUnsyncedTasks();
      }
      void flushLiveUsageReports(userId);
    });

    return () => {
      isActive = false;
      clearTimeout(retryTimer);
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