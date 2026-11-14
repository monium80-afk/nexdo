import * as WebBrowser from "expo-web-browser";
import { useIsFocused, useRouter } from "expo-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { GemStill } from "@/components/GemMascot";
import { MAX_FONT_SCALE, rowDirection, useIsRtl, useSvgId } from "@/components/onboarding/OnboardingKit";
import { CSS_EASE_IN_OUT, CSS_OUT, kf, useLoopClock } from "@/components/onboarding/timeline";
import { SUPPORT_LINKS } from "@/constants/support";
import { shadow } from "@/constants/shadow";
import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";
import { useTranslation } from "@/hooks/useTranslation";
import { showAlert } from "@/lib/alert";
import type { PaywallReason } from "@/lib/paywall";
import { posthog } from "@/lib/posthog";
import { monthlyEquivalent, productPrice } from "@/lib/price";
import { billedYearly, loadOnboardingPlans, loadProPlans, purchasePlan, restorePurchases, type ProPlan, type ProPlans } from "@/lib/purchases";
import { useOnboardingStore } from "@/store/useOnboardingStore";
import { useSubscriptionStore } from "@/store/useSubscriptionStore";

import { FeatureCarousel } from "./FeatureCarousel";
import { PaywallBackdrop } from "./PaywallBackdrop";
import { PW } from "./paywallTheme";

// The Nexdo Pro paywall (design 7B, nexdo-paywall-7b/), the one screen for
// all three ways in: onboarding, Settings → Upgrade, and a locked feature.
// `mode` decides what happens around it — in onboarding, Close carries on to
// sign-up on Free; in the app, it goes back to where it was opened. `reason`
// is the locked feature it was opened from (or none): that feature's card
// comes to the front with an orange border.
//
// Plans, prices and the trial all come from the store (RevenueCat). The
// 3-day trial is on Yearly only: with Monthly picked the badge goes and the
// button says "Subscribe". The copy never says "AI".
//
// Animations move only opacity and transforms, on the UI thread, off one
// clock that stops while the paywall is out of sight; with Reduce Motion
// everything holds still (the cards can still be swiped).

export type PaywallMode = "onboarding" | "app";

type PlanChoice = "annual" | "monthly";
type PlansState = { status: "loading" } | { status: "error" } | { status: "ready"; plans: ProPlans };

/** The mock is laid out for a phone whose safe area starts 47 px down. */
const MOCK_INSET_TOP = 47;
/** The mock's gem top, which everything around it is placed from. */
const MOCK_GEM_TOP = 44;
/** The room the mock's layout takes between the safe areas (844 − 47 − 34). */
const MOCK_ROOM = 763;

/**
 * The mock's sizes, or the small-phone ones (README "Small phones") when the
 * mock's layout doesn't fit: the gem shrinks to 130 px and the cards to
 * 130 px tall, and the gaps tighten.
 */
function sizesFor(room: number) {
  const compact = room < MOCK_ROOM;
  return compact
    ? { compact, gemW: 130, cardH: 130, headlineGap: 0, carouselGap: 14, plansGap: 22, planGap: 10, minSpacer: 14 }
    : { compact, gemW: 168, cardH: 142, headlineGap: 2, carouselGap: 21, plansGap: 32, planGap: 12, minSpacer: 24 };
}

/** The selected plan's breathing ring (m7Ring): a 4 px halo fading in and out every 3 s. */
function RingGlow({ clock, borderWidth }: { clock: SharedValue<number>; borderWidth: number }) {
  const style = useAnimatedStyle(() => {
    const p = (clock.value % 3) / 3;
    return { opacity: kf(p, [[0, 0], [0.5, 1], [1, 0]], CSS_EASE_IN_OUT) };
  });
  const out = -borderWidth - 4;
  return <Animated.View pointerEvents="none" style={[{ position: "absolute", top: out, right: out, bottom: out, left: out, borderRadius: 24, borderWidth: 4, borderColor: "rgba(242,106,46,0.10)" }, style]} />;
}

function Check() {
  return (
    <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: PW.orange, alignItems: "center", justifyContent: "center" }}>
      <Svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M5 12.5l4.5 4.5L19 7.5" />
      </Svg>
    </View>
  );
}

function PlanCard({
  kind,
  plan,
  selected,
  badge,
  clock,
  moving,
  onPress,
}: {
  kind: PlanChoice;
  plan: ProPlan;
  selected: boolean;
  badge: string | null;
  clock: SharedValue<number>;
  moving: boolean;
  onPress: () => void;
}) {
  const t = useTranslation();
  const copy = t.paywall;
  const rtl = useIsRtl();
  const product = plan.package.product;
  const borderWidth = selected ? 2 : 1.5;
  const align = rtl ? "right" : "left";
  const title = kind === "annual" ? copy.yearly : copy.monthly;
  const perMonth = kind === "annual" ? monthlyEquivalent(product, t.locale) : productPrice(product, t.locale);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${title}, ${perMonth} ${copy.perMonth}${badge ? `, ${badge}` : ""}`}
      style={[
        {
          height: kind === "annual" ? 74 : 64,
          borderRadius: 20,
          borderWidth,
          borderColor: selected ? PW.orange : PW.line,
          backgroundColor: selected ? "rgba(242,106,46,0.12)" : PW.card,
          paddingLeft: (rtl ? 18 : 16) - borderWidth,
          paddingRight: (rtl ? 16 : 18) - borderWidth,
          alignItems: "center",
          gap: 14,
        },
        rowDirection(rtl),
        selected ? { boxShadow: "0 10px 26px rgba(242,106,46,0.14)" } : null,
      ]}
    >
      {selected && moving ? <RingGlow clock={clock} borderWidth={borderWidth} /> : null}
      {badge ? (
        <View style={{ position: "absolute", top: -12 - borderWidth, height: 24, paddingHorizontal: 10, borderRadius: 12, backgroundColor: PW.orange, justifyContent: "center", ...(rtl ? { left: 16 - borderWidth } : { right: 16 - borderWidth }) }}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 12, lineHeight: 15, color: "#FFFFFF" }}>
            {badge}
          </Text>
        </View>
      ) : null}
      {selected ? <Check /> : <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: PW.line }} />}
      <View style={{ flex: 1, gap: 3 }}>
        <Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 18, lineHeight: 22, color: PW.ink, textAlign: align }}>
          {title}
        </Text>
        {kind === "annual" ? (
          // A long price on a narrow phone ("12 months · CA$58.99") takes a second line; the card has room for it.
          <Text numberOfLines={2} maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ fontFamily: "SpaceGrotesk-Regular", fontSize: 13.5, lineHeight: 17, color: PW.muted, textAlign: align }}>
            {copy.yearlyDetail(productPrice(product, t.locale))}
          </Text>
        ) : null}
      </View>
      {/* The price shrinks to fit ("CA$9.49", "€6,99"); "/ month" keeps its size beside it. */}
      <View style={[{ alignItems: "baseline", flexShrink: 1, maxWidth: "50%" }, rowDirection(rtl)]}>
        <Text numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ flexShrink: 1, fontFamily: "SpaceGrotesk-Bold", fontSize: 17, lineHeight: 22, color: PW.ink }}>
          {perMonth}
        </Text>
        <Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ marginStart: 4, fontFamily: "SpaceGrotesk-Regular", fontSize: 13.5, lineHeight: 17, color: PW.muted }}>
          {copy.perMonth}
        </Text>
      </View>
    </Pressable>
  );
}

/** The button's light band sweeping across it every 4 s (m7Shine): still in the 62 % → 82 % of each pass. */
function Shine({ clock, width }: { clock: SharedValue<number>; width: number }) {
  const id = useSvgId("shine");
  const band = width * 0.34;
  const style = useAnimatedStyle(() => {
    const p = (clock.value % 4) / 4;
    return { transform: [{ translateX: kf(p, [[0.62, -1.2 * band], [0.82, 3.2 * band]], CSS_EASE_IN_OUT) }, { skewX: "-20deg" }] };
  });
  if (width <= 0) return null;
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", top: 0, bottom: 0, left: 0, width: band }, style]}>
      <Svg width={band} height={56}>
        <Defs>
          <LinearGradient id={id} x1={0} y1={0} x2={1} y2={0}>
            <Stop offset={0} stopColor="#FFFFFF" stopOpacity={0} />
            <Stop offset={0.5} stopColor="#FFFFFF" stopOpacity={0.35} />
            <Stop offset={1} stopColor="#FFFFFF" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width={band} height={56} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

/** A 40 px pill over the dark: Close and Restore. */
function Pill({ onPress, disabled, label, children, width }: { onPress: () => void; disabled: boolean; label: string; children: ReactNode; width?: number }) {
  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      scaleTo={0.94}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ height: 40, width, minWidth: 40, paddingHorizontal: width ? 0 : 14, borderRadius: 20, backgroundColor: PW.glass, alignItems: "center", justifyContent: "center" }}
    >
      {children}
    </AnimatedPressable>
  );
}

export function NexdoPaywall({ mode, reason }: { mode: PaywallMode; /** The locked feature it was opened from, if any. */ reason: PaywallReason | null }) {
  const t = useTranslation();
  const copy = t.paywall;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const rtl = useIsRtl();
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const focused = useIsFocused();
  const moving = focused && !reduceMotion;
  useStatusBarStyle("light");

  const bottomPad = Math.max(insets.bottom, 20);
  const sizes = sizesFor(height - insets.top - bottomPad);
  const gemW = sizes.gemW;
  const gemH = (gemW * 220) / 200;
  const gemTop = insets.top + MOCK_GEM_TOP - MOCK_INSET_TOP;
  const k = gemW / 168;

  // One clock for every loop on the screen, in seconds; it holds while out of sight or with Reduce Motion.
  const clock = useLoopClock(3600);

  const [plansState, setPlansState] = useState<PlansState>({ status: "loading" });
  const [choice, setChoice] = useState<PlanChoice>("annual");
  const [busy, setBusy] = useState(false);
  const [buttonWidth, setButtonWidth] = useState(0);

  const loadPlans = useCallback(() => {
    // Onboarding has no account yet (an anonymous purchaser); the app's is the signed-in one.
    (mode === "onboarding" ? loadOnboardingPlans() : loadProPlans()).then(
      (plans) => {
        setPlansState({ status: "ready", plans });
        // Yearly first — the plan with the trial.
        setChoice(plans.annual ? "annual" : "monthly");
      },
      (error) => {
        console.warn("[paywall] couldn't load the plans", error);
        setPlansState({ status: "error" });
      },
    );
  }, [mode]);

  useEffect(() => {
    loadPlans();
    // So sign-up doesn't offer the paywall a second time (hooks/useAuthSync.ts).
    if (mode === "onboarding") useOnboardingStore.getState().setSawPaywall(true);
    posthog.capture("paywall_viewed", { reason: reason ?? (mode === "onboarding" ? "onboarding" : "none") });
  }, [loadPlans, mode, reason]);

  // Onboarding goes on to sign-up (on Free unless something was bought); the app goes back to where the paywall was opened.
  const goOn = useCallback(() => {
    if (mode === "onboarding") router.push("/onboarding/save");
    else if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  }, [mode, router]);

  // In the app: Pro now — just bought, restored, or already was — nothing left to sell.
  const isPro = useSubscriptionStore((state) => state.pro !== null);
  useEffect(() => {
    if (mode === "app" && isPro) goOn();
  }, [mode, isPro, goOn]);

  const plans = plansState.status === "ready" ? plansState.plans : null;
  const selected = plans ? (choice === "annual" ? (plans.annual ?? plans.monthly) : (plans.monthly ?? plans.annual)) : null;
  const selectedYearly = plans !== null && selected !== null && billedYearly(selected, plans);
  // The trial is Yearly's alone: Monthly never shows one, even if the store has it.
  const trial = selected && selected === plans?.annual ? selected.trial : null;
  const badge = plans?.annual?.trial && choice === "annual" ? copy.trialBadge(plans.annual.trial.count, plans.annual.trial.unit) : null;
  const buyLabel = busy ? copy.working : trial ? copy.startTrial(trial.count, trial.unit) : copy.subscribe;
  const smallLine = selected
    ? trial
      ? copy.trialLine(trial.count, trial.unit, productPrice(selected.package.product, t.locale))
      : copy.priceLine(productPrice(selected.package.product, t.locale), selectedYearly)
    : null;

  const handleBuy = async () => {
    if (!plans || !selected || busy) return;
    setBusy(true);
    const outcome = await purchasePlan(selected.package);
    setBusy(false);
    if (outcome === "cancelled") return;
    if (outcome === "purchased" || outcome === "pending") {
      posthog.capture("paywall_purchased", { plan: selectedYearly ? "yearly" : "monthly", trial: trial !== null, reason: reason ?? mode });
      if (outcome === "pending") showAlert(copy.purchasePending);
      else if (mode === "app") showAlert(copy.welcomeTitle, copy.welcomeBody);
      // In the app it closes itself once Pro is on (above).
      if (mode === "onboarding") goOn();
      return;
    }
    showAlert(outcome === "offline" ? copy.offline : copy.purchaseError);
  };

  const handleRestore = async () => {
    if (busy) return;
    setBusy(true);
    const outcome = await restorePurchases();
    setBusy(false);
    const messages = { restored: t.settings.restoreDone, nothing: t.settings.restoreNothing, offline: t.settings.restoreOffline, error: t.settings.restoreError };
    showAlert(messages[outcome]);
    if (outcome === "restored" && mode === "onboarding") goOn();
  };

  const handleClose = () => {
    posthog.capture(mode === "onboarding" ? "onboarding_paywall_skipped" : "paywall_closed", { reason: reason ?? mode });
    goOn();
  };

  // The gem floats 6 px up and back every 4.5 s (m7Float).
  const floatStyle = useAnimatedStyle(() => {
    const p = (clock.value % 4.5) / 4.5;
    return { transform: [{ translateY: -6 * kf(p, [[0, 0], [0.5, 1], [1, 0]], CSS_EASE_IN_OUT) }] };
  });

  // The headline rises in once (m7In, 0.5 s).
  const headlineIn = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) return;
    headlineIn.value = withTiming(1, { duration: 500, easing: CSS_OUT });
  }, [headlineIn, reduceMotion]);
  const headlineStyle = useAnimatedStyle(() => ({ opacity: headlineIn.value, transform: [{ translateY: 10 * (1 - headlineIn.value) }] }));

  const ctaId = useSvgId("cta");
  const align = rtl ? "right" : "left";

  const place = {
    k,
    x: (mockX: number) => mockX + (width - 390) / 2,
    y: (mockY: number) => gemTop + (mockY - MOCK_GEM_TOP) * k,
  };

  return (
    <View style={{ flex: 1, backgroundColor: PW.bg }}>
      <PaywallBackdrop clock={clock} width={width} height={height} place={place} />

      <ScrollView
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1, paddingTop: Math.max(0, gemTop), paddingBottom: bottomPad }}
      >
        {/* The fire gem, its foot fading out (the mock's mask: 58 % → 96 %). */}
        <Animated.View pointerEvents="none" style={[{ alignSelf: "center", width: gemW, height: gemH, marginTop: Math.min(0, gemTop) }, floatStyle]}>
          {/* The mock's drawing starts 8 units down its viewBox. */}
          <View style={{ transform: [{ translateY: (-8 * gemW) / 200 }] }}>
            <GemStill level={5} width={gemW} fadeBottom still={!focused} />
          </View>
        </Animated.View>

        <Animated.View style={[{ marginTop: sizes.headlineGap, paddingHorizontal: 28, alignItems: "center" }, headlineStyle]}>
          <Text accessibilityRole="header" numberOfLines={2} adjustsFontSizeToFit maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 30, lineHeight: 32.4, letterSpacing: -0.9, color: PW.ink, textAlign: "center" }}>
            {copy.headline[0]}
            {"\n"}
            <Text style={{ color: PW.peach }}>{copy.headline[1]}</Text>
          </Text>
          <Text numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ marginTop: 8, fontFamily: "SpaceGrotesk-Regular", fontSize: 15.5, lineHeight: 20, color: PW.muted, textAlign: "center" }}>
            {copy.subtitle}
          </Text>
        </Animated.View>

        <View style={{ marginTop: sizes.carouselGap }}>
          <FeatureCarousel cardHeight={sizes.cardH} highlight={reason} moving={moving} />
        </View>

        <View accessibilityRole="radiogroup" style={{ marginTop: sizes.plansGap, marginHorizontal: 20, gap: sizes.planGap }}>
          {plans ? (
            <>
              {plans.annual ? <PlanCard kind="annual" plan={plans.annual} selected={selected === plans.annual} badge={badge} clock={clock} moving={moving} onPress={() => setChoice("annual")} /> : null}
              {plans.monthly ? <PlanCard kind="monthly" plan={plans.monthly} selected={selected === plans.monthly} badge={null} clock={clock} moving={moving} onPress={() => setChoice("monthly")} /> : null}
            </>
          ) : (
            <AnimatedPressable
              onPress={plansState.status === "error" ? () => { setPlansState({ status: "loading" }); loadPlans(); } : undefined}
              disabled={plansState.status !== "error"}
              accessibilityRole="button"
              style={{ height: 74 + sizes.planGap + 64, borderRadius: 20, borderWidth: 1.5, borderColor: PW.line, backgroundColor: PW.card, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 }}
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ fontFamily: "SpaceGrotesk-Medium", fontSize: 13.5, lineHeight: 19, color: PW.muted, textAlign: "center" }}>
                {plansState.status === "error" ? `${copy.loadError}\n` : copy.loading}
                {plansState.status === "error" ? <Text style={{ fontFamily: "SpaceGrotesk-Bold", color: PW.ink }}>{copy.retry}</Text> : null}
              </Text>
            </AnimatedPressable>
          )}
        </View>

        <View style={{ flex: 1, minHeight: sizes.minSpacer }} />

        <View style={{ marginHorizontal: 20, alignItems: "center", gap: 10 }}>
          <AnimatedPressable
            onPress={() => void handleBuy()}
            disabled={!selected || busy}
            scaleTo={0.97}
            accessibilityRole="button"
            accessibilityLabel={buyLabel}
            onLayout={(event) => setButtonWidth(event.nativeEvent.layout.width)}
            style={[
              { alignSelf: "stretch", height: 56, borderRadius: 28, backgroundColor: PW.orange, overflow: "hidden", alignItems: "center", justifyContent: "center", opacity: !selected || busy ? 0.7 : 1 },
              shadow("0 10px 26px rgba(242,106,46,0.38)", 10, PW.orange),
            ]}
          >
            <Svg width="100%" height={56} style={{ position: "absolute" }}>
              <Defs>
                <LinearGradient id={ctaId} x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#FF7A3A" />
                  <Stop offset="1" stopColor="#EE5E22" />
                </LinearGradient>
              </Defs>
              <Rect width="100%" height={56} fill={`url(#${ctaId})`} />
            </Svg>
            <Text numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ paddingHorizontal: 20, fontFamily: "SpaceGrotesk-Bold", fontSize: 17, lineHeight: 22, color: "#FFFFFF" }}>
              {buyLabel}
            </Text>
            {moving && !busy ? <Shine clock={clock} width={buttonWidth} /> : null}
          </AnimatedPressable>

          {/* What the store will charge, and when — what a subscription has to state. */}
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ minHeight: 17, fontFamily: "SpaceGrotesk-Regular", fontSize: 12.5, lineHeight: 17, color: PW.muted, textAlign: "center" }}>
            {smallLine ?? " "}
          </Text>
          <View style={[{ gap: 22 }, rowDirection(rtl)]}>
            <Text
              onPress={() => void WebBrowser.openBrowserAsync(SUPPORT_LINKS.termsOfService).catch(() => {})}
              accessibilityRole="link"
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              suppressHighlighting
              style={{ fontFamily: "SpaceGrotesk-SemiBold", fontSize: 12.5, lineHeight: 17, color: PW.soft, textAlign: align }}
            >
              {copy.termsLink}
            </Text>
            <Text
              onPress={() => void WebBrowser.openBrowserAsync(SUPPORT_LINKS.privacyPolicy).catch(() => {})}
              accessibilityRole="link"
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              suppressHighlighting
              style={{ fontFamily: "SpaceGrotesk-SemiBold", fontSize: 12.5, lineHeight: 17, color: PW.soft, textAlign: align }}
            >
              {copy.privacyLink}
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Close and Restore stay put over everything. */}
      <View pointerEvents="box-none" style={[{ position: "absolute", left: 20, right: 20, top: insets.top + 54 - MOCK_INSET_TOP, justifyContent: "space-between" }, rowDirection(rtl)]}>
        <Pill onPress={handleClose} disabled={busy} label={copy.close} width={40}>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={PW.ink} strokeWidth={2.2} strokeLinecap="round">
            <Path d="M6 6l12 12M18 6L6 18" />
          </Svg>
        </Pill>
        <Pill onPress={() => void handleRestore()} disabled={busy} label={copy.restore}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ fontFamily: "SpaceGrotesk-SemiBold", fontSize: 14, lineHeight: 18, color: PW.soft }}>
            {copy.restore}
          </Text>
        </Pill>
      </View>
    </View>
  );
}
