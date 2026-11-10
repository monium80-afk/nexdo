import { Feather } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useCallback, useEffect, useState, type ComponentProps } from "react";
import { Platform, View } from "react-native";
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { AppTour, type TourAnchor } from "@/components/AppTour";
import { AppIcon, type AppIconName } from "@/components/icons/AppIcons";
import { FOCUS_FINISH } from "@/constants/focusFinish";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { useAiLocked } from "@/hooks/useAiLocked";
import type { Translations } from "@/lib/i18n";
import { openPaywall } from "@/lib/paywall";
import { useFocusPageStore } from "@/store/useFocusPageStore";
import { useMagicMicStore } from "@/store/useMagicMicStore";

// Derived from Tabs itself so this always matches whatever prop shape expo-router expects.
type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

// Magic mic isn't a tab route — it's a layer over the tabs (MagicMicOverlay)
// — so its button is a fixed extra slot, in the middle of the bar. (Add Task
// moved from the bar to the top of Today on 2026-11-02.)
type TabRouteName = "index" | "tasks" | "calendar" | "settings";

const TAB_LABEL_KEYS: Record<TabRouteName, keyof Translations["tabs"]> = {
  index: "next",
  tasks: "tasks",
  calendar: "calendar",
  settings: "settings",
};

// The redesign's icons (Final-Today.html): Today is a lightning bolt.
const TAB_ICONS: Record<TabRouteName, AppIconName> = {
  index: "bolt",
  tasks: "list",
  calendar: "calendar",
  settings: "sliders",
};

// The mic's orange disc: a soft ring of its own colour, and a glow under it.
const MIC_GLOW = { boxShadow: "0 0 0 5px rgba(242, 106, 46, 0.18), 0 5px 13px rgba(242, 106, 46, 0.45)" };

// Magic mic, in the middle of the bar (the user's call, 2026-11-02): the
// redesign's orange disc. It's part of Nexdo Pro: on Free it wears a padlock
// and opens the paywall instead.
function MagicMicButton({
  currentTab,
  onAnchor,
}: {
  /** The tab in view: the mic opens over it (components/MagicMicOverlay.tsx). */
  currentTab: string | undefined;
  /** Its centre along the bar, for the first-run tour to point at. */
  onAnchor: (x: number) => void;
}) {
  const colors = useColors();
  const t = useTranslation();
  const locked = useAiLocked();
  // While the mic is open the overlay's coin is this icon, risen out of its
  // slot — so the slot is left empty until it sinks back in.
  const micOpen = useMagicMicStore((state) => state.isOpen);

  const handlePress = () => {
    if (locked) {
      openPaywall("live");
      return;
    }
    useMagicMicStore.getState().open(currentTab);
  };

  return (
    <AnimatedPressable
      onPress={handlePress}
      disabled={micOpen}
      scaleTo={0.92}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={locked ? t.live.openLocked : t.live.open}
      onLayout={(event) => {
        const { x, width } = event.nativeEvent.layout;
        onAnchor(x + width / 2);
      }}
      // A slot as wide as each tab's, the whole of it the touch target.
      className="flex-1 items-center justify-center self-stretch"
    >
      <View
        className={`items-center justify-center rounded-full bg-accent ${micOpen ? "opacity-0" : ""}`}
        style={[{ width: MIC_DISC, height: MIC_DISC }, MIC_GLOW]}
      >
        <AppIcon name="mic" size={21} strokeWidth={2} color="#FFFFFF" />
        {/* The padlock: ringed in the bar's colour, so it reads as sitting on
            the disc rather than cut into it. */}
        {locked ? (
          <View className="absolute -right-[2px] -top-[2px] h-[20px] w-[20px] items-center justify-center rounded-full border-2 border-ink bg-charcoal-600">
            <Feather name="lock" size={10} color={colors.ink.charcoal} />
          </View>
        ) : null}
      </View>
    </AnimatedPressable>
  );
}

function StandardTabButton({
  routeName,
  focused,
  onPress,
  onAnchor,
}: {
  routeName: TabRouteName;
  focused: boolean;
  onPress: () => void;
  /** The icon's centre along the bar, for the first-run tour to point at. */
  onAnchor: (x: number) => void;
}) {
  const t = useTranslation();
  const reduceMotion = useReducedMotion();
  // Orange is kept for the mic and the small dot under the active tab, so the
  // selected icon doesn't compete with the mic for attention.
  const tintColor = focused ? "#FFFFFF" : IDLE_ICON;

  // The Tasks icon catches each card Magic mic sends into it: a quick pop
  // that starts and ends at its normal size.
  const arrivals = useMagicMicStore((state) => (routeName === "tasks" ? state.arrivals : 0));
  const catchScale = useSharedValue(1);
  useEffect(() => {
    if (arrivals === 0 || reduceMotion) return;
    // Anim-Mic.html mzTasks: up to 130 % in peach (160 ms), back over 320.
    catchScale.set(withSequence(withTiming(1.3, { duration: 160 }), withTiming(1, { duration: 320 })));
  }, [arrivals, catchScale, reduceMotion]);
  const catchStyle = useAnimatedStyle(() => ({ transform: [{ scale: catchScale.value }] }));
  const peachStyle = useAnimatedStyle(() => ({ opacity: (catchScale.value - 1) / 0.3 }));

  return (
    <AnimatedPressable
      onPress={onPress}
      scaleTo={0.88}
      accessibilityRole="tab"
      accessibilityLabel={t.tabs[TAB_LABEL_KEYS[routeName]]}
      accessibilityState={{ selected: focused }}
      // The icon sits in the middle of its slot, so the slot's centre is the icon's.
      onLayout={(event) => {
        const { x, width } = event.nativeEvent.layout;
        onAnchor(x + width / 2);
      }}
      // Full bar height, so the whole column is the touch target, not just the icon.
      className="flex-1 items-center justify-center self-stretch"
    >
      {/* The current tab's icon lifts to make room for its dot, 6 below it
          (the mockup's icon / gap / dot column, centred in the bar). */}
      <Animated.View style={catchStyle} className="items-center gap-[5px]">
        <View>
          <AppIcon name={TAB_ICONS[routeName]} size={20} color={tintColor} />
          {routeName === "tasks" ? (
            <Animated.View pointerEvents="none" className="absolute inset-0" style={peachStyle}>
              <AppIcon name="list" size={20} color="#FFB089" />
            </Animated.View>
          ) : null}
        </View>
        {focused ? <View className="h-[4px] w-[4px] rounded-full bg-accent" /> : null}
      </Animated.View>
    </AnimatedPressable>
  );
}

// The 2026-11 redesign's bar (Final-Today.html), a size down from its 72 at
// the user's request (2026-11-03): a dark pill 60 tall, 16 in from each side,
// floating over the page. Everything, the mic included, sits on its centre
// line. Exported for Magic mic, which rises out of that line.
export const TAB_BAR_HEIGHT = 60;
const BAR_HEIGHT = TAB_BAR_HEIGHT;
const BAR_SIDE = 16;
/** The mic's orange disc. Exported for Magic mic, whose coin starts as it. */
export const MIC_DISC = 48;

/**
 * How far the bar floats above the bottom of the screen. The mockup's 20 is
 * on an iPhone, over its home indicator; on Android it sits clear of the
 * system's own buttons or gesture bar.
 */
export function tabBarBottom(bottomInset: number): number {
  return Platform.OS === "android" ? bottomInset + 12 : Math.max(20, bottomInset - 14);
}

/**
 * How much of the foot of a tab page the bar covers: it floats over the page,
 * so each tab page leaves this much room at the end of its content — a
 * scroll's bottom padding — to keep it clear of the bar.
 */
export function useTabBarHeight(): number {
  const insets = useSafeAreaInsets();
  return BAR_HEIGHT + tabBarBottom(insets.bottom);
}

// An idle tab, on the bar's ink.
const IDLE_ICON = "#9C9188";
// No shadow under the bar (the user's call, 2026-11-03).
const BAR_SHADOW = null;

export function TabBar({ state, emitter, navigateToTab }: TabBarProps) {
  const insets = useSafeAreaInsets();
  // Where each slot's icon sits along the bar, for the first-run tour.
  // (Settings isn't a stop on the tour.)
  const [anchors, setAnchors] = useState<Partial<Record<TourAnchor, number>>>({});
  const setAnchor = useCallback((slot: TourAnchor, x: number) => {
    setAnchors((current) => (current[slot] === x ? current : { ...current, [slot]: x }));
  }, []);
  // Since SDK 58 the bar is handed the tabs' routes, an emitter for tab
  // presses and navigateToTab(routeKey) — no navigation object. Tabs are
  // looked up by name, so the bar never depends on their order in the list.
  const focusedName = state.routes[state.index]?.name;
  const focusPageOpen = useFocusPageStore((store) => store.open);
  // Back from a task done in a session, the bar fades in with Today.
  const fadeInMs = useFocusPageStore((store) => store.fadeInMs);
  const routeNamed = useCallback((name: TabRouteName) => state.routes.find((route) => route.name === name), [state.routes]);
  const showTab = useCallback(
    (name: TabRouteName) => {
      const route = routeNamed(name);
      if (route) navigateToTab(route.key);
    },
    [navigateToTab, routeNamed],
  );

  const renderRoute = (routeName: TabRouteName) => {
    const route = routeNamed(routeName);
    if (!route) return null;
    const focused = focusedName === routeName;

    const onPress = () => {
      const event = emitter.emit({
        type: "tabPress",
        target: route.key,
        canPreventDefault: true,
      });

      if (!focused && !event.defaultPrevented) navigateToTab(route.key);
    };

    return (
      <StandardTabButton
        key={route.key}
        routeName={routeName}
        focused={focused}
        onPress={onPress}
        onAnchor={(x) => {
          if (routeName !== "settings") setAnchor(routeName, x);
          // Where Magic mic's cards fly from any other tab.
          if (routeName === "tasks") useMagicMicStore.getState().setTasksX(x);
        }}
      />
    );
  };

  // Five slots of equal width — Today, Tasks, the mic, Calendar, Settings —
  // so the mic sits in the middle of the screen (the user's call, 2026-11-02).

  // A dark pill floating over the foot of the page. Nothing sits behind it —
  // the tab page reaches the bottom of the screen and shows around it.
  const bottom = tabBarBottom(insets.bottom);
  // A focus session has the whole screen: no bar over it (the user's call, 2026-11-04).
  if (focusPageOpen) return null;
  return (
    <AppTour
      anchors={anchors}
      barHeight={BAR_HEIGHT + bottom}
      iconY={bottom + BAR_HEIGHT / 2}
      currentTab={focusedName}
      onShowTab={showTab}
    >
      <Animated.View
        entering={fadeInMs > 0 ? FadeIn.duration(fadeInMs).easing(FOCUS_FINISH.ease) : undefined}
        className="absolute rounded-full bg-ink"
        style={[{ left: BAR_SIDE, right: BAR_SIDE, bottom, height: BAR_HEIGHT }, BAR_SHADOW]}
      >
        <View className="flex-1 flex-row items-center px-[8px]">
          {renderRoute("index")}
          {renderRoute("tasks")}
          <MagicMicButton
            currentTab={focusedName}
            onAnchor={(x) => setAnchor("mic", x)}
          />
          {renderRoute("calendar")}
          {renderRoute("settings")}
        </View>
      </Animated.View>
    </AppTour>
  );
}
