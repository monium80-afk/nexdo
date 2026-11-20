import { useAuth } from "@clerk/expo";
import { Redirect } from "expo-router";
import { useEffect, useState } from "react";

import { useAiLocked } from "@/hooks/useAiLocked";
import { isPurchasesEnabled } from "@/lib/purchases";
import { useMagicMicStore } from "@/store/useMagicMicStore";
import { useSubscriptionStore } from "@/store/useSubscriptionStore";

/** How long a cold start waits for RevenueCat before deciding Free or Pro. */
const PLAN_WAIT_MS = 3_000;

/**
 * A link to /mic — the home screen widget's mic (2026-11-19). Magic mic is a
 * layer over the tabs (components/MagicMicOverlay.tsx), so this opens it and
 * goes to Today underneath. On Free it opens the plans instead, like the tab
 * bar's padlocked mic.
 */
export default function Mic() {
  const { isLoaded, isSignedIn } = useAuth();
  const locked = useAiLocked();
  // Opened from the widget, the app may have only just started: Pro isn't
  // known until RevenueCat answers, so a Pro user isn't sent to the plans.
  const planKnown = useSubscriptionStore((state) => state.customerInfo !== null) || !isPurchasesEnabled;
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), PLAN_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);
  const ready = planKnown || waited;

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !ready || locked) return;
    const mic = useMagicMicStore.getState();
    if (!mic.isOpen) mic.open("index");
  }, [isLoaded, isSignedIn, ready, locked]);

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/onboarding" />;
  if (!ready) return null;
  if (locked) return <Redirect href={{ pathname: "/paywall", params: { reason: "live" } }} />;
  return <Redirect href="/(tabs)" />;
}
