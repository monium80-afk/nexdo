import { Feather } from "@expo/vector-icons";
import { Tabs, useRouter } from "expo-router";
import type { ComponentProps } from "react";
import { Platform, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import type { Translations } from "@/lib/i18n";
import { useSettingsStore } from "@/store/useSettingsStore";
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

// A plus that opens the Add Task form, or — with "Talk instead of type" on in
// Settings — a microphone that opens Live voice. Same button either way.
function AddTabButton() {
  const colors = useColors();
  const router = useRouter();
  const t = useTranslation();
  const voice = useSettingsStore((state) => state.voiceAddButton);

  return (
    <AnimatedPressable
      onPress={() => router.push(voice ? "/live-voice" : "/add")}
      scaleTo={0.92}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={voice ? t.live.open : t.tabs.addTask}
      className="items-center"
    >
      <View
        style={Platform.select({
          ios: {
            shadowColor: colors.orange[600],
            shadowOffset: { width: 0, height: 3 },
            shadowOpacity: 0.3,
            shadowRadius: 8,
          },
          android: { elevation: 3 },
        })}
        className="h-[36px] w-[36px] items-center justify-center rounded-full bg-orange-500"
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
  edgeClassName,
}: {
  routeName: TabRouteName;
  focused: boolean;
  onPress: () => void;
  /** Extra padding nudging the icon away from the centered Add button. */
  edgeClassName?: string;
}) {
  const colors = useColors();
  const t = useTranslation();
  // Orange is kept for the Add button and the small dot under the active tab,
  // so the selected icon doesn't compete with Add for attention.
  const tintColor = focused ? colors.ink.charcoal : colors.ink.charcoalMuted;

  return (
    <AnimatedPressable
      onPress={onPress}
      scaleTo={0.88}
      accessibilityRole="tab"
      accessibilityLabel={t.tabs[TAB_LABEL_KEYS[routeName]]}
      accessibilityState={{ selected: focused }}
      // Full bar height, so the whole column is the touch target, not just the icon.
      className={`flex-1 items-center justify-center self-stretch ${edgeClassName ?? ""}`}
    >
      <View>
        <TabIcon routeName={routeName} color={tintColor} size={22} />
        {routeName === "tasks" && <PendingTaskBadge />}
        {/* Out of flow so every icon sits on the same line as the Add button. */}
        {focused && (
          <View className="absolute left-0 right-0 top-[28px] items-center">
            <View className="h-[4px] w-[4px] rounded-full bg-orange-500" />
          </View>
        )}
      </View>
    </AnimatedPressable>
  );
}

// Everything, the Add button included, sits inside the bar on one centre line
// — nothing pokes above it — so the height React Navigation measures here is
// the height the bar really takes, and screen content (e.g. the AI chat input)
// is padded clear of it.
const BAR_HEIGHT = 58;

export function TabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();

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
        edgeClassName={edgeClassName}
      />
    );
  };

  // The two routes flanking the centered Add button (tasks, ai-chat) sit
  // right up against it — nudge each away from center so the spacing
  // across all five slots feels even instead of tasks/ai-chat reading as
  // crowded against the middle.
  const [first, second, third, fourth] = state.routes;

  // One charcoal fill with one hairline at the very top, running down under
  // the system navigation area so the bar reads as a single piece.
  return (
    <View
      className="border-t border-white/10 bg-charcoal-900"
      style={{ height: BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom }}
    >
      <View className="flex-1 flex-row items-center px-4">
        {renderRoute(first, 0)}
        {renderRoute(second, 1, "pr-3")}
        <AddTabButton />
        {renderRoute(third, 2, "pl-3")}
        {renderRoute(fourth, 3)}
      </View>
    </View>
  );
}
