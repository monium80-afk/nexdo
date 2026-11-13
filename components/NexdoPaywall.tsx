import * as WebBrowser from "expo-web-browser";
import { useIsFocused, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { Text, useWindowDimensions, View, type TextStyle, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from "react-native-svg";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { GemStill } from "@/components/GemMascot";
import { ABOVE_SHADOW, footerBottom, MAX_FONT_SCALE, ONB, rowDirection, useIsRtl, useSvgId } from "@/components/onboarding/OnboardingKit";
import { kf, LINEAR } from "@/components/onboarding/timeline";
import { chosenPlan, type PlanChoice, type PlansState } from "@/components/PlanPicker";
import { SUPPORT_LINKS } from "@/constants/support";
import { shadow } from "@/constants/shadow";
import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";
import { useTranslation } from "@/hooks/useTranslation";
import { showAlert } from "@/lib/alert";
import { FOCUS_SOUNDS } from "@/lib/focusSound";
import { isTimeMeter, PLAN_LIMITS, type Meter } from "@/lib/plan";
import { posthog } from "@/lib/posthog";
import { monthlyEquivalent, productPrice } from "@/lib/price";
import { billedYearly, loadOnboardingPlans, loadProPlans, purchasePlan, restorePurchases, trialPlanOf } from "@/lib/purchases";
import { useOnboardingStore } from "@/store/useOnboardingStore";
import { useSubscriptionStore } from "@/store/useSubscriptionStore";

// The paywall — onboarding's screen 12 (screens/12-paywall.html), and since
// 2026-11-13 the app's own too (app/paywall.tsx), so both look the same.
// `mode` decides what happens around it: in onboarding, closing or going on
// leads to sign-up; in the app, it closes back to where it was opened.
//
// A Free / Pro switch, opening on
// Pro (every row shows what a Pro month includes — the numbers lib/plan.ts
// enforces); Free lists what's free, the smart features locked. Flipping to
// Pro grows a dark circle out of the gem and the gem catches fire. The copy
// never says "AI" (the user: people are put off by it). No icons before the
// rows (asked 2026-11-13). Plans, prices and the
// trial come from the store (RevenueCat): the 3-day trial is on Yearly only,
// so Monthly says "Subscribe". Bought here, the subscription moves to the
// account made on the next screen (lib/purchases.ts, anonymous until then).
//
// The flip is animated only while it plays; before and after, React draws
// the side it rests on (so nothing stays half-faded if an animation didn't
// run). Only opacity and transforms animate: colour changes are two layers
// crossfading.

/** The flip, in seconds from the tap (the mock's 14 % → 46 % of 8 s). */
const FLIP = 2.6;
/** The flip back to Free, in ms. */
const FLIP_BACK_MS = 1600;
const KNOB_EASE = Easing.bezierFn(0.5, 0, 0.2, 1.2);
const CIRCLE_EASE = Easing.bezierFn(0.55, 0, 0.25, 1);
const VALUE_EASE = Easing.bezierFn(0.3, 0.7, 0.2, 1);
const EASE_OUT = Easing.out(Easing.quad);
/** A mock keyframe % as seconds into the flip. */
const sec = (percent: number) => ((percent - 14) / 100) * 8;

/**
 * The flip's keyframes, worked out here: the animations run on the UI thread
 * and may only read plain numbers — calling `sec` from there closed the app
 * going to this screen (2026-11-13, "Tried to synchronously call a Remote
 * Function. Called "sec"").
 */
const K = {
  s17: sec(17),
  s19: sec(19),
  s20: sec(20),
  s21: sec(21),
  s22: sec(22),
  s23: sec(23),
  s24: sec(24),
  s26: sec(26),
  s27: sec(27),
  s32: sec(32),
  s33: sec(33),
  s34: sec(34),
  s40: sec(40),
  s46: sec(46),
};

/**
 * A style read off the flip: `style(phase)` (a worklet) while it plays, the
 * plain object `style(rest)` from React when it rests (`rest` is null while
 * it plays).
 */
function usePhaseStyle<S extends ViewStyle | TextStyle>(phase: SharedValue<number>, rest: number | null, style: (v: number) => S) {
  const animated = useAnimatedStyle(() => style(phase.value));
  return rest === null ? animated : style(rest);
}

/** Text that changes colour by crossfading a second copy over it (`over` is that copy's opacity style). */
function FadeText({ text, from, to, over, family = "SpaceGrotesk-Bold" }: { text: string; from: string; to: string; over: ComponentProps<typeof Animated.View>["style"]; family?: string }) {
  return (
    <View>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ fontSize: 14, fontFamily: family, color: from }}>
        {text}
      </Text>
      <Animated.View style={[{ position: "absolute", top: 0, left: 0, right: 0 }, over]}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ fontSize: 14, fontFamily: family, color: to }}>
          {text}
        </Text>
      </Animated.View>
    </View>
  );
}

/** Where the gem sits, from the top of the safe area: bar, switch, then the gem (a little higher than the mock's, asked 2026-11-13). */
const BAR_TOP = 2;
const SWITCH_GAP = 6;
const GEM_TOP = BAR_TOP + 40 + SWITCH_GAP + 44 + 8;
const GEM_W = 124;
const GEM_H = 136;
const ROW_H = 33;

/**
 * The gem's and the rows' sizes for this screen. The mock fits 844 px; on a
 * shorter phone (or with larger system text) the gem and the row spacing give
 * way first, so the plans and the button never slide over the rows.
 */
function usePaywallSizes() {
  const insets = useSafeAreaInsets();
  const { height, fontScale } = useWindowDimensions();
  const available = height - insets.top - footerBottom(insets.bottom);
  // Everything that doesn't shrink: bar, switch, title, plans, button, the lines under it.
  const fixed = GEM_TOP + 2 + 11 + 12 + 72 + 14 + 50 + (57 + 24 + 32) * Math.min(MAX_FONT_SCALE, Math.max(1, fontScale));
  const room = available - fixed;
  const rowHeight = Math.max(27, Math.min(ROW_H, (room - GEM_H) / ROWS.length));
  const gemHeight = Math.max(72, Math.min(GEM_H, room - ROWS.length * rowHeight));
  const gemWidth = (gemHeight * GEM_W) / GEM_H;
  return { rowHeight, gemHeight, gemWidth, contentTop: GEM_TOP + gemHeight + 2 };
}

type RowKey = "live" | "assist" | "media" | "voice" | "chat" | "sounds" | "insights";
const ROWS: RowKey[] = ["live", "assist", "media", "voice", "chat", "sounds", "insights"];
const METER_OF: Partial<Record<RowKey, Meter>> = { live: "live", assist: "assist", media: "media", voice: "voice", chat: "chat" };

function Lock({ color }: { color: string }) {
  return (
    <Svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={5} y={11} width={14} height={10} rx={2.5} />
      <Path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Svg>
  );
}

/** One side of the paywall below the gem: title, rows, plans, button. Free on paper, Pro on the dark. */
function PlanSide({
  rowHeight,
  pro,
  phase,
  rest,
  plansState,
  choice,
  onChoose,
  onBuy,
  onFree,
  onRetry,
  busy,
}: {
  rowHeight: number;
  pro: boolean;
  phase: SharedValue<number>;
  rest: number | null;
  plansState: PlansState;
  choice: PlanChoice;
  onChoose: (choice: PlanChoice) => void;
  onBuy: () => void;
  onFree: () => void;
  onRetry: () => void;
  busy: boolean;
}) {
  const t = useTranslation();
  const copy = t.onboardingFlow.paywall;
  const rtl = useIsRtl();
  const insets = useSafeAreaInsets();
  const ctaId = useSvgId("cta");
  const ink = pro ? ONB.paper : ONB.ink;
  const muted = pro ? "#BFB2A7" : ONB.muted;
  const number = new Intl.NumberFormat(t.locale);

  // The Pro side fades in part by part (pwIn), each a little after the last.
  const titleStyle = useFadeIn(pro, phase, rest, 0.19);
  const rowsStyle = useFadeIn(pro, phase, rest, 0.26);
  const plansStyle = useFadeIn(pro, phase, rest, 0.54);
  const ctaStyle = useFadeIn(pro, phase, rest, 0.63);

  const value = (row: RowKey): string => {
    const meter = METER_OF[row];
    if (meter) {
      const limit = PLAN_LIMITS.pro[meter];
      return isTimeMeter(meter) ? t.paywall.seconds(number.format(limit)) : number.format(limit);
    }
    if (row === "sounds") return pro ? copy.allSounds(FOCUS_SOUNDS.length) : t.focusSound.names.rain;
    return pro ? copy.insightsPro : copy.insightsFree;
  };

  const plans = plansState.status === "ready" ? plansState.plans : null;
  const selected = plans ? chosenPlan(plans, choice) : null;
  const trial = selected?.trial ?? null;
  const monthly = plans?.monthly?.package.product ?? null;
  const annual = plans?.annual?.package.product ?? null;
  const saved = monthly && annual && monthly.price > 0 ? Math.round((1 - annual.price / (monthly.price * 12)) * 100) : 0;
  const selectedYearly = plans !== null && selected !== null && billedYearly(selected, plans);
  const buyLabel = busy ? t.paywall.working : trial ? t.paywall.startTrial(trial.count, trial.unit) : copy.subscribe;

  const planCard = (kind: PlanChoice) => {
    const product = kind === "annual" ? annual : monthly;
    if (!product) return null;
    const on = choice === kind;
    const border = pro ? (on ? ONB.orange : "rgba(250,241,228,0.14)") : on ? ONB.ink : ONB.line;
    const background = pro ? (on ? "rgba(242,106,46,0.14)" : "rgba(250,241,228,0.04)") : ONB.card;
    return (
      <AnimatedPressable
        key={kind}
        onPress={() => onChoose(kind)}
        scaleTo={0.97}
        accessibilityRole="radio"
        accessibilityState={{ checked: on }}
        style={{ flex: 1, minHeight: 64, borderRadius: 18, borderWidth: on ? 2 : 1.5, borderColor: border, backgroundColor: background, paddingHorizontal: 14, paddingVertical: 10, justifyContent: "center" }}
      >
        {kind === "annual" && saved > 0 ? (
          <View style={{ position: "absolute", top: -10, height: 20, paddingHorizontal: 8, borderRadius: 10, backgroundColor: pro ? ONB.orange : "#EFE3D4", justifyContent: "center", ...(rtl ? { left: 12 } : { right: 12 }) }}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ fontSize: 11, fontFamily: "SpaceGrotesk-Bold", color: pro ? "#FFFFFF" : ONB.deepOrange }}>
              {copy.discount(saved)}
            </Text>
          </View>
        ) : null}
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ fontSize: 12.5, lineHeight: 16, fontFamily: "SpaceGrotesk-SemiBold", color: muted, textAlign: rtl ? "right" : "left" }}>
          {kind === "annual" ? copy.yearly : copy.monthly}
        </Text>
        {/* The price shrinks to fit; "/ mo" keeps its size beside it. */}
        <View style={[{ alignItems: "baseline", gap: 4 }, rowDirection(rtl)]}>
          <Text numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ flexShrink: 1, fontSize: 19, lineHeight: 24, fontFamily: "SpaceGrotesk-Bold", color: pro ? "#FFFFFF" : ONB.ink }}>
            {kind === "annual" ? monthlyEquivalent(product, t.locale) : productPrice(product, t.locale)}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ fontSize: 11.5, fontFamily: "SpaceGrotesk-Regular", color: muted }}>
            {copy.perMonth}
          </Text>
        </View>
        <Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ fontSize: 11, lineHeight: 15, fontFamily: "SpaceGrotesk-Regular", color: muted, textAlign: rtl ? "right" : "left" }}>
          {kind === "annual" ? copy.aYear(productPrice(product, t.locale)) : copy.billedMonthly}
        </Text>
      </AnimatedPressable>
    );
  };

  return (
    <View style={{ flex: 1, paddingHorizontal: 20, paddingBottom: footerBottom(insets.bottom) }}>
      <Animated.View style={[{ alignItems: "center" }, titleStyle]}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="text-center font-grotesk-bold text-[28px] leading-[30px] tracking-[-0.84px]" style={{ color: ink }}>
          {pro ? copy.proTitle : copy.freeTitle}
        </Text>
        <Text numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={MAX_FONT_SCALE} className="mt-1.5 text-center font-grotesk-regular text-[13.5px]" style={{ color: muted }}>
          {pro ? copy.proBody : copy.freeBody}
        </Text>
      </Animated.View>

      <Animated.View style={[{ marginTop: 11, paddingHorizontal: 6 }, rowsStyle]}>
        {ROWS.map((row, index) => {
          const locked = !pro && METER_OF[row] !== undefined;
          return (
            <View key={row} style={[{ height: rowHeight, alignItems: "center", gap: 12 }, rowDirection(rtl)]}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="flex-1 font-grotesk-semibold text-[13.5px]" style={{ color: ink, textAlign: rtl ? "right" : "left" }}>
                {copy.rows[row]}
              </Text>
              {locked ? (
                <View style={[{ height: 22, paddingHorizontal: 8, borderRadius: 11, backgroundColor: "#EFE3D4", alignItems: "center", gap: 4 }, rowDirection(rtl)]}>
                  <Lock color="#A89A8E" />
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ fontSize: 11.5, fontFamily: "SpaceGrotesk-Bold", color: "#A89A8E" }}>{copy.locked}</Text>
                </View>
              ) : pro ? (
                <ProValue phase={phase} rest={rest} index={index} text={value(row)} />
              ) : (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ fontSize: 14, fontFamily: "SpaceGrotesk-Bold", color: ONB.ink }}>{value(row)}</Text>
              )}
            </View>
          );
        })}
      </Animated.View>

      <View style={{ flex: 1 }} />

      <Animated.View style={plansStyle}>
        {plansState.status === "ready" ? (
          <View style={[{ gap: 8 }, rowDirection(rtl)]} accessibilityRole="radiogroup">
            {planCard("annual")}
            {planCard("monthly")}
          </View>
        ) : (
          <AnimatedPressable onPress={plansState.status === "error" ? onRetry : undefined} disabled={plansState.status !== "error"} style={{ height: 72, alignItems: "center", justifyContent: "center" }}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="text-center font-grotesk-medium text-[13px]" style={{ color: muted }}>
              {plansState.status === "error" ? `${t.paywall.loadError} ${t.paywall.retry}` : t.paywall.loading}
            </Text>
          </AnimatedPressable>
        )}
      </Animated.View>

      <Animated.View style={[{ marginTop: 14 }, ctaStyle]}>
        <AnimatedPressable
          onPress={onBuy}
          disabled={!selected || busy}
          scaleTo={0.97}
          accessibilityRole="button"
          accessibilityLabel={buyLabel}
          style={[
            { height: 50, borderRadius: 25, backgroundColor: pro ? ONB.orange : ONB.ink, overflow: "hidden", alignItems: "center", justifyContent: "center", gap: 10, opacity: !selected || busy ? 0.7 : 1 },
            pro ? shadow("0 12px 30px rgba(242,106,46,0.55)", 10, ONB.orange) : null,
            rowDirection(rtl),
          ]}
        >
          {pro ? (
            <Svg width="100%" height={50} style={{ position: "absolute" }}>
              <Defs>
                <LinearGradient id={ctaId} x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#FF8040" />
                  <Stop offset="1" stopColor={ONB.orange} />
                </LinearGradient>
              </Defs>
              <Rect width="100%" height={50} fill={`url(#${ctaId})`} />
            </Svg>
          ) : null}
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="font-grotesk-bold text-[16px] text-white" style={{ zIndex: 1 }}>
            {buyLabel}
          </Text>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" style={[{ zIndex: 1 }, rtl ? { transform: [{ scaleX: -1 }] } : null]}>
            <Path d="M5 12h14M13 6l6 6-6 6" />
          </Svg>
        </AnimatedPressable>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="mt-2 text-center text-[12px]" style={{ color: muted, fontFamily: "SpaceGrotesk-Regular" }}>
          {copy.cancelAnytime}
          {" · "}
          <Text onPress={busy ? undefined : onFree} accessibilityRole="button" style={{ color: ink, fontFamily: "SpaceGrotesk-Bold" }}>
            {copy.continueFree}
          </Text>
        </Text>
        {/* What the store will charge, and when, with Terms and Privacy — what a subscription has to state. */}
        {selected ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="mt-1 text-center text-[10.5px] leading-[14px]" style={{ color: muted, fontFamily: "SpaceGrotesk-Regular", opacity: 0.85 }}>
            {trial
              ? t.paywall.trialTerms(trial.count, trial.unit, productPrice(selected.package.product, t.locale), selectedYearly)
              : t.paywall.terms(productPrice(selected.package.product, t.locale), selectedYearly)}{" "}
            <Text onPress={() => void WebBrowser.openBrowserAsync(SUPPORT_LINKS.termsOfService).catch(() => {})} style={{ textDecorationLine: "underline" }}>
              {t.paywall.termsLink}
            </Text>
            {" · "}
            <Text onPress={() => void WebBrowser.openBrowserAsync(SUPPORT_LINKS.privacyPolicy).catch(() => {})} style={{ textDecorationLine: "underline" }}>
              {t.paywall.privacyLink}
            </Text>
          </Text>
        ) : null}
      </Animated.View>
    </View>
  );
}

/** A part of the Pro side fading in, `delay` s after the others (pwIn). Free's side is simply there. */
function useFadeIn(pro: boolean, phase: SharedValue<number>, rest: number | null, delay: number) {
  return usePhaseStyle(phase, rest, (v) => {
    "worklet";
    return { opacity: pro ? kf(v, [[K.s21 + delay, 0], [K.s27 + delay, 1]], LINEAR) : 1 };
  });
}

/** A Pro row's number, rising in after the dark has spread (pwVal, 0.07 s apart). */
function ProValue({ phase, rest, index, text }: { phase: SharedValue<number>; rest: number | null; index: number; text: string }) {
  const style = usePhaseStyle(phase, rest, (v) => {
    "worklet";
    const p = kf(v, [[K.s27 + 0.07 * index, 0], [K.s33 + 0.07 * index, 1]], VALUE_EASE);
    return { opacity: p, transform: [{ translateY: (1 - p) * 12 }] };
  });
  return (
    <Animated.Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[{ fontSize: 15.5, fontFamily: "SpaceGrotesk-Bold", letterSpacing: -0.3, color: "#FFFFFF" }, style]}>
      {text}
    </Animated.Text>
  );
}

export type PaywallMode = "onboarding" | "app";

export function NexdoPaywall({ mode, reason }: { mode: PaywallMode; /** What opened it, for analytics. */ reason: string }) {
  const t = useTranslation();
  const copy = t.onboardingFlow.paywall;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const rtl = useIsRtl();
  const reduceMotion = useReducedMotion();

  const [plansState, setPlansState] = useState<PlansState>({ status: "loading" });
  const [choice, setChoice] = useState<PlanChoice>("annual");
  const [busy, setBusy] = useState(false);
  // Opens on Pro (asked 2026-11-13); the Free tab flips back.
  const [pro, setPro] = useState(true);
  // True while the flip plays; otherwise React draws the side it rests on.
  const [moving, setMoving] = useState(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );
  const rest = moving ? null : pro ? FLIP : 0;
  // The gems' own life (blink, flame) pauses while another screen is in front.
  const focused = useIsFocused();
  useStatusBarStyle(pro ? "light" : "dark");

  // Seconds into the flip: 0 = Free, FLIP = Pro.
  const phase = useSharedValue(FLIP);
  const flip = (toPro: boolean) => {
    if (toPro === pro) return;
    setPro(toPro);
    posthog.capture("paywall_side_switched", { side: toPro ? "pro" : "free", reason });
    if (settleTimer.current) clearTimeout(settleTimer.current);
    if (reduceMotion) {
      phase.value = toPro ? FLIP : 0;
      setMoving(false);
      return;
    }
    // Back to Free plays the same flip in reverse, a little quicker — the
    // dark circle closing smoothly into the gem (it used to snap back in 0.6 s).
    const duration = toPro ? FLIP * 1000 : FLIP_BACK_MS;
    phase.value = withTiming(toPro ? FLIP : 0, { duration, easing: LINEAR });
    setMoving(true);
    settleTimer.current = setTimeout(() => setMoving(false), duration + 150);
  };

  const loadPlans = useCallback(() => {
    // Onboarding has no account yet (an anonymous purchaser); the app's is the signed-in one.
    (mode === "onboarding" ? loadOnboardingPlans() : loadProPlans()).then(
      (plans) => {
        setPlansState({ status: "ready", plans });
        // Start on the plan with the trial — Yearly.
        const withTrial = trialPlanOf(plans);
        setChoice(withTrial ? (withTrial === plans.annual ? "annual" : "monthly") : plans.annual ? "annual" : "monthly");
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
    posthog.capture("paywall_viewed", { reason });
  }, [loadPlans, mode, reason]);

  // Onboarding goes on to sign-up; the app goes back to where the paywall was opened.
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

  const handleBuy = async () => {
    const plans = plansState.status === "ready" ? plansState.plans : null;
    const selected = plans ? chosenPlan(plans, choice) : null;
    if (!plans || !selected || busy) return;
    setBusy(true);
    const outcome = await purchasePlan(selected.package);
    setBusy(false);
    if (outcome === "cancelled") return;
    if (outcome === "purchased" || outcome === "pending") {
      posthog.capture("paywall_purchased", { plan: billedYearly(selected, plans) ? "yearly" : "monthly", trial: selected.trial !== null, reason });
      if (outcome === "pending") showAlert(t.paywall.purchasePending);
      else if (mode === "app") showAlert(t.paywall.welcomeTitle, t.paywall.welcomeBody);
      // In the app it closes itself once Pro is on (above).
      if (mode === "onboarding") goOn();
      return;
    }
    showAlert(outcome === "offline" ? t.paywall.offline : t.paywall.purchaseError);
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

  const handleFree = () => {
    posthog.capture(mode === "onboarding" ? "onboarding_paywall_skipped" : "paywall_closed", { reason });
    goOn();
  };

  // The dark circle spreading from the gem (pwCirc), and the Pro side above it.
  // Drawn at 280 px and scaled ×6 (the mock's 1400 px circle and a bit more, so a tall phone's corners are covered too — without a huge layer to paint).
  const circleStyle = usePhaseStyle(phase, rest, (v) => {
    "worklet";
    return { transform: [{ scale: 6 * kf(v, [[K.s19, 0], [K.s34, 1]], CIRCLE_EASE) }] };
  });
  const proSide = usePhaseStyle(phase, rest, (v) => {
    "worklet";
    return { opacity: v > 0 ? 1 : 0 };
  });
  const knobStyle = usePhaseStyle(phase, rest, (v) => {
    "worklet";
    return { transform: [{ translateX: kf(v, [[0, 0], [K.s22, 1]], KNOB_EASE) * 106 * (rtl ? -1 : 1) }] };
  });
  // The knob turning orange: an orange layer fading in over the cream one.
  const knobOrange = usePhaseStyle(phase, rest, (v) => {
    "worklet";
    return { opacity: Math.min(1, kf(v, [[0, 0], [K.s22, 1]], KNOB_EASE)) };
  });
  const darkness = usePhaseStyle(phase, rest, (v) => {
    "worklet";
    return { opacity: kf(v, [[K.s21, 0], [K.s27, 1]], LINEAR) };
  });
  // The switch's labels and the Pro diamond change colour as the knob arrives under them.
  const knobArrived = usePhaseStyle(phase, rest, (v) => {
    "worklet";
    return { opacity: kf(v, [[K.s17, 0], [K.s21, 1]], LINEAR) };
  });
  const gem3 = usePhaseStyle(phase, rest, (v) => {
    "worklet";
    const p = kf(v, [[K.s19, 0], [K.s24, 1]], LINEAR);
    return { opacity: 1 - p, transform: [{ scale: 1 + 0.15 * p }] };
  });
  const gem5 = usePhaseStyle(phase, rest, (v) => {
    "worklet";
    return {
      opacity: kf(v, [[K.s20, 0], [K.s26, 1]], LINEAR),
      transform: [
        { translateY: kf(v, [[K.s20, 10], [K.s26, -14], [K.s32, 0]], EASE_OUT) },
        { scale: kf(v, [[K.s20, 0.7], [K.s26, 1.12], [K.s32, 1]], EASE_OUT) },
      ],
    };
  });
  const flash = usePhaseStyle(phase, rest, (v) => {
    "worklet";
    return {
      opacity: kf(v, [[K.s19, 0], [K.s23, 1], [K.s40, 0]], EASE_OUT),
      transform: [{ scale: kf(v, [[K.s19, 0.3], [K.s23, 1], [K.s40, 2.2]], EASE_OUT) }],
    };
  });
  const ring = usePhaseStyle(phase, rest, (v) => {
    "worklet";
    return {
      opacity: kf(v, [[K.s21, 0], [K.s24, 0.8], [K.s46, 0]], EASE_OUT),
      transform: [{ scale: kf(v, [[K.s21, 0.4], [K.s46, 3.4]], EASE_OUT) }],
    };
  });

  const sizes = usePaywallSizes();
  const gemW = sizes.gemWidth;
  const gemH = sizes.gemHeight;
  const gemTop = insets.top + GEM_TOP;
  const gemCenter = gemTop + gemH * 0.62;
  const circleId = useSvgId("dark");
  const flashId = useSvgId("flash");

  const side = (isPro: boolean) => (
    <PlanSide
      rowHeight={sizes.rowHeight}
      pro={isPro}
      phase={phase}
      rest={rest}
      plansState={plansState}
      choice={choice}
      onChoose={setChoice}
      onBuy={() => void handleBuy()}
      onFree={handleFree}
      onRetry={() => {
        setPlansState({ status: "loading" });
        loadPlans();
      }}
      busy={busy}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: ONB.paper, overflow: "hidden" }}>
      {/* Free, on the paper. */}
      <View style={{ position: "absolute", left: 0, right: 0, top: insets.top + sizes.contentTop, bottom: 0 }} pointerEvents={pro ? "none" : "auto"}>
        {side(false)}
      </View>

      {/* The dark spreading out of the gem. */}
      <Animated.View pointerEvents="none" style={[{ position: "absolute", left: "50%", top: gemCenter - 140, width: 280, height: 280, marginLeft: -140 }, circleStyle]}>
        <Svg width={280} height={280}>
          <Defs>
            <RadialGradient id={circleId} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#6A3A1C" />
              <Stop offset="0.36" stopColor="#3A2416" />
              <Stop offset="0.68" stopColor="#221810" />
              <Stop offset="1" stopColor="#15100C" />
            </RadialGradient>
          </Defs>
          <Circle cx={140} cy={140} r={140} fill={`url(#${circleId})`} />
        </Svg>
      </Animated.View>

      {/* Pro, on the dark. */}
      <Animated.View style={[{ position: "absolute", left: 0, right: 0, top: insets.top + sizes.contentTop, bottom: 0 }, proSide]} pointerEvents={pro ? "auto" : "none"}>
        {side(true)}
      </Animated.View>

      {/* Close and Restore, the switch and the gem — shared by both sides. */}
      <View style={{ position: "absolute", left: 0, right: 0, top: insets.top + BAR_TOP }}>
        <View style={[{ marginHorizontal: 20, height: 40, alignItems: "center", justifyContent: "space-between" }, rowDirection(rtl)]}>
          <AnimatedPressable onPress={handleFree} disabled={busy} scaleTo={0.92} hitSlop={8} accessibilityRole="button" accessibilityLabel={copy.close} style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" }}>
            <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: 20, backgroundColor: "#EFE3D4" }} />
            <Animated.View style={[{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: 20, backgroundColor: "#3A3029" }, darkness]} />
            {/* Ink on paper, cream on the dark — crossfading with the background. */}
            <View style={{ zIndex: 1 }}>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={ONB.ink} strokeWidth={2.2} strokeLinecap="round">
                <Path d="M6 6l12 12M18 6L6 18" />
              </Svg>
              <Animated.View style={[{ position: "absolute", top: 0, left: 0 }, darkness]}>
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={ONB.paper} strokeWidth={2.2} strokeLinecap="round">
                  <Path d="M6 6l12 12M18 6L6 18" />
                </Svg>
              </Animated.View>
            </View>
          </AnimatedPressable>
          <AnimatedPressable onPress={() => void handleRestore()} disabled={busy} hitSlop={8} accessibilityRole="button">
            <FadeText text={copy.restore} from={ONB.muted} to="#BFB2A7" over={darkness} family="SpaceGrotesk-SemiBold" />
          </AnimatedPressable>
        </View>

        <View style={[{ alignSelf: "center", marginTop: SWITCH_GAP, width: 220, height: 44, borderRadius: 22, padding: 4 }, rowDirection(rtl)]} accessibilityRole="tablist">
          <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: 22, backgroundColor: "#EFE3D4" }} />
          <Animated.View style={[{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: 22, backgroundColor: "#3A3029" }, darkness]} />
          <Animated.View
            style={[
              { position: "absolute", top: 4, width: 106, height: 36, borderRadius: 18, backgroundColor: ONB.card, ...(rtl ? { right: 4 } : { left: 4 }) },
              shadow("0 2px 8px rgba(0,0,0,0.15)", 3, "#000000"),
              knobStyle,
            ]}
          >
            <Animated.View style={[{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: 18, backgroundColor: ONB.orange }, knobOrange]} />
          </Animated.View>
          {/* Above the knob's shadow: Android would otherwise draw the knob over the labels. */}
          <AnimatedPressable onPress={() => flip(false)} accessibilityRole="tab" accessibilityState={{ selected: !pro }} style={[{ flex: 1, alignItems: "center", justifyContent: "center" }, ABOVE_SHADOW]}>
            <FadeText text={copy.free} from={ONB.ink} to="#8C8077" over={knobArrived} />
          </AnimatedPressable>
          <AnimatedPressable
            onPress={() => flip(true)}
            accessibilityRole="tab"
            accessibilityState={{ selected: pro }}
            style={[{ flex: 1, alignItems: "center", justifyContent: "center", gap: 5 }, rowDirection(rtl), ABOVE_SHADOW]}
          >
            <View style={{ width: 7, height: 7, borderRadius: 1, backgroundColor: ONB.orange, transform: [{ rotate: "45deg" }] }}>
              <Animated.View style={[{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: 1, backgroundColor: "#FFFFFF" }, knobArrived]} />
            </View>
            <FadeText text={copy.pro} from={ONB.muted} to="#FFFFFF" over={knobArrived} />
          </AnimatedPressable>
        </View>
      </View>

      <View pointerEvents="none" style={{ position: "absolute", left: "50%", marginLeft: -gemW / 2, top: gemTop, width: gemW, height: gemH }}>
        <Animated.View style={[{ position: "absolute", left: gemW / 2 - 95, top: gemH * 0.62 - 95, width: 190, height: 190 }, flash]}>
          <Svg width={190} height={190}>
            <Defs>
              <RadialGradient id={flashId} cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor="#FFF2C8" />
                <Stop offset="0.4" stopColor="#FFC86E" stopOpacity={0.55} />
                <Stop offset="0.7" stopColor="#FFC86E" stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect width={190} height={190} fill={`url(#${flashId})`} />
          </Svg>
        </Animated.View>
        <Animated.View style={[{ position: "absolute", left: gemW / 2 - 45, top: gemH * 0.62 - 45, width: 90, height: 90, borderRadius: 45, borderWidth: 3, borderColor: "#FFC56B" }, ring]} />
        <Animated.View style={[{ position: "absolute", top: 0, left: 0 }, gem3]}>
          <GemStill level={3} width={gemW} still={!focused} />
        </Animated.View>
        {/* The flame gem animates its flame every frame: only there on the Pro side (and while flipping back). */}
        {pro || moving ? (
          <Animated.View style={[{ position: "absolute", top: 0, left: 0 }, gem5]}>
            <GemStill level={5} width={gemW} still={!focused} />
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}
