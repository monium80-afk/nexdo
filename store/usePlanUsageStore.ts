import { create } from "zustand";

import type { UsageResponseBody } from "@/app/api/usage+api";
import { apiPost, onMeteredCall } from "@/lib/api";
import { isTimeMeter, PLAN_LIMITS, type Meter, type Plan } from "@/lib/plan";
import { isPurchasesEnabled } from "@/lib/purchases";

/** A burst of AI calls (a few photos read at once) is one refresh. */
const REFRESH_DELAY_MS = 1_500;

type PlanUsageStore = {
  /** The plan the server counts this account on, and what it has used this month — null until read. */
  plan: Plan | null;
  used: Record<Meter, number> | null;
  /** Reads it again from the server (app/api/usage+api.ts). Never throws. */
  refresh: () => Promise<void>;
  /** Signing out: the next account starts unknown. */
  clear: () => void;
};

/**
 * This month's use of the plan, kept on hand so the AI buttons can say "2
 * left" before the allowance runs out (components/AllowanceNote.tsx) and
 * Settings can show the whole picture. Read at sign-in, on coming back to the
 * app, and shortly after any AI call. The server's count is the one that
 * counts; this is only what the app shows.
 */
export const usePlanUsageStore = create<PlanUsageStore>()((set) => ({
  plan: null,
  used: null,
  refresh: async () => {
    if (!isPurchasesEnabled) return;
    try {
      const { plan, used } = await apiPost<UsageResponseBody>("/api/usage", {});
      set({ plan, used });
    } catch (error) {
      // Left as it was: an old count beats none, and the next call tries again.
      console.warn("[usePlanUsageStore] couldn't read plan usage", error);
    }
  },
  clear: () => set({ plan: null, used: null }),
}));

let refreshTimer: ReturnType<typeof setTimeout> | undefined;
onMeteredCall(() => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void usePlanUsageStore.getState().refresh(), REFRESH_DELAY_MS);
});

/**
 * The count shows once a quarter or less of the month's allowance is left —
 * early enough to see it coming, rather than first hearing of a limit when it
 * stops something (the user's point, 2026-10-26). Free has no allowance to
 * count: its AI features are shown locked instead (hooks/useAiLocked.ts).
 */
const SHOW_COUNT_SHARE = 0.25;

export type Allowance = {
  plan: Plan;
  /** What's left this month: a count, or whole minutes for Magic mic and voice notes. */
  left: number;
  /** Few enough left to say so. */
  low: boolean;
  /** Nothing left this month (or not part of the plan at all). */
  exhausted: boolean;
};

/** Where one allowance stands, or null while it isn't known (or the build has no Pro). */
export function useAllowance(meter: Meter): Allowance | null {
  const plan = usePlanUsageStore((state) => state.plan);
  const used = usePlanUsageStore((state) => state.used?.[meter]);
  if (!plan || used === undefined) return null;
  const limit = PLAN_LIMITS[plan][meter];
  const remaining = Math.max(0, limit - used);
  const left = isTimeMeter(meter) ? Math.floor(remaining / 60) : remaining;
  const shownLimit = isTimeMeter(meter) ? Math.floor(limit / 60) : limit;
  return { plan, left, low: limit > 0 && left <= Math.ceil(shownLimit * SHOW_COUNT_SHARE), exhausted: remaining <= 0 };
}
