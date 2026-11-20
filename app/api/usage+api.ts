import type { Meter, Plan } from "@/lib/plan";
import { authenticate, unauthorized } from "@/lib/serverAuth";
import { readPlanUsage, resolvePlan } from "@/lib/serverPlan";

// What the account has used of its plan this month, for Settings → Nexdo Pro.
// The limits themselves aren't sent: the app has the same table (lib/plan.ts).

export type UsageResponseBody = {
  /** The plan the server counts this account on — RevenueCat's word, not the app's. */
  plan: Plan;
  /** Used so far this month: a count, or seconds for voice notes and Live voice. */
  used: Record<Meter, number>;
};

export async function POST(request: Request) {
  const auth = await authenticate(request);
  if ("failed" in auth) return auth.failed;
  if (!auth.userId) return unauthorized();

  const [plan, used] = await Promise.all([resolvePlan(request, auth.userId), readPlanUsage(auth.userId)]);
  if (!used) return Response.json({ error: "usage_unavailable" }, { status: 503 });

  return Response.json({ plan, used } satisfies UsageResponseBody);
}
