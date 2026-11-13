import { useAuth } from "@clerk/expo";
import { Redirect, useLocalSearchParams } from "expo-router";

import { NexdoPaywall } from "@/components/NexdoPaywall";
import { PRO_EXTRAS, type ProExtra } from "@/lib/paywall";
import { METERS, type Meter } from "@/lib/plan";

/**
 * The Nexdo Pro paywall inside the app: the same screen as onboarding's
 * (components/NexdoPaywall.tsx, since 2026-11-13). Opened from Settings, at
 * the end of setup for a new account, and whenever a Free allowance runs out
 * — `reason` names it, for analytics. It closes back to where it was opened.
 *
 * Checks the account before anything else mounts: Pro belongs to an account,
 * and a direct link skips the tabs' own sign-in check.
 */
export default function PaywallScreen() {
  const { isLoaded, isSignedIn } = useAuth();
  const { reason: reasonParam } = useLocalSearchParams<{ reason?: string }>();
  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/onboarding" />;
  const known = METERS.includes(reasonParam as Meter) || PRO_EXTRAS.includes(reasonParam as ProExtra);
  return <NexdoPaywall mode="app" reason={known ? (reasonParam as string) : "none"} />;
}
