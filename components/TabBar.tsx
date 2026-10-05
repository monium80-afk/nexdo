import { Feather } from "@expo/vector-icons";
import { Tabs, useRouter } from "expo-router";
import { useCallback, useRef, useState, type ComponentProps } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { AppTour, type TourAnchor } from "@/components/AppTour";
import { gradients } from "@/constants/theme";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import type { Translations } from "@/lib/i18n";
import { openPaywall } from "@/lib/paywall";
import { isPurchasesEnabled } from "@/lib/purchases";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useIsPro } from "@/store/useSubscriptionStore";
import { useTaskStore } from "@/store/useTaskStore";

// Derived from Tabs itself so this always matches whatever prop shape expo-router expects.
type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

// "add" isn't a tab route — it's a top-level modal (see app/add.tsx) so it
// can slide up like a card instead of being limited to bottom-tabs' own
// fade/shift/none transitions. The Add button below is rendered as a fixed
// extra slot between the real tab routes, not one of them.
type TabRouteName = "index" | "tasks" | "ai-chat" | "settings";

const TAB_LABEL_KEYS: Record<TabRouteName, keyof Translations["tabs"]> = {
  index: "next",
  tasks: "tasks",
  "ai-chat": "inbox",
  settings: "settings",
};

function TabIcon({
  routeName,
  color,
  size,
}: {
  routeName: TabRouteName;
  color: string;
  size: number;
}) {
  switch (routeName) {
    case "index":
      return <Feather name="zap" size={size} color={color} />;
    case "tasks":
      return <Feather name="clipboard" size={size} color={color} />;
    case "ai-chat":
      return <Feather name="message-circle" size={size} color={color} />;
    case "settings":
      return <Feather name="settings" size={size} color={color} />;
  }
}

// A plus that opens the Add Task form, or — with "Magic mic" on in
// Settings — a microphone that opens Live voice. Same button either way.
function AddTabButton({
  onShowTasks,
  onAnchor,
}: {
  onShowTasks: () => void;
  /** Its centre along the bar, for the first-run tour to point at. */
  onAnchor: (x: number) => void;
}) {
  const colors = useColors();
  const router = useRouter();
  const t = useTranslation();
  const voice = useSettingsStore((state) => state.voiceAddButton);
  const isPro = useIsPro();

  const handlePress = () => {
    if (!voice) {
      router.push("/add");
      return;
    }
    // Live voice is part of Pro: on Free the mic opens the paywall instead.
    if (!isPro && isPurchasesEnabled) {
      openPaywall("live");
      return;
    }
    // The Tasks page goes underneath first, so when Live voice is closed it
    // slides down onto the list it has just been changing.
    onShowTasks();
    router.push("/live-voice");
  };

  return (
    <AnimatedPressable
      onPress={handlePress}
      scaleTo={0.92}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={voice ? t.live.open : t.tabs.addTask}
      onLayout={(event) => {
        const { x, width } = event.nativeEvent.layout;
        onAnchor(x + width / 2);
      }}
      className="items-center"
    >
      {/* A glowing orange coin: lit at the top, casting its light on the bar. */}
      <View
        style={gradients.accent}
        className="glow-accent h-[36px] w-[36px] items-center justify-center rounded-full bg-orange-500"
      >
        <Feather name={voice ? "mic" : "plus"} size={18} color={colors.onAccent} />
      </View>
    </AnimatedPressable>
  );
}

// The pending count — neutral so it informs without shouting, ringed in the
// bar's colour to lift it off the icon. Nothing to count, no badge. Its own
// component so only the Tasks tab subscribes to the task list, instead of
// every tab re-counting it on each task change.
function PendingTaskBadge() {
  const pendingTaskCount = useTaskStore((state) =>
    state.tasks.filter((task) => task.status === "pending").length,
  );
  if (pendingTaskCount === 0) return null;

  return (
    <View className="absolute -right-[10px] -top-[7px] h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-charcoal-900 bg-charcoal-600 px-[3px]">
      <Text className="font-grotesk-bold text-[9.5px] leading-[12px] text-ink-charcoal">
        {pendingTaskCount > 99 ? "99+" : pendingTaskCount}
      </Text>
    </View>
  );
}

function StandardTabButton({
  routeName,
  focused,
  onPress,
  onAnchor,
  edgeClassName,
}: {
  routeName: TabRouteName;
  focused: boolean;
  onPress: () => void;
  /** The icon's centre along the bar, for the first-run tour to point at. */
  onAnchor: (x: number) => void;
  /** Extra padding nudging the icon away from the centered Add button. */
  edgeClassName?: string;
}) {
  const colors = useColors();
  const t = useTranslation();
  // Orange is kept for the Add button and the small dot under the active tab,
  // so the selected icon doesn't compete with Add for attention.
  const tintColor = focused ? colors.ink.charcoal : IDLE_ICON;
  // The icon's centre is the column's place on the bar plus the icon's place
  // in the column (its edge padding moves it off-centre), each reported by
  // its own layout — passed on once both are in.
  const columnX = useRef<number | null>(null);
  const iconCenter = useRef<number | null>(null);
  const reportAnchor = () => {
    if (columnX.current !== null && iconCenter.current !== null) onAnchor(columnX.current + iconCenter.current);
  };

  return (
    <AnimatedPressable
      onPress={onPress}
      scaleTo={0.88}
      accessibilityRole="tab"
      accessibilityLabel={t.tabs[TAB_LABEL_KEYS[routeName]]}
      accessibilityState={{ selected: focused }}
      onLayout={(event) => {
        columnX.current = event.nativeEvent.layout.x;
        reportAnchor();
      }}
      // Full bar height, so the whole column is the touch target, not just the icon.
      className={`flex-1 items-center justify-center self-stretch ${edgeClassName ?? ""}`}
    >
      <View
        onLayout={(event) => {
          const { x, width } = event.nativeEvent.layout;
          iconCenter.current = x + width / 2;
          reportAnchor();
        }}
      >
        <TabIcon routeName={routeName} color={tintColor} size={22} />
        {routeName === "tasks" && <PendingTaskBadge />}
        {/* Out of flow so every icon sits on the same line as the Add button. */}
        {focused && (
          <View className="absolute left-0 right-0 top-[28px] items-center">
            <View className="h-[4px] w-[4px] rounded-full bg-orange-500" style={DOT_GLOW} />
          </View>
        )}
      </View>
    </AnimatedPressable>
  );
}

// Everything, the Add button included, sits inside the bar on one centre line
// — nothing pokes above it.
const BAR_HEIGHT = 58;

/**
 * How much of the foot of a tab page the bar covers: it floats over the page
 * (so its rounded corners show the page itself), so each tab page leaves this
 * much room at the end of its content — a scroll's bottom padding, the AI
 * chat's input — to keep it clear of the bar.
 */
export function useTabBarHeight(): number {
  const insets = useSafeAreaInsets();
  return BAR_HEIGHT + insets.bottom;
}

// An idle tab: bright enough to read as a button on the charcoal, a step
// below the active one's cream.
const IDLE_ICON = "rgba(251, 245, 234, 0.6)";
const DOT_GLOW = { boxShadow: "0 0 6px rgba(250, 130, 62, 0.9)" };
// The bar casts a soft shadow up onto the page, so it sits over it.
const BAR_SHADOW = { boxShadow: "0 -10px 24px -12px rgba(30, 16, 6, 0.35)" };

export function TabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  // Where each slot's icon sits along the bar, for the first-run tour.
  const [anchors, setAnchors] = useState<Partial<Record<TourAnchor | TabRouteName, number>>>({});
  const setAnchor = useCallback((slot: TourAnchor | TabRouteName, x: number) => {
    setAnchors((current) => (current[slot] === x ? current : { ...current, [slot]: x }));
  }, []);
  const showTab = useCallback((name: TabRouteName) => navigation.navigate(name), [navigation]);

  const renderRoute = (route: TabBarProps["state"]["routes"][number], index: number, edgeClassName?: string) => {
    const focused = state.index === index;
    const routeName = route.name as TabRouteName;

    const onPress = () => {
      const event = navigation.emit({
        type: "tabPress",
        target: route.key,
        canPreventDefault: true,
      });

      if (!focused && !event.defaultPrevented) {
        navigation.navigate(route.name);
      }
    };

    return (
      <StandardTabButton
        key={route.key}
        routeName={routeName}
        focused={focused}
        onPress={onPress}
        onAnchor={(x) => setAnchor(routeName, x)}
        edgeClassName={edgeClassName}
      />
    );
  };

  // The two routes flanking the centered Add button (tasks, ai-chat) sit
  // right up against it — nudge each away from center so the spacing
  // across all five slots feels even instead of tasks/ai-chat reading as
  // crowded against the middle.
  const [first, second, third, fourth] = state.routes;

  // One charcoal slab with rounded top corners, floating over the foot of the
  // page: flush with both sides and the bottom of the screen, and running down
  // under the system navigation area (its buttons stay above it, padded by the
  // inset) so the bar reads as a single piece. Nothing sits behind it — the
  // tab page reaches the bottom of the screen, so its corners curve away into
  // the page itself.
  return (
    <AppTour
      anchors={anchors}
      barHeight={BAR_HEIGHT + insets.bottom}
      iconY={insets.bottom + BAR_HEIGHT / 2}
      currentTab={state.routes[state.index]?.name}
      onShowTab={showTab}
    >
      <View
        className="absolute bottom-0 left-0 right-0 rounded-t-[30px] border-t border-white/10 bg-charcoal-900"
        style={[{ height: BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom }, BAR_SHADOW]}
      >
        <View className="flex-1 flex-row items-center px-4">
          {renderRoute(first, 0)}
          {renderRoute(second, 1, "pr-3")}
          <AddTabButton
            onShowTasks={() => {
              if (state.routes[state.index]?.name !== "tasks") navigation.navigate("tasks");
            }}
            onAnchor={(x) => setAnchor("add", x)}
          />
          {renderRoute(third, 2, "pl-3")}
          {renderRoute(fourth, 3)}
        </View>
      </View>
    </AppTour>
  );
}
