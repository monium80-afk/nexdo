import type { ProPlan, ProPlans } from "@/lib/purchases";

// Which of the store's plans the paywall has picked (components/NexdoPaywall.tsx).

export type PlanChoice = "annual" | "monthly";

export type PlansState = { status: "loading" } | { status: "error" } | { status: "ready"; plans: ProPlans };

/** The plan a choice stands for — the other one if the offering lacks it. */
export function chosenPlan(plans: ProPlans, choice: PlanChoice): ProPlan | null {
  return choice === "annual" ? (plans.annual ?? plans.monthly) : (plans.monthly ?? plans.annual);
}
