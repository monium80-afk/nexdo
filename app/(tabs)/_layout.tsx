import { useAuth, useUser } from "@clerk/expo";
import { BlurTargetView } from "expo-blur";
import { Redirect, Tabs } from "expo-router";
import { useEffect, useRef, type ComponentRef } from "react";
import { View } from "react-native";

import { AddTaskSheetHost } from "@/components/addSheet/AddTaskSheet";
import { BlurBackdropHost } from "@/components/BlurBackdropHost";
import { MagicMicOverlay } from "@/components/MagicMicOverlay";
import { TabBar } from "@/components/TabBar";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { posthog } from "@/lib/posthog";

export default function TabsLayout() {
  const t = useTranslation();
  const colors = useColors();
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const blurTarget = useRef<ComponentRef<typeof View>>(null);
  // Account setup (useAuthSync, useNotifications) lives in the root layout,
  // so screens opened by a link get it too.

  // Identify the user with PostHog when they are signed in (catches both
  // fresh logins and returning sessions that are already authenticated).
  useEffect(() => {
    if (user) {
      posthog.identify(user.id, {
        $set: {
          first_name: user.firstName ?? null,
          last_name: user.lastName ?? null,
          created_at: user.createdAt?.toISOString() ?? null,
        },
        $set_once: {
          account_created_at: user.createdAt?.toISOString() ?? null,
        },
      })
    }
  }, [user])

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/onboarding" />;

  return (
    <View className="flex-1">
      {/* What Magic mic blurs: the tabs and the tab bar, which stay mounted
          and in place underneath it (Android blurs only what's in here). */}
      <BlurTargetView ref={blurTarget} style={{ flex: 1 }}>
        <Tabs
          // No page transition and no entrance: the new tab is simply there — the
          // user's call (2026-10-08). The page colour stays behind the screens so
          // nothing grey flashes.
          screenOptions={{ headerShown: false, animation: "none", sceneStyle: { backgroundColor: colors.cream[100] } }}
          tabBar={(props) => <TabBar {...props} />}
        >
          <Tabs.Screen name="index" options={{ title: t.tabs.next }} />
          <Tabs.Screen name="tasks" options={{ title: t.tabs.tasks }} />
          <Tabs.Screen name="calendar" options={{ title: t.tabs.calendar }} />
          <Tabs.Screen name="settings" options={{ title: t.tabs.settings }} />
        </Tabs>
      </BlurTargetView>
      {/* The page blurred behind Break it down's sheets. */}
      <BlurBackdropHost blurTarget={blurTarget} />
      <MagicMicOverlay blurTarget={blurTarget} />
      {/* Add task: a sheet over the blurred tabs (components/addSheet). */}
      <AddTaskSheetHost blurTarget={blurTarget} />
    </View>
  );
}
