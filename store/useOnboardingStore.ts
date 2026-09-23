import { create } from "zustand";

import type { ExtractedTaskDraft } from "@/lib/ai/types";

/**
 * What the onboarding run is carrying between its steps: the brain dump the
 * user spoke or typed, and the tasks the AI pulled out of it. Deliberately not
 * persisted — this is one sitting, and nothing here outlives it. The drafts are
 * previews only; they become real tasks when the user has an account to hang
 * them on.
 */
type OnboardingStore = {
  dump: string;
  drafts: ExtractedTaskDraft[];
  setDump: (dump: string) => void;
  setDrafts: (drafts: ExtractedTaskDraft[]) => void;
  /**
   * Hands the drafts over and empties the store in the same breath — the
   * moment they become real tasks the run is over. Atomic on purpose: this is
   * called from hooks/useAuthSync.ts, whose effect can run more than once for
   * the same sign-in, and a read-then-clear would save every draft twice.
   */
  claimDrafts: () => ExtractedTaskDraft[];
  reset: () => void;
};

export const useOnboardingStore = create<OnboardingStore>((set, get) => ({
  dump: "",
  drafts: [],
  setDump: (dump) => set({ dump }),
  setDrafts: (drafts) => set({ drafts }),
  claimDrafts: () => {
    const { drafts } = get();
    if (drafts.length > 0) set({ dump: "", drafts: [] });
    return drafts;
  },
  reset: () => set({ dump: "", drafts: [] }),
}));
