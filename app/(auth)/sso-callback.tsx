import { useRouter } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";

import { useColors } from "@/hooks/useTheme";

/** Long enough for Clerk to finish the sign-in over a slow connection. */
const GIVE_UP_AFTER_MS = 8_000;

/**
 * Where Google/Apple sign-in sends the browser back to. useSSO() asks for
 * `…/--/sso-callback` by default, and on Android that link reaches the app
 * twice: once to the browser session in sign-in/sign-up, which finishes
 * signing in, and once to Expo Router, which opens it as a screen. Without
 * this file that screen was "Unmatched Route", left on top of everything.
 *
 * Nothing happens here. Once the session lands, the (auth) layout sees the
 * user signed in and redirects to the app. If it never lands (cancelled, or
 * the sign-in failed), this goes back to the screen that started it rather
 * than spinning forever; a session that arrives late still redirects from there.
 */
export default function SSOCallback() {
  const colors = useColors();
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      if (router.canGoBack()) router.back();
      else router.replace("/onboarding");
    }, GIVE_UP_AFTER_MS);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors.cream[100] }}>
      <ActivityIndicator size="large" color={colors.orange[500]} />
    </View>
  );
}
