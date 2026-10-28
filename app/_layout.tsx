import { ClerkProvider, useAuth } from "@clerk/expo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFonts } from "expo-font";
import { Stack, useGlobalSearchParams, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { PostHogProvider } from "posthog-react-native";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { UndoToast } from "@/components/UndoToast";
import { colors } from "@/constants/theme";
import { useAuthSync } from "@/hooks/useAuthSync";
import { useNotifications } from "@/hooks/useNotifications";
import { useSessionAlarm } from "@/hooks/useSessionAlarm";
import { publishableKey, resourceCache, tokenCache } from "@/lib/clerk";
import { configureNotifications } from "@/lib/notifications";
import { posthog } from "@/lib/posthog";
import "../global.css";

SystemUI.setBackgroundColorAsync(colors.cream[100]);
SplashScreen.preventAutoHideAsync();
configureNotifications();
// The AI chat was removed (2026-10-08). Its conversation was cached on the
// phone under this key; nothing reads it any more, so it isn't left behind.
AsyncStorage.removeItem("nexdo-chat").catch(() => {});

/**
 * The tabs sit under every other screen. Before SDK 58 this was the Stack's
 * initialRouteName="(tabs)": without it, "add" — the first screen listed
 * below — became the initial route, so the app could open on Add Task with
 * nothing under it and its ✕ (router.back()) had nowhere to go. The anchor
 * also puts the tabs under a screen opened straight from a link.
 */
export const unstable_settings = { anchor: "(tabs)" };

/** The longest the splash waits for Clerk before handing over to a spinner. */
const SPLASH_MAX_MS = 6_000;

/**
 * The signed-in account's setup — API and Supabase tokens, its tasks read
 * and kept in sync, RevenueCat, reminders — for every screen, not just the
 * tabs: a link can open Magic mic, the paywall or a task straight away.
 * Nothing renders until Clerk knows who's signed in (the tabs already
 * waited for that), and this comes before the screens so its effects run
 * before theirs: a screen's first request already carries the account.
 */
function AccountSetup({ children }: { children: ReactNode }) {
  const { isLoaded } = useAuth();

  // The splash stays up until Clerk knows who's signed in, not just until the
  // fonts are in — otherwise a blank page showed in between. If Clerk takes
  // longer than this (a first launch on a bad connection), the splash goes
  // anyway and the spinner below says the app is working.
  const [splashTimedOut, setSplashTimedOut] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSplashTimedOut(true), SPLASH_MAX_MS);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (isLoaded || splashTimedOut) SplashScreen.hideAsync().catch(() => {});
  }, [isLoaded, splashTimedOut]);

  if (!isLoaded) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream[100] }}>
        <ActivityIndicator color={colors.orange[500]} />
      </View>
    );
  }
  return (
    <>
      <AccountSync />
      {children}
      {/* Over every page: "Done · Undo" after finishing or deleting a task. */}
      <UndoToast />
    </>
  );
}

function AccountSync() {
  useAuthSync();
  useNotifications();
  return null;
}

// Mobile-first app: on web, RN Web's flex containers stretch full-bleed to
// fill the browser window, which reads as a desktop site rather than the
// phone app this is. Pin the whole app to a phone-width column, centered on
// wider viewports — native iOS/Android render at device width already, so
// this is a no-op there.
const WEB_FRAME_MAX_WIDTH = 480;

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    "SpaceGrotesk-Light": require("../assets/fonts/SpaceGrotesk-Light.ttf"),
    "SpaceGrotesk-Regular": require("../assets/fonts/SpaceGrotesk-Regular.ttf"),
    "SpaceGrotesk-Medium": require("../assets/fonts/SpaceGrotesk-Medium.ttf"),
    "SpaceGrotesk-SemiBold": require("../assets/fonts/SpaceGrotesk-SemiBold.ttf"),
    "SpaceGrotesk-Bold": require("../assets/fonts/SpaceGrotesk-Bold.ttf"),
  });

  const pathname = usePathname()
  const params = useGlobalSearchParams()
  const previousPathname = useRef<string | undefined>(undefined)

  // Lives here so a session's timer rings from any screen, not just the one
  // the clock is on.
  useSessionAlarm();

  // Manual screen tracking for Expo Router
  // @see https://posthog.com/docs/libraries/react-native
  useEffect(() => {
    if (previousPathname.current !== pathname) {
      posthog.screen(pathname, {
        previous_screen: previousPathname.current ?? null,
      })
      previousPathname.current = pathname
    }
  }, [pathname, params])

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    // Needed for drag gestures, e.g. the swipeable task cards on the Next tab.
    <GestureHandlerRootView style={{ flex: 1 }}>
    <ClerkProvider publishableKey={publishableKey!} tokenCache={tokenCache} __experimental_resourceCache={resourceCache}>
      <PostHogProvider
        client={posthog}
        autocapture={{
          captureScreens: false, // Manual screen tracking with Expo Router above
          captureTouches: true,
          propsToCapture: ['testID'],
          maxElementsCaptured: 20,
        }}
      >
        <View
          style={
            Platform.OS === "web"
              ? { flex: 1, alignItems: "center", backgroundColor: colors.charcoal[900] }
              : { flex: 1, backgroundColor: colors.cream[100] }
          }
        >
          <View style={Platform.OS === "web" ? { flex: 1, width: "100%", maxWidth: WEB_FRAME_MAX_WIDTH } : { flex: 1 }}>
            <AccountSetup>
            <Stack
              // The tabs are kept underneath every screen by
              // unstable_settings.anchor (below the imports) — SDK 58's
              // replacement for initialRouteName="(tabs)".
              screenOptions={{
                headerShown: false,
                // No transition between pages, anywhere — the user's call
                // (2026-10-08): a page is simply there. The modals below
                // inherit it too.
                animation: "none",
                contentStyle: { backgroundColor: colors.cream[100] },
              }}
            >
              <Stack.Screen
                name="add"
                options={{
                  presentation: "modal",
                  // Cream, not transparent: a transparent container let the
                  // dark canvas behind show through.
                  contentStyle: { backgroundColor: colors.cream[50] },
                }}
              />
              {/* Live voice opens over the Tasks page the same way. */}
              <Stack.Screen
                name="live-voice"
                options={{
                  presentation: "modal",
                  contentStyle: { backgroundColor: colors.cream[50] },
                }}
              />
              {/* So does Settings → Send feedback / Report a problem. */}
              <Stack.Screen
                name="feedback"
                options={{
                  presentation: "modal",
                  contentStyle: { backgroundColor: colors.cream[50] },
                }}
              />
              {/* And the Nexdo Pro paywall, from wherever it's opened. */}
              <Stack.Screen
                name="paywall"
                options={{
                  presentation: "modal",
                  contentStyle: { backgroundColor: colors.cream[100] },
                }}
              />
            </Stack>
            </AccountSetup>
          </View>
        </View>
      </PostHogProvider>
    </ClerkProvider>
    </GestureHandlerRootView>
  );
}
