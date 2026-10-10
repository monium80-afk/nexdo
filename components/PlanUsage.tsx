import { Text, View } from "react-native";

import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import { displayLimit, isTimeMeter, PLAN_LIMITS, SHOWN_METERS, type Meter, type Plan } from "@/lib/plan";

const MINUTE = 60;

/**
 * Which plan the account is on, and what it has used of it this month, one
 * line per allowance — Settings → Your plan. `used` is the server's own count
 * (app/api/usage+api.ts): notes and breakdowns as they are, Magic mic in seconds.
 */
export function PlanUsage({ plan, used }: { plan: Plan; used: Record<Meter, number> }) {
  const t = useTranslation();
  const rtl = useRtlText();

  return (
    <View className="gap-3.5">
      {/* The plan's name leads, so the card says first what the user is on. */}
      <View className="flex-row items-center justify-between gap-3">
        <Text className="font-grotesk-bold text-base text-ink-cream">{t.plan.names[plan]}</Text>
        <Text className="font-grotesk-semibold text-sm text-ink-cream-muted">{t.plan.thisMonth}</Text>
      </View>

      {SHOWN_METERS.map((meter) => {
        const limit = PLAN_LIMITS[plan][meter];
        const amount = used[meter] ?? 0;
        const shownLimit = displayLimit(plan, meter);
        // Whole minutes actually used up; the last one only shows once the
        // allowance itself is gone.
        const shownUsed = amount >= limit ? shownLimit : isTimeMeter(meter) ? Math.floor(amount / MINUTE) : amount;
        const value =
          limit === 0
            ? t.plan.proOnly
            : t.plan.usedOf(shownUsed, isTimeMeter(meter) ? t.plan.minutes(shownLimit) : String(shownLimit));
        const fraction = limit === 0 ? 0 : Math.min(1, amount / limit);

        return (
          <View key={meter} className="gap-1.5">
            <View className="flex-row items-center justify-between gap-3">
              <Text className="flex-1 font-grotesk-medium text-sm text-ink-cream" style={rtl}>
                {t.plan.meters[meter]}
              </Text>
              <Text className={`font-grotesk-bold text-sm ${limit === 0 ? "text-ink-cream-subtle" : "text-ink-cream"}`}>{value}</Text>
            </View>
            <View className="h-[5px] overflow-hidden rounded-full bg-cream-200">
              <View className="h-full rounded-full bg-orange-500" style={{ width: `${fraction * 100}%` }} />
            </View>
          </View>
        );
      })}

      <Text className="font-grotesk-medium text-sm text-ink-cream-muted" style={rtl}>
        {t.plan.resets}
      </Text>
    </View>
  );
}
