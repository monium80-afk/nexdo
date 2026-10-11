import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, Text, View, type TextStyle } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { OnboardingButton, OnboardingLayout } from "@/components/OnboardingLayout";
import { chosenPlan, PlanPicker, type PlanChoice, type PlansState } from "@/components/PlanPicker";
import { SUPPORT_LINKS } from "@/constants/support";
import { gradients } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { showAlert } from "@/lib/alert";
import { displayLimit, SHOWN_METERS } from "@/lib/plan";
import { posthog } from "@/lib/posthog";
import { productPrice } from "@/lib/price";
import { billedYearly, loadOnboardingPlans, purchasePlan, restorePurchases, trialPlanOf } from "@/lib/purchases";
import { useOnboardingStore } from "@/store/useOnboardingStore";

// Widened past the page margins and padded back, so the scroll's edges don't
// clip the plan cards' edges and the badge on the yearly one.
const SCROLL_BLEED = { marginHorizontal: -8 };
// Room at the top for the badge that sits on the yearly card's edge.
const SCROLL_CONTENT = { paddingHorizontal: 8, paddingTop: 14, paddingBottom: 8 };

// Centred Arabic: read right to left, but kept in the middle (useRtlText
// would pull it to the right edge).
const CENTERED_RTL: TextStyle = { writingDirection: "rtl" };

/**
 * Onboarding step 10: the plans, before the account is made — the yearly and
 * monthly prices from the store, what a Pro month includes, and the purchase.
 * Bought here, the subscription moves to the account at sign-up (RevenueCat
 * runs on an anonymous user until then, lib/purchases.ts). Either way, buying
 * or "Continue with Free", the next step is the account.
 */
export default function OnboardingPaywall() {
  const colors = useColors();
  const t = useTranslation();
  const rtl = useRtlText();
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();

  const [state, setState] = useState<PlansState>({ status: "loading" });
  const [choice, setChoice] = useState<PlanChoice>("annual");
  const [busy, setBusy] = useState(false);
  // Bought or restored: the step leaves on its own, on to sign-up.
  const [done, setDone] = useState(false);

  const loadPlans = useCallback(() => {
    loadOnboardingPlans().then(
      (plans) => {
        setState({ status: "ready", plans });
        // Start on the plan the trial timeline just described.
        const withTrial = trialPlanOf(plans);
        setChoice(withTrial ? (withTrial === plans.annual ? "annual" : "monthly") : plans.annual ? "annual" : "monthly");
      },
      (error) => {
        console.warn("[onboarding-paywall] couldn't load the plans", error);
        setState({ status: "error" });
      },
    );
  }, []);

  useEffect(() => {
    loadPlans();
    // So sign-up doesn't offer the paywall a second time (hooks/useAuthSync.ts).
    useOnboardingStore.getState().setSawPaywall(true);
    posthog.capture("paywall_viewed", { reason: "onboarding" });
  }, [loadPlans]);

  if (!isLoaded) return null;
  if (isSignedIn) return <Redirect href="/" />;

  const plans = state.status === "ready" ? state.plans : null;
  const selected = plans ? chosenPlan(plans, choice) : null;
  const selectedIsYearly = plans !== null && selected !== null && billedYearly(selected, plans);
  const trial = selected?.trial ?? null;

  const handleRetry = () => {
    setState({ status: "loading" });
    loadPlans();
  };

  const handlePurchase = async () => {
    if (!selected || busy) return;
    setBusy(true);
    const outcome = await purchasePlan(selected.package);
    setBusy(false);
    if (outcome === "cancelled") return;
    if (outcome === "purchased") {
      posthog.capture("paywall_purchased", { plan: selectedIsYearly ? "yearly" : "monthly", trial: trial !== null, reason: "onboarding" });
      setDone(true);
      return;
    }
    if (outcome === "pending") {
      // Pro switches on by itself once it clears; the account comes next either way.
      showAlert(t.paywall.purchasePending);
      setDone(true);
      return;
    }
    showAlert(outcome === "offline" ? t.paywall.offline : t.paywall.purchaseError);
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
    if (outcome === "restored") setDone(true);
  };

  const handleOpenLink = async (url: string) => {
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch (error) {
      console.warn("[onboarding-paywall] couldn't open link", error);
      showAlert(t.settings.linkError);
    }
  };

  return (
    <OnboardingLayout
      percent={94}
      headline={t.onboardingPaywall.headline}
      body={t.onboardingPaywall.body}
      leaving={done}
      onNext={() => router.push("/(auth)/sign-up")}
      footer={(next) => (
        <View className="gap-2.5">
          <OnboardingButton
            label={busy ? t.paywall.working : trial ? t.paywall.startTrial(trial.count, trial.unit) : t.paywall.subscribe}
            onPress={() => void handlePurchase()}
            disabled={!selected || busy}
          />
          {/* What the store will charge, and when — the terms a subscription has to state. */}
          {selected ? (
            <Text
              className="text-center font-grotesk-medium text-[12.5px] leading-[18px] text-ink-cream-muted"
              style={rtl ? CENTERED_RTL : undefined}
            >
              {trial
                ? t.paywall.trialTerms(trial.count, trial.unit, productPrice(selected.package.product, t.locale), selectedIsYearly)
                : t.paywall.terms(productPrice(selected.package.product, t.locale), selectedIsYearly)}
            </Text>
          ) : null}
          <AnimatedPressable
            onPress={() => {
              posthog.capture("onboarding_paywall_skipped");
              next();
            }}
            disabled={busy}
            scaleTo={0.98}
            hitSlop={8}
            accessibilityRole="button"
            className="items-center py-1"
          >
            <Text className="font-grotesk-semibold text-sm text-ink-cream-muted">{t.paywall.continueFree}</Text>
          </AnimatedPressable>
          <View className="flex-row flex-wrap items-center justify-center gap-x-5 gap-y-1">
            {[
              { label: t.paywall.restore, onPress: handleRestore },
              { label: t.paywall.termsLink, onPress: () => handleOpenLink(SUPPORT_LINKS.termsOfService) },
              { label: t.paywall.privacyLink, onPress: () => handleOpenLink(SUPPORT_LINKS.privacyPolicy) },
            ].map((link) => (
              <AnimatedPressable key={link.label} onPress={link.onPress} disabled={busy} hitSlop={8} accessibilityRole="link">
                <Text className="font-grotesk-medium text-[11.5px] text-ink-cream-subtle underline">{link.label}</Text>
              </AnimatedPressable>
            ))}
          </View>
        </View>
      )}
    >
      <ScrollView className="flex-1" style={SCROLL_BLEED} contentContainerStyle={SCROLL_CONTENT} showsVerticalScrollIndicator={false}>
        <PlanPicker
          state={state}
          choice={choice}
          onChoose={setChoice}
          onRetry={handleRetry}
          badge={t.onboardingPaywall.bestValue}
          centered
        />

        {/* What a Pro month includes — the numbers lib/plan.ts enforces. */}
        <View className="mt-5 gap-3">
          {SHOWN_METERS.map((meter) => (
            <View key={meter} className="flex-row items-center gap-3">
              <View className="tile tile--orange h-[22px] w-[22px] rounded-full" style={gradients.tileOrange}>
                <Feather name="check" size={12} color={colors.orange[600]} />
              </View>
              <Text className="flex-1 font-grotesk-semibold text-[14px] text-ink-cream" style={rtl}>
                {t.onboardingPaywall.features[meter](displayLimit("pro", meter))}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </OnboardingLayout>
  );
}
