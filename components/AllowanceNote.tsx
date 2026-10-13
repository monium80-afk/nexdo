import { Feather } from "@expo/vector-icons";
import { Text } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { MOTION } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { openPaywall } from "@/lib/paywall";
import type { Meter } from "@/lib/plan";
import { useAllowance } from "@/store/usePlanUsageStore";

/**
 * One quiet line under an AI feature, only once it matters: "2 breakdowns and
 * tips left this month" when few are left, and — on Free, once none are —
 * what ran out and "Get more with Pro", which opens the plans. Nothing at
 * all the rest of the time.
 */
export function AllowanceNote({
  meter,
  onDark = false,
  beforeOpen,
}: {
  meter: Meter;
  onDark?: boolean;
  /** Inside a sheet (a native modal): closes it first, or the plans open underneath. */
  beforeOpen?: () => void;
}) {
  const t = useTranslation();
  const rtl = useRtlText();
  const colors = useColors();
  const allowance = useAllowance(meter);
  if (!allowance) return null;

  const muted = onDark ? "text-ink-charcoal-muted" : "text-ink-cream-muted";

  if (allowance.exhausted && allowance.plan === "free") {
    return (
      <AnimatedPressable
        onPress={() => {
          if (!beforeOpen) {
            openPaywall(meter);
            return;
          }
          beforeOpen();
          setTimeout(() => openPaywall(meter), MOTION.duration.screen + 50);
        }}
        accessibilityRole="button"
        className="flex-row flex-wrap items-center gap-x-1.5 gap-y-0.5 py-1"
      >
        <Text className={`font-grotesk-medium text-[13px] ${muted}`} style={rtl}>
          {t.plan.used[meter]}
        </Text>
        <Text className={`font-grotesk-bold text-[13px] ${onDark ? "text-orange-400" : "text-orange-600"}`}>{t.plan.getMore}</Text>
        <Feather name="arrow-right" size={13} color={onDark ? colors.orange[400] : colors.orange[600]} />
      </AnimatedPressable>
    );
  }

  if (!allowance.low) return null;
  return (
    <Text className={`font-grotesk-medium text-[13px] ${muted}`} style={rtl}>
      {allowance.exhausted ? t.plan.used[meter] : t.plan.left[meter](allowance.left)}
    </Text>
  );
}
