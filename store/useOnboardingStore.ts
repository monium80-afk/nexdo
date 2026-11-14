import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { ExtractedTaskDraft } from "@/lib/ai/types";

/** "What brings you here?" — ids, in the order the screen lists them (app/onboarding/pains.tsx; 11's promise uses them). */
export const ONBOARDING_PAINS = ["overwhelmed", "procrastinate", "forget", "juggling", "focus", "finish"] as const;
export type OnboardingPain = (typeof ONBOARDING_PAINS)[number];

/** "How much is on your mind right now?" — the slider's four stops (app/onboarding/load.tsx). */
export const ONBOARDING_LOADS = ["few", "some", "many", "lots"] as const;
export type OnboardingLoad = (typeof ONBOARDING_LOADS)[number];

/**
 * What the onboarding run carries between its screens (app/onboarding/): the
 * answers on 04 and 05, and the tasks the brain dump (07) found. The drafts
 * are previews only; they become real tasks if the user signs up for a new
 * account (hooks/useAuthSync.ts), and are dropped if they log into an
 * existing one. Persisted, so a reopened app still has them — a signed-out
 * install only gets the AI once (lib/aiTrial.ts).
 */
type OnboardingStore = {
  pains: OnboardingPain[];
  load: OnboardingLoad | null;
  setPains: (pains: OnboardingPain[]) => void;
  setLoad: (load: OnboardingLoad) => void;
  drafts: ExtractedTaskDraft[];
  /**
   * Whether this run reached the paywall (app/onboarding/paywall.tsx), so it
   * isn't offered a second time the moment the account exists. Persisted
   * with the drafts and cleared with them.
   */
  sawPaywall: boolean;
  setDrafts: (drafts: ExtractedTaskDraft[]) => void;
  setSawPaywall: (sawPaywall: boolean) => void;
  /**
   * Hands the drafts over and empties the store in the same breath — the
   * moment someone signs in the run is over, whether the drafts become real
   * tasks or not. Atomic on purpose: this is called from
   * hooks/useAuthSync.ts, whose effect can run more than once for the same
   * sign-in, and a read-then-clear would save every draft twice.
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
      pains: [],
      load: null,
      setPains: (pains) => set({ pains }),
      setLoad: (load) => set({ load }),
      drafts: [],
      sawPaywall: false,
      setDrafts: (drafts) => set({ drafts }),
      setSawPaywall: (sawPaywall) => set({ sawPaywall }),
      claimDrafts: () => {
        const { drafts } = get();
        if (drafts.length > 0) set({ drafts: [], sawPaywall: false });
        return drafts;
      },
      reset: () => set({ drafts: [], sawPaywall: false, pains: [], load: null }),
    }),
    {
      name: "nexdo-onboarding",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        drafts: state.drafts,
        sawPaywall: state.sawPaywall,
        pains: state.pains,
        load: state.load,
      }),
      onRehydrateStorage: () => () => resolveHydration(),
    },
  ),
);
