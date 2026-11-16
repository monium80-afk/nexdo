import { useIsFocused } from "expo-router";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ComponentRef, type ReactNode } from "react";
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
import { useAiLocked } from "@/hooks/useAiLocked";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import { posthog } from "@/lib/posthog";
import { useOnboardingStore } from "@/store/useOnboardingStore";
import { useSettingsStore } from "@/store/useSettingsStore";

/** The tab bar slots the tour points at. */
export type TourAnchor = "index" | "tasks" | "mic" | "calendar";
/** A stop on the tour: a tab bar slot, or Today's + button at the top of the page. */
type TourStop = TourAnchor | "add";
type TourTab = "index" | "tasks" | "calendar" | "settings";

/** Where something sits, in window coordinates (measureInWindow). */
type TourRect = { x: number; y: number; width: number; height: number };
type MeasureTarget = (done: (rect: TourRect) => void) => void;

// Today's + lives in the page, not the bar: Today hands the tour a way to
// find it on screen (app/(tabs)/index.tsx), read when that stop comes up.
let measureAddButton: MeasureTarget | null = null;
export function registerTourAddButton(measure: MeasureTarget | null) {
  measureAddButton = measure;
}

// Today, then how to add a task (most of what a Free account does by hand),
// then left to right along the bar, one or two sentences each. Settings is
// left out on purpose: it explains itself.
const STEPS: { anchor: TourStop; tab: TourTab }[] = [
  { anchor: "index", tab: "index" },
  { anchor: "add", tab: "index" },
  { anchor: "tasks", tab: "tasks" },
  // The page behind stays on Tasks: the mic doesn't open during the tour.
  { anchor: "mic", tab: "tasks" },
  { anchor: "calendar", tab: "calendar" },
];

// A beat for the page under it to settle and be seen first.
const START_DELAY_MS = 700;
// Rings: a tab icon's, and the one round Today's 40-wide + button.
const RING = 46;
const ADD_RING = 54;
// Today has a moment to show (the tour may have just switched to it) before its + is found.
const ADD_MEASURE_DELAY_MS = 150;
const TAIL = 14;
// Between the card and the ring it points at.
const CARD_GAP = 14;
const TAIL_STYLE = {
  position: "absolute",
  width: TAIL,
  height: TAIL,
  backgroundColor: colors.cream[50],
  transform: [{ rotate: "45deg" }],
} as const;
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
  micRing,
  currentTab,
  onShowTab,
  children,
}: {
  /** Each slot's icon centre, from the left edge of the screen. */
  anchors: Partial<Record<TourAnchor, number>>;
  /** The bar's full height, the phone's navigation area included. */
  barHeight: number;
  /** The icons' centre line, from the bottom of the screen. */
  iconY: number;
  /** The ring around the mic: wider than the others, to clear its orange disc. */
  micRing: number;
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
  const micLocked = useAiLocked();
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
  const copy = current ? stepCopy(t, current.anchor, micLocked) : null;
  const last = step === STEPS.length - 1;

  // The + stop: found on screen once Today is showing, relative to this
  // overlay (which covers the screen, but measuring both keeps it exact).
  // Kept with the stop it was measured for, so a later visit (the tour replayed) measures afresh.
  const overlay = useRef<ComponentRef<typeof View>>(null);
  const [found, setFound] = useState<{ step: number; rect: TourRect } | null>(null);
  const onAddStop = current?.anchor === "add";
  useEffect(() => {
    if (!onAddStop || step === null) return;
    const timer = setTimeout(() => {
      measureAddButton?.((rect) =>
        overlay.current?.measureInWindow((x, y) => setFound({ step, rect: { ...rect, x: rect.x - x, y: rect.y - y } })),
      );
    }, ADD_MEASURE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [onAddStop, step]);
  const addRect = onAddStop && found?.step === step ? found.rect : null;

  // Where the ring and the card's tail go: a slot on the bar (the card above
  // it), or the + at the top of Today (the card under it).
  const bar = current && current.anchor !== "add" ? current.anchor : null;
  const barX = bar ? anchors[bar] : undefined;
  const ringSize = bar === "mic" ? micRing : RING;
  const top = addRect ? { x: addRect.x + addRect.width / 2, y: addRect.y + addRect.height / 2 } : null;
  // The + stop waits for its button to be found, rather than pointing at nothing.
  const showCard = current && copy && (!onAddStop || top);

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

      {/* Measured against for the + stop; never in the way. */}
      <View ref={overlay} collapsable={false} pointerEvents="none" style={StyleSheet.absoluteFill} />

      {/* Anywhere outside the card moves the tour on, the bar included. */}
      {current ? <Pressable style={StyleSheet.absoluteFill} onPress={advance} accessible={false} /> : null}

      {/* One stop: its ring, its card and the card's tail, fading in together. */}
      {showCard ? (
        <Animated.View
          key={`stop-${step}`}
          entering={reduceMotion ? undefined : FadeIn.duration(MOTION.duration.screen)}
          exiting={reduceMotion ? undefined : FadeOut.duration(MOTION.duration.standard)}
          pointerEvents="box-none"
          style={StyleSheet.absoluteFill}
          accessibilityViewIsModal
        >
          {barX !== undefined ? <Spotlight x={barX} bottom={iconY} size={ringSize} /> : null}
          {top ? <Spotlight x={top.x} top={top.y} size={ADD_RING} /> : null}

          <View
            className="card card--cream-elevated absolute rounded-[24px] px-[18px] pb-4 pt-[18px]"
            style={top ? { left: 16, right: 16, top: top.y + ADD_RING / 2 + CARD_GAP } : { left: 16, right: 16, bottom: barHeight + CARD_GAP }}
          >
            <View
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
            </View>

            <View className="mt-4 flex-row items-center gap-4">
              <StepDots index={step ?? 0} total={STEPS.length} />
              <View className="flex-1" />
              {last ? null : <TextButton label={t.tour.skip} onPress={() => finish(false)} />}
              <PrimaryButton label={last ? t.tour.done : t.tour.next} onPress={advance} />
            </View>
          </View>

          {/* The card's tail, over its edge: down at a bar slot, or up at the +. */}
          {barX !== undefined ? (
            <View pointerEvents="none" style={[TAIL_STYLE, { left: barX - TAIL / 2, bottom: barHeight + CARD_GAP - TAIL / 2, borderBottomRightRadius: 3 }]} />
          ) : null}
          {top ? (
            <View pointerEvents="none" style={[TAIL_STYLE, { left: top.x - TAIL / 2, top: top.y + ADD_RING / 2 + CARD_GAP - TAIL / 2, borderTopLeftRadius: 3 }]} />
          ) : null}
        </Animated.View>
      ) : null}
    </>
  );
}

function isTourTab(tab: string | undefined): tab is TourTab {
  return tab === "index" || tab === "tasks" || tab === "calendar" || tab === "settings";
}

function stepCopy(t: ReturnType<typeof useTranslation>, anchor: TourStop, micLocked: boolean) {
  switch (anchor) {
    case "index":
      return t.tour.steps.next;
    case "add":
      return t.tour.steps.add;
    case "tasks":
      return t.tour.steps.tasks;
    case "mic":
      return micLocked ? t.tour.steps.voiceLocked : t.tour.steps.voice;
    case "calendar":
      return t.tour.steps.calendar;
  }
}

/**
 * A lit ring around the slot being described, with a soft ripple going out
 * from it. Mounted fresh for each stop (keyed by step), so where it sits is a
 * plain style — only the ripple, which starts and ends invisible, animates.
 */
function Spotlight({ x, top, bottom, size }: { x: number; size: number } & ({ top: number; bottom?: never } | { bottom: number; top?: never })) {
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

  // Centred on (x, top) or (x, bottom): from the top of the screen, or up from its foot.
  const box = {
    position: "absolute",
    left: x - size / 2,
    ...(top !== undefined ? { top: top - size / 2 } : { bottom: (bottom ?? 0) - size / 2 }),
    width: size,
    height: size,
    borderRadius: size / 2,
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
