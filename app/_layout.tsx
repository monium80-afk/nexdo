import { ClerkProvider } from "@clerk/expo";
import { useFonts } from "expo-font";
import { Stack, useGlobalSearchParams, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { PostHogProvider } from "posthog-react-native";
import { useEffect, useRef } from "react";
import { Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { colors } from "@/constants/theme";
import { useSessionAlarm } from "@/hooks/useSessionAlarm";
import { publishableKey, tokenCache } from "@/lib/clerk";
import { configureNotifications } from "@/lib/notifications";
import { posthog } from "@/lib/posthog";
import "../global.css";

SystemUI.setBackgroundColorAsync(colors.cream[100]);
SplashScreen.preventAutoHideAsync();
configureNotifications();

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

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

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
    <ClerkProvider publishableKey={publishableKey!} tokenCache={tokenCache}>
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
            <Stack
              // Without this, React Navigation defaults the initial route to
              // whichever screen is registered first — and "add" below,
              // being the only *explicit* Stack.Screen, was winning that
              // slot over the file-system-discovered "(tabs)" group. That
              // put the app on the Add Task modal on cold start with no
              // history underneath it, so its "x" button (router.back())
              // had nothing to go back to.
              initialRouteName="(tabs)"
              screenOptions={{
                headerShown: false,
                // Left as "none": these screens drive their own fade+rise
                // entrance for exact cross-platform timing — a native push
                // transition on top of that would double-animate. sign-in,
                // sign-up and task detail use useScreenEnterAnimation(); the
                // onboarding steps run a longer down-then-up handoff from
                // OnboardingLayout, which also needs the push held back until
                // the outgoing step has faded away.
                animation: "none",
                contentStyle: { backgroundColor: colors.cream[100] },
              }}
            >
              <Stack.Screen
                name="add"
                options={{
                  presentation: "modal",
                  animation: "slide_from_bottom",
                  // Cream, not transparent: a transparent container let the
                  // dark canvas behind show through during the slide-up.
                  contentStyle: { backgroundColor: colors.cream[50] },
                }}
              />
              {/* Live voice slides up over the Tasks page the same way. */}
              <Stack.Screen
                name="live-voice"
                options={{
                  presentation: "modal",
                  animation: "slide_from_bottom",
                  contentStyle: { backgroundColor: colors.cream[50] },
                }}
              />
            </Stack>
          </View>
        </View>
      </PostHogProvider>
    </ClerkProvider>
    </GestureHandlerRootView>
  );
}
