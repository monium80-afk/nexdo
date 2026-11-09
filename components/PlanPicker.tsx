import { ActivityIndicator, Text, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { SecondaryButton } from "@/components/Button";
import { gradients } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { formatPrice, monthlyEquivalent, productPrice } from "@/lib/price";
import { isTestStore, type ProPlan, type ProPlans } from "@/lib/purchases";

export type PlanChoice = "annual" | "monthly";

export type PlansState = { status: "loading" } | { status: "error" } | { status: "ready"; plans: ProPlans };

/** The plan a choice stands for — the other one if the offering lacks it. */
export function chosenPlan(plans: ProPlans, choice: PlanChoice): ProPlan | null {
  return choice === "annual" ? (plans.annual ?? plans.monthly) : (plans.monthly ?? plans.annual);
}

/** One selectable plan: charcoal with an orange edge once picked, sunk into the page otherwise. */
function PlanCard({
  label,
  price,
  crossedOutPrice,
  detail,
  badge,
  selected,
  centered,
  onPress,
}: {
  label: string;
  price: string;
  /** What the same year costs paid monthly — struck through beside the yearly price. */
  crossedOutPrice?: string | null;
  detail: string;
  badge?: string | null;
  selected: boolean;
  centered: boolean;
  onPress: () => void;
}) {
  const rtl = useRtlText();
  const textStyle = centered ? undefined : rtl;
  return (
    <AnimatedPressable
      onPress={onPress}
      scaleTo={0.98}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={selected ? gradients.charcoalCard : undefined}
      className={`flex-1 gap-0.5 rounded-[20px] border-2 px-[15px] pb-[14px] pt-[16px] ${centered ? "items-center" : ""} ${
        selected ? "border-orange-500 bg-charcoal-900" : "border-cream-300 bg-cream-200/60"
      }`}
    >
      {badge ? (
        // Centred cards centre it across the top edge; it spans the card so it can.
        <View className={centered ? "absolute -top-[12px] left-0 right-0 items-center" : "absolute -top-[12px] left-[14px]"}>
          <View className="rounded-full bg-orange-500 px-[10px] py-[3px]" style={gradients.accent}>
            <Text className="font-grotesk-bold text-[11px] text-on-accent">{badge}</Text>
          </View>
        </View>
      ) : null}
      <Text
        className={`font-grotesk-bold text-[14px] ${selected ? "text-ink-charcoal-muted" : "text-ink-cream-muted"}`}
        style={textStyle}
      >
        {label}
      </Text>
      {/* Wraps on a narrow phone, so a long price never squeezes the one beside
          it. In Arabic the row starts from the right, like the lines around it. */}
      <View
        className={`flex-wrap items-baseline gap-x-1.5 ${centered ? "justify-center" : ""} ${rtl ? "flex-row-reverse" : "flex-row"}`}
      >
        {/* One line, shrunk to fit: a long price ("USD 58.99") on a narrow
            card with large text broke in the middle of the number. */}
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          className={`shrink font-grotesk-bold text-[22px] ${selected ? "text-ink-charcoal" : "text-ink-cream"}`}
        >
          {price}
        </Text>
        {crossedOutPrice ? (
          <Text
            className={`font-grotesk-medium text-[12px] line-through ${selected ? "text-ink-charcoal-muted" : "text-ink-cream-subtle"}`}
          >
            {crossedOutPrice}
          </Text>
        ) : null}
      </View>
      <Text
        className={`font-grotesk-medium text-[12.5px] ${centered ? "text-center" : ""} ${selected ? "text-ink-charcoal-muted" : "text-ink-cream-muted"}`}
        style={textStyle}
      >
        {detail}
      </Text>
    </AnimatedPressable>
  );
}

/**
 * The yearly and monthly plans side by side, with the store's own prices —
 * or, until they're in, a placeholder the same height that offers a retry if
 * loading failed. Shared by the paywall and onboarding's plans step.
 */
export function PlanPicker({
  state,
  choice,
  onChoose,
  onRetry,
  badge,
  centered = false,
}: {
  state: PlansState;
  choice: PlanChoice;
  onChoose: (choice: PlanChoice) => void;
  onRetry: () => void;
  /** The yearly card's badge, given what it saves against paying monthly. */
  badge: (savedPercent: number) => string;
  /**
   * Centred cards, as onboarding draws them, without the struck-through
   * yearly price — the badge already says what it saves.
   */
  centered?: boolean;
}) {
  const colors = useColors();
  const t = useTranslation();
  const rtl = useRtlText();

  if (state.status !== "ready") {
    return (
      // Same height as the cards, so the page doesn't jump when they arrive.
      <View className="min-h-[96px] items-center justify-center gap-3 rounded-[20px] border-2 border-cream-300 bg-cream-200/60 px-4 py-3">
        {state.status === "loading" ? (
          <>
            <ActivityIndicator color={colors.orange[500]} />
            <Text className="font-grotesk-medium text-[13px] text-ink-cream-muted">{t.paywall.loading}</Text>
          </>
        ) : (
          <>
            <Text className="text-center font-grotesk-medium text-[13px] text-ink-cream-muted" style={rtl}>
              {t.paywall.loadError}
            </Text>
            <SecondaryButton icon="refresh-cw" label={t.paywall.retry} onPress={onRetry} />
          </>
        )}
      </View>
    );
  }

  const { plans } = state;
  const selected = chosenPlan(plans, choice);
  const monthlyProduct = plans.monthly?.package.product ?? null;
  const annualProduct = plans.annual?.package.product ?? null;

  // A year paid monthly, to set the yearly price against. Every price is
  // written from the store's amount and currency (lib/price.ts), so the
  // currency always shows — the store's own strings leave it to "$".
  const yearAtMonthlyRate = monthlyProduct
    ? formatPrice(monthlyProduct.price * 12, monthlyProduct.currencyCode, t.locale)
    : null;
  const savedPercent =
    monthlyProduct && annualProduct && monthlyProduct.price > 0
      ? Math.round((1 - annualProduct.price / (monthlyProduct.price * 12)) * 100)
      : 0;

  return (
    <View className="gap-2">
      <View className="flex-row gap-[10px]" accessibilityRole="radiogroup">
        {annualProduct ? (
          <PlanCard
            label={t.paywall.yearly}
            price={productPrice(annualProduct, t.locale)}
            crossedOutPrice={!centered && savedPercent > 0 ? yearAtMonthlyRate : null}
            detail={t.paywall.aMonth(monthlyEquivalent(annualProduct, t.locale))}
            badge={savedPercent > 0 ? badge(savedPercent) : null}
            selected={selected === plans.annual}
            centered={centered}
            onPress={() => onChoose("annual")}
          />
        ) : null}
        {monthlyProduct ? (
          <PlanCard
            label={t.paywall.monthly}
            price={productPrice(monthlyProduct, t.locale)}
            detail={t.paywall.perMonth}
            selected={selected === plans.monthly}
            centered={centered}
            onPress={() => onChoose("monthly")}
          />
        ) : null}
      </View>
      {/* Development only, never in a store build, so not translated: Expo Go
          and the dev build sell RevenueCat's Test Store products, which are
          not the store's real prices or currency (2026-10-09: read as a bug). */}
      {isTestStore ? (
        <Text className="text-center font-grotesk-medium text-[11.5px] leading-4 text-ink-cream-subtle">
          Development build: RevenueCat Test Store prices, always in USD. The Play Store / App Store build shows the
          store&apos;s real prices in your account&apos;s currency.
        </Text>
      ) : null}
    </View>
  );
}
