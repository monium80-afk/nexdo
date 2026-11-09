import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { setStatusBarStyle } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode, type RefObject } from "react";
import { BackHandler, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  FadeIn,
  FadeOut,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  Keyframe,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { type FeatherIconName } from "@/components/Button";
import { GemGlow, GemMascot } from "@/components/GemMascot";
import { AppIcon } from "@/components/icons/AppIcons";
import { MicTaskCard } from "@/components/MicTaskCard";
import { MicWaves } from "@/components/MicWaves";
import { TAB_BAR_HEIGHT, tabBarBottom } from "@/components/TabBar";
import { MOTION, colors, listItemLayout } from "@/constants/theme";
import { useLiveVoice } from "@/hooks/useLiveVoice";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import { formatClock } from "@/lib/formatDuration";
import { changedTaskIds, discardSnapshots, micChanges, type MicChange } from "@/lib/magicMicChanges";
import { measureView, nextFrame } from "@/lib/measureView";
import { showPlanLimit } from "@/lib/paywall";
import { planLimitMessage } from "@/lib/planLimit";
import { useMagicMicStore, type ScreenRect, type TasksLanding } from "@/store/useMagicMicStore";
import { useTaskStore } from "@/store/useTaskStore";
import { withUndo } from "@/store/useUndoStore";
import type { Task } from "@/types/task";
import { shadow } from "@/constants/shadow";

// Magic mic, as a layer over whatever tab is open: the screen stays where it
// is, blurred, while the mic rises out of the tab bar and the tasks it
// changes appear as cards. Changes are saved as they're said (lib/liveVoice
// Tools.ts) — the screens behind just don't show them yet (useVisibleTasks).
// Done sends the cards home: into their rows on the Tasks page, or into the
// Tasks icon from any other tab. Discard puts everything back.

// The 2026-11 redesign (Final-Mic.html): the gem rises out of the tab bar's
// mic and sits low on the screen, the sound lines running through it, Undo
// on its left and Done on its right. A size down from the mockup's 180.
const GEM_W = 132;
/** The gem's diamond is 72 % of its drawing's width: the bar's disc grows into it. */
const GEM_BODY = GEM_W * 0.72;
// Where the diamond's centre sits in the drawing (100, 140 of 200 × 220).
const GEM_SVG_TOP = GEM_W / 2 - GEM_W * 0.77;
/** The glow behind the gem: the mockup's 220, a size down like the gem. */
const GLOW = 194;
// mzGem: it starts at 22 % of its size, on the mic button.
const START_SCALE = 0.22;
/** The gem's centre, above the top of the tab bar (the mockup's 63, a size down). */
const GEM_ABOVE_BAR = 44;
const WAVES_HEIGHT = 170;
/** How long the gem's rise takes to settle before anything else starts moving. */
const SETTLE_MS = 1200;
const SIDE_BUTTON = 52;
/** The Listening pill's foot, above the gem's centre. */
const PILL_ABOVE_GEM = 86;
const BLUR_INTENSITY = 45;
// Android blurs a shrunken copy of the screen; divided by 4 (expo-blur's
// default) the radius was 15, which with that copy reads as blocky. 2.4 gives
// 25, a smooth blur. iOS ignores it.
const ANDROID_BLUR_REDUCTION = 2.4;
// The page stays recognisable behind, just dimmed (the mockup's brightness 0.8).
const SCRIM_OPACITY = 0.3;
// The cards tilt a little, alternately, and float (mBob).
const TILTS = [
  { rotate: -3, x: -4, bobMs: 3600 },
  { rotate: 2.5, x: 6, bobMs: 4400 },
];

/*
 * Timings from nexdo-design-handoff/animations/Anim-Mic.html and
 * Anim-MicTasks.html (8 s loops: 1 % = 80 ms), counted from the tap:
 *   blur + dim in     7 → 15 %   (mzBg / mzDim)        delay 160, 640 ms
 *   gem rises         8 → 20 %   (mzGem, no bounce)     delay 240, 960 ms, from 22 %
 *   waves/glow/pill  17 → 23 %   (mzFade)               delay 960, 480 ms
 *   Undo / Done      20 → 25 → 28 % (mzSide)            delay 1200, 400 + 240 ms
 *   a card drops in  32 → 37 → 40 % (mzC / mzK)         400 + 240 ms
 * Done (from its tap, 74 %):
 *   gem sinks        75 → 82 %                           delay 80, 560 ms
 *   chrome out       75 → 79 %                           delay 80, 320 ms
 *   labels out       76 → 79 %                           delay 160, 240 ms
 *   blur out         76 → 86 %                           delay 160, 800 ms
 *   then (the page clear first — the user's call) each card flies:
 *     into its row   78 → 87 % (mzK1), 720 ms, the next 160 ms after
 *     into the icon  77 → 87 % (mzC1), 800 ms, the next 160 ms after
 *   a landed row's orange edge: in 160 ms, gone over 560 (mzUpd / mzNew)
 */
const ENTER_EASING = Easing.bezier(0.2, 0.8, 0.2, 1);

const T = {
  veilDelay: 160,
  veilIn: 640,
  gemDelay: 240,
  gemIn: 960,
  chromeDelay: 960,
  chromeIn: 480,
  sideDelay: 1200,
  sideUp: 400,
  sideSettle: 240,
  outDelay: 80,
  chromeOut: 320,
  labelsOutDelay: 160,
  labelsOut: 240,
  veilOutDelay: 160,
  veilOut: 800,
  coinBack: 560,
  rowFlight: 720,
  iconFlight: 800,
  vanish: 220,
  stagger: 160,
} as const;
/** When the cards take off after Done: once the blur has cleared. */
const FLY_AFTER = T.veilOutDelay + T.veilOut;

/** The status bar over each tab once the mic has gone (see useStatusBarStyle on each screen). */
const TAB_STATUS_BAR: Record<string, "light" | "dark"> = {
  index: "dark",
  tasks: "dark",
  calendar: "light",
  settings: "light",
};

type FlightKind = "row" | "edge" | "icon" | "vanish";
type Flight = {
  task: Task;
  kind: FlightKind;
  /** Where the card starts, in the overlay's coordinates. */
  from: ScreenRect;
  /** How far its centre travels, and its size when it gets there. */
  dx: number;
  dy: number;
  endScale: number;
  delay: number;
  duration: number;
  /** The card's tilt on the overlay, straightened out on the way. */
  tilt: number;
  highlighted: boolean;
};

/** A card dropping in as Magic mic makes the change it shows (mzC / mzK: 32 → 37 → 40 %). */
const cardEntering = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: -30 }, { scale: 0.85 }] },
  62.5: { opacity: 1, transform: [{ translateY: 4 }, { scale: 1.04 }], easing: ENTER_EASING },
  100: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }], easing: ENTER_EASING },
}).duration(640);

// Light text over the blurred page stays readable on any colour behind it.
const MARK_SHADOW = { textShadowColor: "rgba(0, 0, 0, 0.35)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 };
const SIDE_SHADOW = shadow("0 6px 16px rgba(0, 0, 0, 0.18)", 6, "#000000");

/**
 * A card on the overlay: tilted a little — one way, then the other — and
 * floating gently up and down (the mockup's mBob). `animate` stops the float
 * once the cards take off.
 */
function MicCardFloat({ index, animate, children }: { index: number; animate: boolean; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const tilt = TILTS[index % TILTS.length];
  const bob = useSharedValue(0);
  useEffect(() => {
    if (!animate || reduceMotion) return;
    const half = tilt.bobMs / 2;
    const ease = Easing.inOut(Easing.ease);
    bob.set(withRepeat(withSequence(withTiming(1, { duration: half, easing: ease }), withTiming(0, { duration: half, easing: ease })), -1));
    return () => cancelAnimation(bob);
  }, [animate, bob, reduceMotion, tilt.bobMs]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: -6 * bob.value }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

/** A card's own tilt on the overlay — one way, then the other (mzT1 / mzT2). */
function tiltStyle(index: number) {
  const tilt = TILTS[index % TILTS.length];
  return { transform: [{ translateX: tilt.x }, { rotate: `${tilt.rotate}deg` }] };
}

/** A pill of glass on the dark overlay. */
function GlassButton({ label, icon, onPress }: { label: string; icon?: FeatherIconName; onPress: () => void }) {
  return (
    <AnimatedPressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      className="glass h-[39px] flex-row items-center gap-1.5 rounded-full px-4"
    >
      {icon ? <Feather name={icon} size={14} color={colors.ink.charcoal} /> : null}
      <Text className="font-grotesk-semibold text-[13.5px] text-ink-charcoal">{label}</Text>
    </AnimatedPressable>
  );
}

/** One card on its way home once Done is tapped. Gone with the overlay. */
function FlyingCard({ flight }: { flight: Flight }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(
      withDelay(
        flight.delay,
        withTiming(1, {
          duration: flight.duration,
          easing: flight.kind === "vanish" ? MOTION.easing.exit : ENTER_EASING,
        }),
      ),
    );
  }, [flight, progress]);

  const { kind, dx, dy, endScale, tilt } = flight;
  const style = useAnimatedStyle(() => {
    const p = progress.value;
    // Straightens out on the way (mzT1 / mzT2).
    const rotate = `${tilt * (1 - p)}deg`;
    if (kind === "icon") {
      // Straight into the Tasks icon, shrinking to 8 % (mzC1: opacity 0.9 as it lands).
      return {
        opacity: 1 - 0.1 * p,
        transform: [{ translateX: dx * p }, { translateY: dy * p }, { scale: 1 - (1 - endScale) * p }, { rotate }],
      };
    }
    if (kind === "vanish") {
      return { opacity: 1 - p, transform: [{ translateY: 8 * p }, { scale: 1 - 0.06 * p }, { rotate: `${tilt}deg` }] };
    }
    // Into its row, sized to it (mzK1).
    return {
      opacity: kind === "edge" ? interpolate(p, [0.55, 1], [1, 0], Extrapolation.CLAMP) : 1,
      transform: [{ translateX: dx * p }, { translateY: dy * p }, { scale: 1 + (endScale - 1) * p }, { rotate }],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: "absolute", left: flight.from.x, top: flight.from.y, width: flight.from.width }, style]}
    >
      <MicTaskCard task={flight.task} highlighted={flight.highlighted} />
    </Animated.View>
  );
}

/** Mounted only while the mic is open, so the session ends with it. */
export function MagicMicOverlay({ blurTarget }: { blurTarget: RefObject<ComponentRef<typeof View> | null> }) {
  const isOpen = useMagicMicStore((state) => state.isOpen);
  return isOpen ? <MagicMic blurTarget={blurTarget} /> : null;
}

function MagicMic({ blurTarget }: { blurTarget: RefObject<ComponentRef<typeof View> | null> }) {
  const t = useTranslation();
  const rtl = useRtlText();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const windowSize = useWindowDimensions();
  const tasks = useTaskStore((state) => state.tasks);
  const toggleTaskStatus = useTaskStore((state) => state.toggleTaskStatus);
  const originTab = useMagicMicStore((state) => state.originTab);
  const { status, problem, startedAt, changes, undoable, touched, shown, level, start, stop, undo } = useLiveVoice();
  // The tasks the mic has changed, read when Discard runs (a moment after the
  // mic stops, so it includes a last sentence still being acted on).
  const touchedRef = useRef(touched);
  useEffect(() => {
    touchedRef.current = touched;
  }, [touched]);

  // The list as it was when the mic opened: what every card is measured
  // against, and what Discard goes back to.
  const [baseline] = useState(() => new Map(useTaskStore.getState().tasks.map((task) => [task.id, task])));
  // When each task last changed, so the latest change sits on top.
  const [changedAt, setChangedAt] = useState<ReadonlyMap<string, number>>(() => new Map());
  useEffect(
    () =>
      useTaskStore.subscribe((state, previous) => {
        if (state.tasks === previous.tasks) return;
        const ids = changedTaskIds(previous.tasks, state.tasks);
        if (ids.length === 0) return;
        const now = Date.now();
        setChangedAt((current) => {
          const next = new Map(current);
          for (const id of ids) next.set(id, now);
          return next;
        });
      }),
    [],
  );
  // Only what the mic did: the list also changes under it on its own (a
  // background re-read of the account rebuilds every task), and that was
  // never said.
  // Plus the tasks the user only named, so they can be seen before they're changed.
  const list = useMemo(
    () => micChanges(baseline, tasks, changedAt, touched, shown),
    [baseline, tasks, changedAt, touched, shown],
  );

  // The overlay's own size: the phone's screen, or the app's frame on the web.
  const [size, setSize] = useState({ width: windowSize.width, height: windowSize.height });
  const coinX = size.width / 2;
  const iconY = size.height - tabBarBottom(insets.bottom) - TAB_BAR_HEIGHT / 2;
  // The gem's diamond centre: just above the tab bar.
  const coinY = iconY - TAB_BAR_HEIGHT / 2 - GEM_ABOVE_BAR;
  const pillTop = coinY - PILL_ABOVE_GEM - 30;
  // The mic rises from the middle of the tab bar, where its slot always is
  // (the third of five equal slots since 2026-11-02) — not from a measured
  // position, which fell back to the old spot (70% across) when it was missing.
  const startX = coinX;

  const rootRef = useRef<ComponentRef<typeof View>>(null);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const cardRefs = useRef(new Map<string, ComponentRef<typeof View>>());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const after = useCallback((ms: number, run: () => void) => {
    timers.current.push(setTimeout(run, ms));
  }, []);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // "done" or "discard" once tapped; the mic may still be catching last words.
  const [ending, setEnding] = useState<"done" | "discard" | null>(null);
  const [flights, setFlights] = useState<Flight[] | null>(null);

  // 0 → 1: the mic rising out of the tab bar · the blur coming in · the
  // header, buttons and hint fading in after them.
  const emerge = useSharedValue(0);
  const veil = useSharedValue(0);
  const chrome = useSharedValue(0);
  // The cards have their own: on Done they stay put until they take off.
  const cardsShown = useSharedValue(0);
  // Undo / Done: 0 hidden, 1 popped to 108 %, 2 settled (mzSide).
  const side = useSharedValue(0);
  // The cards' labels, which go first on Done (mzLblOut).
  const labels = useSharedValue(1);

  useEffect(() => {
    // The dimmed page behind is still light: dark status bar icons.
    setStatusBarStyle("dark");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (reduceMotion) {
      emerge.set(1);
      veil.set(1);
      chrome.set(1);
      cardsShown.set(1);
      side.set(2);
      return;
    }
    veil.set(withDelay(T.veilDelay, withTiming(1, { duration: T.veilIn })));
    emerge.set(withDelay(T.gemDelay, withTiming(1, { duration: T.gemIn, easing: ENTER_EASING })));
    chrome.set(withDelay(T.chromeDelay, withTiming(1, { duration: T.chromeIn })));
    cardsShown.set(1);
    side.set(
      withDelay(
        T.sideDelay,
        withSequence(withTiming(1, { duration: T.sideUp }), withTiming(2, { duration: T.sideSettle })),
      ),
    );
    // Once, on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The gem has landed: only then do its own motion (bob, blink, glow) and
  // the sound lines start, so the rise and the blur have the phone to
  // themselves — all of it at once made the rise stutter on the phone.
  const [settled, setSettled] = useState(reduceMotion);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, []);

  // Tapping the mic was the request to listen — start straight away.
  useEffect(() => {
    void start();
  }, [start]);

  // Felt, not just seen: the eyes may not be on the screen while talking.
  useEffect(() => {
    if (changes > 0) Haptics.selectionAsync().catch(() => {});
  }, [changes]);

  // On Pro but out of minutes: the plans, as before.
  useEffect(() => {
    if (problem === "planLimit") showPlanLimit("live", true);
  }, [problem]);

  // Once a second while listening, for the clock.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  const isActive = status === "connecting" || status === "listening" || status === "finishing";
  const isStopped = status === "stopped" || status === "error";
  const statusLabel =
    status === "connecting" || status === "idle"
      ? t.live.connecting
      : status === "listening"
        ? t.live.listening(formatClock(startedAt === null ? 0 : Math.max(0, now - startedAt)))
        : status === "finishing"
          ? t.live.finishing
          : t.live.stopped;

  /** The overlay goes, and the screen behind shows the live list again. */
  const closeOverlay = useCallback(() => {
    setStatusBarStyle(TAB_STATUS_BAR[originTab ?? ""] ?? "light");
    useMagicMicStore.getState().close();
  }, [originTab]);

  /** Everything fades and the mic sinks back into the tab bar — no cards travel. */
  const leaveQuietly = useCallback(
    (beforeClose?: () => void) => {
      const d = (ms: number) => (reduceMotion ? 0 : ms);
      chrome.set(withTiming(0, { duration: d(T.chromeOut), easing: MOTION.easing.exit }));
      cardsShown.set(withTiming(0, { duration: d(T.veilOut * 0.7), easing: MOTION.easing.exit }));
      veil.set(withTiming(0, { duration: d(T.veilOut), easing: MOTION.easing.standard }));
      emerge.set(withTiming(0, { duration: d(T.coinBack), easing: MOTION.easing.standard }));
      after(d(T.coinBack), () => {
        beforeClose?.();
        closeOverlay();
      });
    },
    [after, cardsShown, chrome, closeOverlay, emerge, reduceMotion, veil],
  );

  /** Done: the cards travel to where their tasks now live. */
  const sendCardsHome = useCallback(
    async (entries: MicChange[]) => {
      const store = useMagicMicStore.getState();
      const [root, viewport] = await Promise.all([measureView(rootRef.current), measureView(scrollRef.current)]);
      if (!root || !viewport) {
        leaveQuietly();
        return;
      }
      // Only cards on screen in the overlay travel; the rest just appear in the list.
      const starts = await Promise.all(entries.map((entry) => measureView(cardRefs.current.get(entry.task.id) ?? null)));
      const visible = entries
        .map((entry, index) => ({ entry, rect: starts[index], index }))
        .filter((item): item is { entry: MicChange; rect: ScreenRect; index: number } =>
          !!item.rect && item.rect.y + item.rect.height > viewport.y && item.rect.y < viewport.y + viewport.height,
        )
        .map(({ entry, rect, index }) => ({
          entry,
          from: { ...rect, x: rect.x - root.x, y: rect.y - root.y },
          // As the card sits on the overlay (see MicCardFloat).
          look: { tilt: TILTS[index % TILTS.length].rotate, highlighted: entry.mark === "updated" },
        }));
      if (visible.length === 0) {
        leaveQuietly();
        return;
      }

      const travelling = visible.filter((item) => item.entry.mark !== "removed");
      const ids = travelling.map((item) => item.entry.task.id);
      const landing = originTab === "tasks" ? store.tasksLanding : null;
      const vanishing: Flight[] = visible
        .filter((item) => item.entry.mark === "removed")
        .map(({ entry, from, look }) => ({ task: entry.task, kind: "vanish", from, dx: 0, dy: 0, endScale: 1, delay: 0, duration: T.vanish, ...look }));

      // The gem sinks back into the mic, the controls and labels go, the blur
      // clears — then the cards fly (Anim-Mic 75 → 86 %).
      emerge.set(withDelay(T.outDelay, withTiming(0, { duration: T.coinBack, easing: ENTER_EASING })));
      chrome.set(withDelay(T.outDelay, withTiming(0, { duration: T.chromeOut })));
      side.set(withDelay(T.outDelay, withTiming(3, { duration: T.chromeOut })));
      labels.set(withDelay(T.labelsOutDelay, withTiming(0, { duration: T.labelsOut })));
      veil.set(withDelay(T.veilOutDelay, withTiming(0, { duration: T.veilOut })));
      await new Promise((resolve) => setTimeout(resolve, T.labelsOutDelay + T.labelsOut));
      const flyIn = FLY_AFTER - (T.labelsOutDelay + T.labelsOut);

      // Scenario A — on the Tasks page. Its rows for these tasks are laid out
      // (invisible) first, so the cards know exactly where to go; the list
      // makes room for them under the clearing blur.
      let spots: Awaited<ReturnType<TasksLanding>> | null = null;
      if (landing && ids.length > 0) {
        store.hide(ids);
        store.release();
        await nextFrame();
        await nextFrame();
        const measured = await landing(ids);
        if (measured.visibleBottom > measured.visibleTop) spots = measured;
        // Couldn't find the list on screen: into the Tasks icon instead (below).
        else store.hide([]);
      }

      if (spots) {
        const found = spots;
        const travel: Flight[] = travelling.map(({ entry, from, look }, index) => {
          const spot = found.rows[entry.task.id];
          const fromCx = from.x + from.width / 2;
          const fromCy = from.y + from.height / 2;
          const delay = flyIn + index * T.stagger;
          const onScreen =
            !!spot && spot.y >= found.visibleTop - spot.height * 0.3 && spot.y + spot.height * 0.7 <= found.visibleBottom;
          if (spot && onScreen) {
            return {
              task: entry.task,
              kind: "row",
              from,
              dx: spot.x - root.x + spot.width / 2 - fromCx,
              dy: spot.y - root.y + spot.height / 2 - fromCy,
              endScale: spot.width / from.width,
              delay,
              duration: T.rowFlight,
              ...look,
            };
          }
          // Its row is off screen (further down, or filtered out): it heads
          // for that edge of the list and fades into it.
          const below = !!spot && spot.y > found.visibleBottom;
          const edgeCy = below ? found.visibleBottom - from.height * 0.5 : found.visibleTop + from.height * 0.5;
          return {
            task: entry.task,
            kind: "edge",
            from,
            dx: 0,
            dy: edgeCy - root.y - fromCy,
            endScale: 0.94,
            delay,
            duration: T.rowFlight,
            ...look,
          };
        });
        setFlights([...vanishing, ...travel]);
        travel.forEach((flight, index) => {
          after(flight.delay + flight.duration, () => {
            useMagicMicStore.getState().land(flight.task.id);
            if (index === 0) Haptics.selectionAsync().catch(() => {});
          });
        });
        const last = travel.reduce<number>((end, flight) => Math.max(end, flight.delay + flight.duration), flyIn);
        after(last + 40, closeOverlay);
        return;
      }

      // Scenario B — any other tab: the cards are drawn into the Tasks icon,
      // and the screen comes back exactly as it was.
      const iconX = store.tasksX ?? size.width * 0.3;
      const travel: Flight[] = travelling.map(({ entry, from, look }, index) => ({
        task: entry.task,
        kind: "icon",
        from,
        dx: iconX - (from.x + from.width / 2),
        dy: iconY - (from.y + from.height / 2),
        // mzC1: down to 8 % of its size.
        endScale: 0.08,
        // The blur clears first; the cards fly over the clear page (the user's call, 2026-11-03).
        delay: flyIn + index * T.stagger,
        duration: T.iconFlight,
        ...look,
      }));
      useMagicMicStore.getState().release();
      setFlights([...vanishing, ...travel]);
      travel.forEach((flight) => {
        // The icon pops as each one lands (mzTasks, 87 %).
        after(flight.delay + flight.duration, () => {
          useMagicMicStore.getState().arrive();
          Haptics.selectionAsync().catch(() => {});
        });
      });
      const last = travel.reduce<number>((end, flight) => Math.max(end, flight.delay + flight.duration), flyIn);
      after(last + 30, closeOverlay);
    },
    [after, chrome, closeOverlay, emerge, iconY, labels, leaveQuietly, originTab, side, size.width, veil],
  );

  // Done waits for the mic to finish catching the last sentence, so every
  // card is on screen before they fly.
  useEffect(() => {
    if (ending !== "done" || isActive || flights) return;
    if (reduceMotion || list.length === 0) {
      leaveQuietly();
      return;
    }
    void sendCardsHome(list);
    // Runs once, when the mic has stopped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ending, isActive]);

  const handleDone = useCallback(() => {
    if (ending) return;
    setEnding("done");
    stop();
  }, [ending, stop]);

  const handleDiscard = useCallback(() => {
    if (ending) return;
    setEnding("discard");
    stop();
    // Put back once the mic has gone: a last sentence still being acted on
    // is put back with the rest. The toast's Undo brings it all back again.
    leaveQuietly(() => {
      const snapshots = discardSnapshots(baseline, useTaskStore.getState().tasks, touchedRef.current);
      if (snapshots.length === 0) return;
      withUndo(t.live.discarded, () => useTaskStore.getState().restoreSnapshots(snapshots));
    });
  }, [baseline, ending, leaveQuietly, stop, t]);

  // Android's back button finishes like Done: what was said is kept.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      handleDone();
      return true;
    });
    return () => subscription.remove();
  }, [handleDone]);

  const handleCoin = () => {
    if (ending) return;
    if (status === "listening") stop();
    else if (isStopped) void start();
  };

  // The blur is always at full strength and fades in and out as a whole.
  // Animating its strength from 0 showed every weak, blocky step on Android
  // (a lightly blurred shrunken copy of the screen looks pixelated).
  const blurStyle = useAnimatedStyle(() => ({ opacity: veil.value }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: SCRIM_OPACITY * veil.value }));
  const headerStyle = useAnimatedStyle(() => ({
    opacity: chrome.value,
    transform: [{ translateY: -8 * (1 - chrome.value) }],
  }));
  const contentStyle = useAnimatedStyle(() => ({ opacity: cardsShown.value }));
  // Waves, glow and the pill: a plain fade (mzFade).
  const controlsStyle = useAnimatedStyle(() => ({ opacity: chrome.value }));
  // Undo / Done (mzSide): in from 50 % to 108 % and back to 100 %; out to 60 %.
  const sideStyle = useAnimatedStyle(() => {
    const s = side.value;
    if (s <= 1) return { opacity: s, transform: [{ scale: 0.5 + 0.58 * s }] };
    if (s <= 2) return { opacity: 1, transform: [{ scale: 1.08 - 0.08 * (s - 1) }] };
    return { opacity: 3 - s, transform: [{ scale: 0.92 - 0.32 * (s - 2) }] };
  });
  const labelStyle = useAnimatedStyle(() => ({ opacity: labels.value }));
  // The gem rises out of the mic button: from its centre at 22 %, no bounce,
  // clear by the first sixth of the way (mzGem 8 → 10 → 20 %).
  const coinStyle = useAnimatedStyle(() => {
    const e = emerge.value;
    return {
      opacity: interpolate(e, [0, 1 / 6], [0, 1], Extrapolation.CLAMP),
      transform: [
        { translateX: (startX - coinX) * (1 - e) },
        { translateY: (iconY - coinY) * (1 - e) },
        { scale: START_SCALE + (1 - START_SCALE) * e },
      ],
    };
  });

  const isError = !!problem && problem !== "timeLimit" && problem !== "silence" && problem !== "planLimit";

  return (
    <View
      ref={rootRef}
      collapsable={false}
      style={StyleSheet.absoluteFill}
      accessibilityViewIsModal
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setSize((current) => (current.width === width && current.height === height ? current : { width, height }));
      }}
    >
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, blurStyle]}>
        <BlurView
          blurTarget={blurTarget}
          blurMethod="dimezisBlurViewSdk31Plus"
          blurReductionFactor={ANDROID_BLUR_REDUCTION}
          tint="default"
          intensity={BLUR_INTENSITY}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.palette.ink }, scrimStyle]}
      />

      <View style={{ flex: 1, paddingTop: insets.top }}>
        {/* No header in the redesign: just Discard, top right, once there's something to throw away. */}
        <Animated.View style={headerStyle} className="h-[52px] flex-row items-center justify-end px-[20px]">
          {list.length > 0 ? <GlassButton label={t.live.discard} onPress={handleDiscard} /> : null}
        </Animated.View>

        {/* Hidden the moment the cards take off: their flying copies take over in the same spot. */}
        <View style={{ flex: 1, opacity: flights ? 0 : 1 }}>
          <Animated.View style={[{ flex: 1 }, contentStyle]}>
            <ScrollView
              ref={scrollRef}
              contentContainerStyle={{ flexGrow: 1, paddingTop: 70, paddingBottom: 24 }}
              showsVerticalScrollIndicator={false}
            >
              {list.length === 0 ? (
                <Animated.View
                  entering={reduceMotion ? undefined : FadeIn.duration(MOTION.duration.screen)}
                  exiting={reduceMotion ? undefined : FadeOut.duration(MOTION.duration.short)}
                  className="flex-1 items-center justify-center px-10"
                >
                  <Text className="text-center font-grotesk-bold text-[19px] leading-[25px] text-white" style={MARK_SHADOW}>
                    {t.live.hintTitle}
                  </Text>
                  <Text className="mt-2 text-center font-grotesk-medium text-[13px] leading-[19px] text-paper" style={MARK_SHADOW}>
                    {t.live.hintBody}
                  </Text>
                </Animated.View>
              ) : (
                // The tasks the mic changed, each under what happened to it
                // (Final-Mic.html: "UPDATED", "JUST ADDED"), tilted and floating.
                <View className="gap-[18px] px-[20px]">
                  {list.map(({ task, mark }, index) => (
                    <Animated.View
                      key={task.id}
                      entering={reduceMotion ? undefined : cardEntering}
                      exiting={reduceMotion ? undefined : FadeOut.duration(MOTION.duration.short)}
                      layout={reduceMotion ? undefined : listItemLayout()}
                    >
                      {/* Card and label float together; only the card tilts. */}
                      <MicCardFloat index={index} animate={!flights}>
                        <Animated.Text
                          className="mb-[7px] ml-[6px] font-mono-bold text-[10px] tracking-[1.4px] text-[#FFD2BC]"
                          style={[rtl, MARK_SHADOW, labelStyle]}
                        >
                          {t.live.marks[mark].toUpperCase()}
                        </Animated.Text>
                        <View
                          ref={(node) => {
                            if (node) cardRefs.current.set(task.id, node);
                            else cardRefs.current.delete(task.id);
                          }}
                          collapsable={false}
                          pointerEvents={mark === "removed" ? "none" : "auto"}
                          className={mark === "removed" ? "opacity-50" : undefined}
                        >
                          <View style={tiltStyle(index)}>
                            {/* Opening the task would leave the mic running behind
                                another screen; ticking it off still works. */}
                            <MicTaskCard task={task} highlighted={mark === "updated"} onToggle={() => toggleTaskStatus(task.id)} />
                          </View>
                        </View>
                      </MicCardFloat>
                    </Animated.View>
                  ))}
                </View>
              )}
            </ScrollView>
          </Animated.View>
        </View>

        {/* The cards end above the Listening pill. */}
        <View style={{ height: Math.max(0, size.height - pillTop) }} />
      </View>

      {/* What went wrong, if anything, above the pill. */}
      {problem ? (
        <Animated.View
          pointerEvents="none"
          style={[{ position: "absolute", left: 24, right: 24, bottom: size.height - pillTop + 10 }, controlsStyle]}
        >
          <Text
            className={`text-center font-grotesk-semibold text-[13px] ${isError ? "text-overdue-300" : "text-white"}`}
            style={[rtl, MARK_SHADOW]}
          >
            {problem === "planLimit" ? planLimitMessage("live") : t.live.problems[problem]}
          </Text>
        </Animated.View>
      ) : null}

      {/* "Listening · 0:14" (or connecting, finishing, stopped). */}
      <Animated.View
        pointerEvents="none"
        style={[{ position: "absolute", left: 0, right: 0, top: pillTop }, controlsStyle]}
        className="items-center"
      >
        <View className="h-[30px] flex-row items-center gap-[7px] rounded-full px-[13px]" style={{ backgroundColor: "rgba(34, 28, 23, 0.85)" }}>
          {status === "listening" ? <View className="h-[9px] w-[9px] rounded-full" style={{ backgroundColor: "#E5452B" }} /> : null}
          <Text className="font-grotesk-medium text-[13px] text-paper">{statusLabel}</Text>
        </View>
      </Animated.View>

      {/* The glow behind the gem and the sound lines through it (mzGlow / mzWave). */}
      <Animated.View
        pointerEvents="none"
        style={[{ position: "absolute", left: coinX - GLOW / 2, top: coinY - GLOW / 2 }, controlsStyle]}
      >
        <GemGlow size={GLOW} animate={settled} />
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[{ position: "absolute", left: 0, top: coinY - WAVES_HEIGHT / 2, width: size.width, height: WAVES_HEIGHT }, controlsStyle]}
      >
        {settled ? <MicWaves level={level} width={size.width} height={WAVES_HEIGHT} /> : null}
      </Animated.View>

      {/* Undo on the left, Done on the right, the gem between them; each pops in on its own (mzSide). */}
      <View
        style={{ position: "absolute", left: 20, right: 20, top: coinY - SIDE_BUTTON / 2, height: SIDE_BUTTON }}
        className="flex-row items-center justify-between"
        pointerEvents="box-none"
      >
        <Animated.View style={sideStyle}>
        <AnimatedPressable
          onPress={undo}
          disabled={undoable === 0 || !!ending}
          scaleTo={0.92}
          accessibilityRole="button"
          accessibilityLabel={t.live.undo}
          className={`items-center justify-center rounded-full bg-paper-card ${undoable === 0 || ending ? "opacity-50" : ""}`}
          style={[{ width: SIDE_BUTTON, height: SIDE_BUTTON }, SIDE_SHADOW]}
        >
          <Feather name="corner-up-left" size={20} color={colors.palette.ink} />
        </AnimatedPressable>
        </Animated.View>
        <Animated.View style={sideStyle}>
        <AnimatedPressable
          onPress={handleDone}
          disabled={!!ending}
          scaleTo={0.92}
          accessibilityRole="button"
          accessibilityLabel={t.live.done}
          className="items-center justify-center rounded-full bg-ink"
          style={[{ width: SIDE_BUTTON, height: SIDE_BUTTON }, SIDE_SHADOW]}
        >
          <AppIcon name="check" size={22} strokeWidth={2.6} color="#FFFFFF" />
        </AnimatedPressable>
        </Animated.View>
      </View>

      {isStopped && !ending ? (
        <Animated.View
          entering={reduceMotion ? undefined : FadeIn.duration(MOTION.duration.standard)}
          exiting={reduceMotion ? undefined : FadeOut.duration(MOTION.duration.short)}
          pointerEvents="none"
          style={{ position: "absolute", left: 0, right: 0, top: coinY + GEM_BODY / 2 + 8 }}
        >
          <Text className="text-center font-grotesk-semibold text-[12px] text-white" style={MARK_SHADOW}>
            {t.live.talkAgain}
          </Text>
        </Animated.View>
      ) : null}

      {/* The gem: rises out of the mic button in the tab bar and sinks back
          in at the end. Tapping it stops listening, or starts again. */}
      <Animated.View
        style={[{ position: "absolute", left: coinX - GEM_W / 2, top: coinY - GEM_W / 2, width: GEM_W, height: GEM_W }, coinStyle]}
      >
        <AnimatedPressable
          onPress={handleCoin}
          disabled={!!ending || status === "connecting" || status === "finishing"}
          scaleTo={0.94}
          accessibilityRole="button"
          accessibilityLabel={status === "listening" ? t.live.stop : t.live.talkAgain}
          className="h-full w-full items-center justify-center"
        >
          <View pointerEvents="none" style={{ position: "absolute", left: 0, top: GEM_SVG_TOP }}>
            <GemMascot level={4} width={GEM_W} animate={settled} />
          </View>
        </AnimatedPressable>
      </Animated.View>

      {flights?.map((flight) => <FlyingCardSlot key={flight.task.id} flight={flight} />)}
    </View>
  );
}

/**
 * A travelling card stays until its row on the Tasks page shows (the row and
 * the card swap in one render, in the same spot); one heading elsewhere stays
 * until the overlay goes.
 */
function FlyingCardSlot({ flight }: { flight: Flight }) {
  const landed = useMagicMicStore((state) => flight.kind === "row" && !state.hiddenIds.includes(flight.task.id));
  return landed ? null : <FlyingCard flight={flight} />;
}
