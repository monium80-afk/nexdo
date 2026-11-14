import type { ErrorBoundaryProps } from "expo-router";
import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTranslation } from "@/hooks/useTranslation";
import { posthog } from "@/lib/posthog";

/**
 * What shows instead of a screen that failed to draw (app/_layout.tsx exports
 * it as the app's ErrorBoundary): a calm message and a way back, rather than
 * a closed app or a blank page. The error goes to PostHog's error tracking.
 * It can show before the fonts or the account have loaded, so it relies on
 * neither.
 */
export function CrashScreen({ error, retry }: ErrorBoundaryProps) {
  const t = useTranslation();

  useEffect(() => {
    console.error("[CrashScreen]", error);
    posthog.captureException(error, { context: "error_boundary" });
  }, [error]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#FAF1E4" }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 12 }}>
        <Text style={{ fontSize: 24, fontWeight: "700", color: "#221C17", textAlign: "center" }}>{t.crash.title}</Text>
        <Text style={{ fontSize: 16, lineHeight: 23, color: "#7A6E64", textAlign: "center" }}>{t.crash.body}</Text>
        <Pressable
          onPress={() => void retry()}
          accessibilityRole="button"
          style={({ pressed }) => ({
            marginTop: 12,
            height: 50,
            paddingHorizontal: 28,
            borderRadius: 25,
            backgroundColor: "#F26A2E",
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ fontSize: 16, fontWeight: "700", color: "#FFFFFF" }}>{t.crash.retry}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
