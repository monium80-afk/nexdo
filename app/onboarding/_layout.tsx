import { useAuth } from "@clerk/expo";
import { Redirect, Stack, usePathname } from "expo-router";
import { useEffect } from "react";

import { posthog } from "@/lib/posthog";

/**
 * The onboarding (nexdo-onboarding-final): 14 screens, in this order —
 * index (01 hook) → problem → picks → pains → load → mic → dump → founder →
 * expect → nudge → promise → paywall → save ⇄ log-in. Signed-out only: once
 * an account exists (13 or 14), the app takes over. No page transitions, as
 * everywhere in the app (2026-10-08).
 */
const STEPS = ["index", "problem", "picks", "pains", "load", "mic", "dump", "founder", "expect", "nudge", "promise", "paywall", "save", "log-in"];

export default function OnboardingLayout() {
  const { isLoaded, isSignedIn } = useAuth();
  // One event per screen reached, numbered, so PostHog can show where people
  // leave the onboarding (a funnel over "onboarding_step_viewed" by step).
  const pathname = usePathname();
  useEffect(() => {
    const name = pathname.split("/").filter(Boolean)[1] ?? "index";
    const step = STEPS.indexOf(name);
    if (step >= 0) posthog.capture("onboarding_step_viewed", { step: step + 1, screen: name });
  }, [pathname]);

  if (!isLoaded) return null;
  if (isSignedIn) return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false, animation: "none" }} />;
}
