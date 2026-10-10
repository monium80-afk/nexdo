import { useAuth, useUser } from "@clerk/expo";
import { Redirect, Tabs } from "expo-router";
import { useEffect } from "react";

import { TabBar } from "@/components/TabBar";
import { useAuthSync } from "@/hooks/useAuthSync";
import { useNotifications } from "@/hooks/useNotifications";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { posthog } from "@/lib/posthog";

export default function TabsLayout() {
  const t = useTranslation();
  const colors = useColors();
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  useAuthSync();
  useNotifications();

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
    <Tabs
      // No page transition and no entrance: the new tab is simply there — the
      // user's call (2026-10-08). The page colour stays behind the screens so
      // nothing grey flashes.
      screenOptions={{ headerShown: false, animation: "none", sceneStyle: { backgroundColor: colors.cream[100] } }}
      tabBar={(props) => <TabBar {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: t.tabs.next }} />
      <Tabs.Screen name="tasks" options={{ title: t.tabs.tasks }} />
      <Tabs.Screen name="settings" options={{ title: t.tabs.settings }} />
    </Tabs>
  );
}
