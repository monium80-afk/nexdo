import { Text } from "react-native";

import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import type { Meter } from "@/lib/plan";
import { useAllowance } from "@/store/usePlanUsageStore";

/**
 * One quiet line under an AI feature on Pro: "22 breakdowns and tips left
 * this month" once a quarter or less of the month's allowance is left (or
 * always, with `always`), and what ran out once nothing is. Free has no AI
 * allowance to count — its AI features are shown locked instead
 * (hooks/useAiLocked.ts) — so nothing shows there.
 */
export function AllowanceNote({
  meter,
  onDark = false,
  always = false,
}: {
  meter: Meter;
  onDark?: boolean;
  /** Show what's left even when plenty is (Magic mic, where time runs out unseen). */
  always?: boolean;
}) {
  const t = useTranslation();
  const rtl = useRtlText();
  const allowance = useAllowance(meter);
  if (!allowance || allowance.plan === "free") return null;
  if (!allowance.low && !always) return null;

  return (
    <Text className={`font-grotesk-medium text-[13px] ${onDark ? "text-ink-charcoal-muted" : "text-ink-cream-muted"}`} style={rtl}>
      {allowance.exhausted ? t.plan.used[meter] : t.plan.left[meter](allowance.left)}
    </Text>
  );
}
