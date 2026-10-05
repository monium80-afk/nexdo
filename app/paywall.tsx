import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, Text, View, type TextStyle } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { PrimaryButton } from "@/components/Button";
import { chosenPlan, PlanPicker, type PlanChoice, type PlansState } from "@/components/PlanPicker";
import { SUPPORT_LINKS } from "@/constants/support";
import { gradients } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { showAlert } from "@/lib/alert";
import { displayLimit, isTimeMeter, METERS, PLAN_LIMITS, type Meter, type Plan } from "@/lib/plan";
import { posthog } from "@/lib/posthog";
import { billedYearly, loadProPlans, purchasePlan, restorePurchases } from "@/lib/purchases";
import { useSubscriptionStore } from "@/store/useSubscriptionStore";
import { useTaskStore } from "@/store/useTaskStore";

// The order the comparison lists what a plan counts in.
const COMPARED: readonly Meter[] = ["chat", "media", "voice", "live", "assist"];

// Same raised tray as Add Task's footer.
const FOOTER_SHADOW = { boxShadow: "0 -8px 24px -12px rgba(92, 58, 26, 0.3)" };

// Centred Arabic: read right to left, but kept in the middle (useRtlText
// would pull it to the right edge).
const CENTERED_RTL: TextStyle = { writingDirection: "rtl" };

/**
 * One line of the Free vs Pro comparison. The Pro cells are charcoal and
 * stack with no gap, so together they read as one dark column.
 */
function CompareRow({
  label,
  free,
  pro,
  position,
}: {
  label: string;
  free: string;
  pro: string;
  position: "header" | "middle" | "last";
}) {
  const rtl = useRtlText();
  const header = position === "header";
  return (
    <View className="flex-row">
      <View className={`min-h-[40px] flex-1 flex-row items-center py-2 ${header ? "" : "border-t border-cream-300"}`}>
        <Text
          numberOfLines={2}
          className={`flex-1 pr-2 ${header ? "font-grotesk-medium text-[13px] text-ink-cream-muted" : "font-grotesk-bold text-[14px] text-ink-cream"}`}
          style={rtl}
        >
          {label}
        </Text>
        <Text className="w-[56px] text-center font-grotesk-medium text-[13.5px] text-ink-cream-muted">{free}</Text>
      </View>
      <View
        className={`w-[84px] items-center justify-center bg-charcoal-900 ${header ? "rounded-t-[16px]" : "border-t border-white/10"} ${
          position === "last" ? "rounded-b-[16px]" : ""
        }`}
      >
        <Text className={`font-grotesk-bold text-ink-charcoal ${header ? "text-[13px]" : "text-[14.5px]"}`}>{pro}</Text>
      </View>
    </View>
  );
}

/**
 * The Nexdo Pro paywall: the two plans with the store's own prices, what Pro
 * changes each month, and the purchase. Opened from Settings, at the end of
 * setup for a new account, and whenever a Free allowance runs out — then
 * `reason` names the one that did, and the headline says so.
 *
 * Checks the account before anything else mounts: Pro belongs to an account,
 * and a direct link skips the tabs' own sign-in check.
 */
export default function PaywallScreen() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/onboarding" />;
  return <Paywall />;
}

function Paywall() {
  const colors = useColors();
  const t = useTranslation();
  const rtl = useRtlText();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { reason: reasonParam } = useLocalSearchParams<{ reason?: string }>();
  const reason = METERS.includes(reasonParam as Meter) ? (reasonParam as Meter) : null;
  const taskCount = useTaskStore((state) => state.tasks.length);
  const isPro = useSubscriptionStore((state) => state.pro !== null);
  useStatusBarStyle("dark");

  const [state, setState] = useState<PlansState>({ status: "loading" });
  const [choice, setChoice] = useState<PlanChoice>("annual");
  const [busy, setBusy] = useState(false);

  // The screen opens already "loading", so this only has to fetch.
  const loadPlans = useCallback(() => {
    loadProPlans().then(
      (plans) => {
        setState({ status: "ready", plans });
        if (!plans.annual) setChoice("monthly");
      },
      (error) => {
        console.warn("[paywall] couldn't load the plans", error);
        setState({ status: "error" });
      },
    );
  }, []);

  useEffect(() => {
    loadPlans();
    posthog.capture("paywall_viewed", { reason: reason ?? "none" });
  }, [loadPlans, reason]);

  const handleRetry = () => {
    setState({ status: "loading" });
    loadPlans();
  };

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  }, [router]);

  // Pro now — just bought, restored, or already was: nothing left to sell.
  useEffect(() => {
    if (isPro) close();
  }, [isPro, close]);

  const plans = state.status === "ready" ? state.plans : null;
  const selected = plans ? chosenPlan(plans, choice) : null;
  const selectedIsYearly = plans !== null && selected !== null && billedYearly(selected, plans);
  const trial = selected?.trial ?? null;

  const limitLabel = (plan: Plan, meter: Meter) => {
    if (PLAN_LIMITS[plan][meter] === 0) return "–";
    const amount = displayLimit(plan, meter);
    return isTimeMeter(meter) ? t.plan.minutes(amount) : String(amount);
  };

  const handlePurchase = async () => {
    if (!selected || busy) return;
    setBusy(true);
    const outcome = await purchasePlan(selected.package);
    setBusy(false);
    if (outcome === "cancelled") return;
    if (outcome === "purchased") {
      posthog.capture("paywall_purchased", { plan: selectedIsYearly ? "yearly" : "monthly", trial: trial !== null });
      // The screen closes itself as soon as Pro is on (see above).
      showAlert(t.paywall.welcomeTitle, t.paywall.welcomeBody);
      return;
    }
    const messages = { pending: t.paywall.purchasePending, offline: t.paywall.offline, error: t.paywall.purchaseError };
    showAlert(messages[outcome]);
  };

  const handleRestore = async () => {
    if (busy) return;
    setBusy(true);
    const outcome = await restorePurchases();
    setBusy(false);
    const messages = {
      restored: t.settings.restoreDone,
      nothing: t.settings.restoreNothing,
      offline: t.settings.restoreOffline,
      error: t.settings.restoreError,
    };
    showAlert(messages[outcome]);
  };

  const handleOpenLink = async (url: string) => {
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch (error) {
      console.warn("[paywall] couldn't open link", error);
      showAlert(t.settings.linkError);
    }
  };

  // Opened because an allowance ran out: lead with that. Free has no Live
  // voice at all, so there was nothing to run out of.
  const title = !reason ? t.paywall.title : PLAN_LIMITS.free[reason] === 0 ? t.plan.liveProOnly : t.plan.used[reason];
  const subtitle = reason ? t.plan.upgradeHint : t.paywall.subtitle(taskCount);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream[100] }} edges={["top"]}>
      {/* Warm light from the top-right corner, as on the AI chat. */}
      <View pointerEvents="none" className="absolute left-0 right-0 top-0 h-[380px]" style={gradients.creamGlow} />

      <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 8, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        <AnimatedPressable
          onPress={close}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t.paywall.close}
          className="h-[39px] w-[39px] items-center justify-center self-end rounded-full bg-cream-200/80"
        >
          <Feather name="x" size={18} color={colors.ink.cream} />
        </AnimatedPressable>

        <Text className="text-title pt-1 text-ink-cream" style={rtl}>
          {title}
        </Text>
        <Text className="pt-2 font-grotesk-medium text-[14.5px] leading-[21px] text-ink-cream-muted" style={rtl}>
          {subtitle}
        </Text>

        {/* Room above the cards for the badge that sits on the yearly one's edge. */}
        <View className="pt-[26px]">
          <PlanPicker state={state} choice={choice} onChoose={setChoice} onRetry={handleRetry} badge={t.paywall.save} />
        </View>

        <View className="pt-5">
          <CompareRow label={t.paywall.eachMonth} free={t.paywall.free} pro={t.paywall.pro} position="header" />
          {COMPARED.map((meter, index) => (
            <CompareRow
              key={meter}
              label={t.plan.meters[meter]}
              free={limitLabel("free", meter)}
              pro={limitLabel("pro", meter)}
              position={index === COMPARED.length - 1 ? "last" : "middle"}
            />
          ))}
        </View>

        <Text className="pt-4 font-grotesk-medium text-[13px] leading-[19px] text-ink-cream-muted" style={rtl}>
          {t.paywall.unlimitedNote}
        </Text>

        <AnimatedPressable onPress={close} hitSlop={8} accessibilityRole="button" className="mt-5 self-center px-3 py-1.5">
          <Text className="font-grotesk-bold text-[14.5px] text-ink-cream">{t.paywall.continueFree}</Text>
        </AnimatedPressable>

        <View className="flex-row flex-wrap items-center justify-center gap-x-5 gap-y-2 pt-3">
          {[
            { label: t.paywall.restore, onPress: handleRestore },
            { label: t.paywall.termsLink, onPress: () => handleOpenLink(SUPPORT_LINKS.termsOfService) },
            { label: t.paywall.privacyLink, onPress: () => handleOpenLink(SUPPORT_LINKS.privacyPolicy) },
          ].map((link) => (
            <AnimatedPressable key={link.label} onPress={link.onPress} disabled={busy} hitSlop={8} accessibilityRole="link">
              <Text className="font-grotesk-medium text-[12px] text-ink-cream-muted underline">{link.label}</Text>
            </AnimatedPressable>
          ))}
        </View>
      </ScrollView>

      {/* The purchase stays in reach however far the page is scrolled — the
          same raised tray as Add Task's footer. */}
      <View
        className="gap-2 rounded-t-[28px] border-t border-white/80 bg-cream-50 px-[22px] pt-3"
        style={[{ paddingBottom: insets.bottom + 14 }, FOOTER_SHADOW]}
      >
        <PrimaryButton
          size="lg"
          label={busy ? t.paywall.working : trial ? t.paywall.startTrial(trial.count, trial.unit) : t.paywall.subscribe}
          onPress={handlePurchase}
          disabled={!selected || busy}
        />
        {selected ? (
          <Text
            className="text-center font-grotesk-medium text-[12.5px] leading-[18px] text-ink-cream-muted"
            style={rtl ? CENTERED_RTL : undefined}
          >
            {trial
              ? t.paywall.trialTerms(trial.count, trial.unit, selected.package.product.priceString, selectedIsYearly)
              : t.paywall.terms(selected.package.product.priceString, selectedIsYearly)}
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
