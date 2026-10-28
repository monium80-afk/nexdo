import type { PurchasesStoreProduct } from "react-native-purchases";

import type { TrialUnit } from "@/lib/plan";

/** A free trial the store would start this account on: `count` days, weeks… */
export type FreeTrial = { count: number; unit: TrialUnit };

const TRIAL_UNITS: Record<string, TrialUnit> = { DAY: "day", WEEK: "week", MONTH: "month", YEAR: "year" };

function asTrial(count: number, unit: string): FreeTrial | null {
  const trialUnit = TRIAL_UNITS[unit.toUpperCase()];
  return trialUnit && count > 0 ? { count, unit: trialUnit } : null;
}

/**
 * The free trial a product starts with, as the store describes it. On Google
 * Play a purchase buys the product's default option, which RevenueCat picks
 * from the offers Google lists for this account — and Google only lists the
 * offers the account can still have — so its free phase is already this
 * account's own. Elsewhere it's the product's introductory offer, which the
 * App Store shows to everyone, so lib/purchases.ts asks about eligibility
 * there.
 */
export function storeTrial(product: Pick<PurchasesStoreProduct, "defaultOption" | "introPrice">): FreeTrial | null {
  if (product.defaultOption) {
    const free = product.defaultOption.freePhase;
    return free ? asTrial(free.billingPeriod.value * (free.billingCycleCount ?? 1), free.billingPeriod.unit) : null;
  }
  const intro = product.introPrice;
  return intro && intro.price === 0 ? asTrial(intro.periodNumberOfUnits * Math.max(1, intro.cycles), intro.periodUnit) : null;
}
