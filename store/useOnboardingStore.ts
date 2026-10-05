import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { ExtractedTaskDraft } from "@/lib/ai/types";

/**
 * What the onboarding run is carrying between its steps: the brain dump the
 * user spoke or typed, and the tasks the AI pulled out of it. The drafts are
 * previews only; they become real tasks if the user signs up for a new
 * account, and are dropped if they log into an existing one.
 *
 * The drafts are persisted, the dump isn't. A signed-out install only gets
 * the AI once (lib/aiTrial.ts), so the tasks from that one run are what
 * onboarding offers to keep when it asks for an account — including after the
 * app has been closed and reopened.
 */
type OnboardingStore = {
  dump: string;
  drafts: ExtractedTaskDraft[];
  /**
   * Whether this run reached the plans step (app/onboarding-paywall.tsx), so
   * the paywall isn't offered a second time the moment the account exists.
   * Persisted with the drafts and cleared with them.
   */
  sawPaywall: boolean;
  setDump: (dump: string) => void;
  setDrafts: (drafts: ExtractedTaskDraft[]) => void;
  setSawPaywall: (sawPaywall: boolean) => void;
  /**
   * Hands the drafts over and empties the store in the same breath — the
   * moment someone signs in the run is over, whether the drafts become real
   * tasks or not. Atomic on purpose: this is
   * called from hooks/useAuthSync.ts, whose effect can run more than once for
   * the same sign-in, and a read-then-clear would save every draft twice.
   */
  claimDrafts: () => ExtractedTaskDraft[];
  reset: () => void;
};

let resolveHydration: () => void = () => {};
const hydrated = new Promise<void>((resolve) => {
  resolveHydration = resolve;
});

export function waitForOnboardingHydration(): Promise<void> {
  return hydrated;
}

export const useOnboardingStore = create<OnboardingStore>()(
  persist(
    (set, get) => ({
      dump: "",
      drafts: [],
      sawPaywall: false,
      setDump: (dump) => set({ dump }),
      setDrafts: (drafts) => set({ drafts }),
      setSawPaywall: (sawPaywall) => set({ sawPaywall }),
      claimDrafts: () => {
        const { drafts } = get();
        if (drafts.length > 0) set({ dump: "", drafts: [], sawPaywall: false });
        return drafts;
      },
      reset: () => set({ dump: "", drafts: [], sawPaywall: false }),
    }),
    {
      name: "nexdo-onboarding",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ drafts: state.drafts, sawPaywall: state.sawPaywall }),
      onRehydrateStorage: () => () => resolveHydration(),
    },
  ),
);
