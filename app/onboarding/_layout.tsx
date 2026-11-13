import { useAuth } from "@clerk/expo";
import { Redirect, Stack } from "expo-router";

/**
 * The onboarding (nexdo-onboarding-final): 14 screens, in this order —
 * index (01 hook) → problem → picks → pains → load → mic → dump → founder →
 * expect → nudge → promise → paywall → save ⇄ log-in. Signed-out only: once
 * an account exists (13 or 14), the app takes over. No page transitions, as
 * everywhere in the app (2026-10-08).
 */
export default function OnboardingLayout() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  if (isSignedIn) return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false, animation: "none" }} />;
}
