import { translate } from "@/lib/i18n";
import { PLAN_LIMITS, type Meter } from "@/lib/plan";
import { useSubscriptionStore } from "@/store/useSubscriptionStore";

/**
 * One or two sentences for when the server says a month's allowance is used
 * up (PlanLimitError): which one ran out, and what happens next — Pro is
 * told when it starts again, Free what upgrading would change.
 */
export function planLimitMessage(meter: Meter): string {
  const t = translate();
  const isPro = useSubscriptionStore.getState().pro !== null;
  // Free doesn't include Live voice at all, so nothing was "used up".
  if (!isPro && PLAN_LIMITS.free[meter] === 0) return t.plan.liveProOnly;
  return `${t.plan.used[meter]} ${isPro ? t.plan.resets : t.plan.upgradeHint}`;
}
