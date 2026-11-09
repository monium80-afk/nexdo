import { router } from "expo-router";

import { showAlert } from "@/lib/alert";
import { translate } from "@/lib/i18n";
import type { Meter } from "@/lib/plan";
import { planLimitMessage } from "@/lib/planLimit";
import { isPurchasesEnabled } from "@/lib/purchases";
import { useSubscriptionStore } from "@/store/useSubscriptionStore";

/** Pro features that aren't AI allowances (2026-11-02): no monthly count, just Pro. */
export type ProExtra = "sounds" | "insights";
export const PRO_EXTRAS: readonly ProExtra[] = ["sounds", "insights"];

/** What the paywall was opened from: an AI allowance, or one of the extras. */
export type PaywallReason = Meter | ProExtra;

/**
 * Opens the Nexdo Pro paywall (app/paywall.tsx). With a `reason`, it opens
 * on that feature — or the allowance that just ran out — instead of its
 * usual headline.
 */
export function openPaywall(reason?: PaywallReason) {
  router.push(reason ? { pathname: "/paywall", params: { reason } } : "/paywall");
}

/**
 * What the app does when a month's allowance is used up. On Free the paywall
 * opens, saying which one ran out. Pro has nothing to upgrade to, so it's
 * told when the allowance starts again — unless the caller has `alreadySaid`
 * so itself (Task Details' context-note notice does).
 */
export function showPlanLimit(meter: Meter, alreadySaid = false) {
  const isPro = useSubscriptionStore.getState().pro !== null;
  if (!isPro && isPurchasesEnabled) {
    openPaywall(meter);
    return;
  }
  if (!alreadySaid) showAlert(translate().plan.limitTitle, planLimitMessage(meter));
}
