import { useIsFocused } from "expo-router";
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { PrimaryButton, TextButton } from "@/components/Button";
import { MOTION, colors } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import { posthog } from "@/lib/posthog";
import { isPurchasesEnabled } from "@/lib/purchases";
import { useOnboardingStore } from "@/store/useOnboardingStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useIsPro } from "@/store/useSubscriptionStore";

/** The tab bar slots the tour points at. */
export type TourAnchor = "index" | "tasks" | "mic";
type TourTab = "index" | "tasks" | "settings";

// Left to right along the bar, one sentence or two each — Settings is left
// out on purpose: it explains itself.
const STEPS: { anchor: TourAnchor; tab: TourTab }[] = [
  { anchor: "index", tab: "index" },
  { anchor: "tasks", tab: "tasks" },
  // The page behind stays on Tasks: the mic doesn't open anything during the tour.
  { anchor: "mic", tab: "tasks" },
];

// A beat for the page under it to settle and be seen first.
const START_DELAY_MS = 700;
const RING = 46;
const TAIL = 14;
// Between the card's foot and the top of the bar.
const CARD_GAP = 14;
const RING_GLOW = { boxShadow: "0 0 12px rgba(250, 130, 62, 0.75)" };

/**
 * The first-run tour: a few short cards pointing at the tab bar, one stop per
 * tab, with the page it's describing showing through the scrim behind. Shown
 * once per install (Settings → App tour plays it again). A tap anywhere moves
 * it on; Skip or the back button end it early.
 *
 * Wraps the bar itself so the scrim can sit under it and the card over it:
 * the bar stays lit, and its rounded corners still show the (dimmed) page.
 */
export function AppTour({
  anchors,
  barHeight,
  iconY,
  currentTab,
  onShowTab,
  children,
}: {
  /** Each slot's icon centre, from the left edge of the bar. */
  anchors: Partial<Record<TourAnchor, number>>;
  /** The bar's full height, the phone's navigation area included. */
  barHeight: number;
  /** The icons' centre line, from the bottom of the screen. */
  iconY: number;
  currentTab: string | undefined;
  onShowTab: (tab: TourTab) => void;
  children: ReactNode;
}) {
  const t = useTranslation();
  const rtl = useRtlText();
  const reduceMotion = useReducedMotion();
  const tourSeen = useSettingsStore((state) => state.tourSeen);
  const setTourSeen = useSettingsStore((state) => state.setTourSeen);
  // On Free the mic wears a padlock, and the tour says why.
  const isPro = useIsPro();
  const micLocked = !isPro && isPurchasesEnabled;
  const settingsHydrated = useSyncExternalStore(
    useSettingsStore.persist.onFinishHydration,
    useSettingsStore.persist.hasHydrated,
  );
  const onboardingHydrated = useSyncExternalStore(
    useOnboardingStore.persist.onFinishHydration,
    useOnboardingStore.persist.hasHydrated,
  );
  // A new account's brain-dump tasks are still on their way into the list,
  // and the paywall opens the moment they land (hooks/useAuthSync.ts). Waiting
  // for both keeps the tour from starting only to be covered by it.
  const draftsPending = useOnboardingStore((state) => state.drafts.length > 0);
  // False while anything (the paywall, Add Task) is open over the tabs.
  const focused = useIsFocused();

  const [step, setStep] = useState<number | null>(null);
  // The tab the tour started on, to go back to at the end.
  const [startTab, setStartTab] = useState<TourTab>("index");

  const ready = settingsHydrated && onboardingHydrated && !tourSeen && !draftsPending && focused;

  useEffect(() => {
    if (!ready || step !== null) return;
    const timer = setTimeout(() => {
      setStartTab(isTourTab(currentTab) ? currentTab : "index");
      setStep(0);
      onShowTab(STEPS[0].tab);
      posthog.capture("app_tour_started");
    }, START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [currentTab, onShowTab, ready, step]);

  const finish = useCallback(
    (completed: boolean) => {
      posthog.capture(completed ? "app_tour_completed" : "app_tour_skipped", { step: (step ?? 0) + 1 });
      setTourSeen(true);
      setStep(null);
      onShowTab(startTab);
    },
    [onShowTab, setTourSeen, startTab, step],
  );

  const advance = useCallback(() => {
    if (step === null) return;
    const next = step + 1;
    if (next >= STEPS.length) {
      finish(true);
      return;
    }
    setStep(next);
    onShowTab(STEPS[next].tab);
  }, [finish, onShowTab, step]);

  // Android's back button ends the tour rather than leaving the tab under it —
  // unless a screen has opened over the tabs, which gets the press instead.
  useEffect(() => {
    if (step === null || !focused) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      finish(false);
      return true;
    });
    return () => subscription.remove();
  }, [finish, focused, step]);

  const current = step === null ? null : STEPS[step];
  const anchorX = current ? anchors[current.anchor] : undefined;
  const copy = current ? stepCopy(t, current.anchor, micLocked) : null;
  const last = step === STEPS.length - 1;

  return (
    <>
      {current ? (
        <Animated.View
          pointerEvents="none"
          entering={reduceMotion ? undefined : FadeIn.duration(MOTION.duration.screen)}
          exiting={reduceMotion ? undefined : FadeOut.duration(MOTION.duration.standard)}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
        />
      ) : null}

      {children}

      {current && copy ? (
        <Animated.View
          entering={reduceMotion ? undefined : FadeIn.duration(MOTION.duration.screen)}
          exiting={reduceMotion ? undefined : FadeOut.duration(MOTION.duration.standard)}
          style={StyleSheet.absoluteFill}
          accessibilityViewIsModal
        >
          {/* Anywhere outside the card moves the tour on, the bar included. */}
          <Pressable style={StyleSheet.absoluteFill} onPress={advance} accessible={false} />

          {anchorX !== undefined ? <Spotlight key={`ring-${step}`} x={anchorX} y={iconY} /> : null}

          <View
            className="card card--cream-elevated absolute rounded-[24px] px-[18px] pb-4 pt-[18px]"
            style={{ left: 16, right: 16, bottom: barHeight + CARD_GAP }}
          >
            <Animated.View
              key={step}
              entering={reduceMotion ? undefined : FadeIn.duration(MOTION.duration.standard)}
              className="gap-1.5"
              accessible
              accessibilityLiveRegion="polite"
              accessibilityLabel={`${t.tour.stepOf((step ?? 0) + 1, STEPS.length)}. ${copy.title}. ${copy.body}`}
            >
              <Text className="font-grotesk-bold text-[17px] leading-[22px] tracking-tight text-ink-cream" style={rtl}>
                {copy.title}
              </Text>
              <Text className="font-grotesk-regular text-[14px] leading-[20px] text-ink-cream-muted" style={rtl}>
                {copy.body}
              </Text>
            </Animated.View>

            <View className="mt-4 flex-row items-center gap-4">
              <StepDots index={step ?? 0} total={STEPS.length} />
              <View className="flex-1" />
              {last ? null : <TextButton label={t.tour.skip} onPress={() => finish(false)} />}
              <PrimaryButton label={last ? t.tour.done : t.tour.next} onPress={advance} />
            </View>
          </View>

          {/* The card's tail, over its bottom edge, pointing down at the slot. */}
          {anchorX !== undefined ? (
            <Animated.View
              key={`tail-${step}`}
              pointerEvents="none"
              entering={reduceMotion ? undefined : FadeIn.duration(MOTION.duration.standard)}
              style={{
                position: "absolute",
                left: anchorX - TAIL / 2,
                bottom: barHeight + CARD_GAP - TAIL / 2,
                width: TAIL,
                height: TAIL,
                borderBottomRightRadius: 3,
                backgroundColor: colors.cream[50],
                transform: [{ rotate: "45deg" }],
              }}
            />
          ) : null}
        </Animated.View>
      ) : null}
    </>
  );
}

function isTourTab(tab: string | undefined): tab is TourTab {
  return tab === "index" || tab === "tasks" || tab === "settings";
}

function stepCopy(t: ReturnType<typeof useTranslation>, anchor: TourAnchor, micLocked: boolean) {
  switch (anchor) {
    case "index":
      return t.tour.steps.next;
    case "tasks":
      return t.tour.steps.tasks;
    case "mic":
      return micLocked ? t.tour.steps.voiceLocked : t.tour.steps.voice;
  }
}

/**
 * A lit ring around the slot being described, with a soft ripple going out
 * from it. Mounted fresh for each stop (keyed by step), so where it sits is a
 * plain style — only the ripple, which starts and ends invisible, animates.
 */
function Spotlight({ x, y }: { x: number; y: number }) {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    pulse.set(withRepeat(withTiming(1, { duration: 1500, easing: Easing.out(Easing.quad) }), -1, false));
    return () => cancelAnimation(pulse);
  }, [pulse, reduceMotion]);

  const rippleStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 0 : 0.7 * (1 - pulse.value),
    transform: [{ scale: 1 + pulse.value * 0.45 }],
  }));

  const box = {
    position: "absolute",
    left: x - RING / 2,
    bottom: y - RING / 2,
    width: RING,
    height: RING,
    borderRadius: RING / 2,
  } as const;

  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[box, { borderWidth: 2, borderColor: colors.orange[400] }, rippleStyle]}
      />
      <Animated.View
        pointerEvents="none"
        entering={reduceMotion ? undefined : FadeIn.duration(MOTION.duration.standard)}
        style={[box, { borderWidth: 2, borderColor: colors.orange[400] }, RING_GLOW]}
      />
    </>
  );
}

/** Where you are in the tour — the Next page's queue dots, smaller. */
function StepDots({ index, total }: { index: number; total: number }) {
  return (
    <View className="flex-row items-center gap-[5px]" importantForAccessibility="no-hide-descendants">
      {Array.from({ length: total }, (_, dot) => (
        <View
          key={dot}
          className={dot === index ? "h-[7px] w-[7px] rounded-full bg-orange-500" : "h-[6px] w-[6px] rounded-full bg-cream-300"}
        />
      ))}
    </View>
  );
}
