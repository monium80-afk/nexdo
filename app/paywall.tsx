import { useAuth } from "@clerk/expo";
import { Redirect, useLocalSearchParams } from "expo-router";

import { NexdoPaywall } from "@/components/paywall/NexdoPaywall";
import { PRO_FEATURES, type ProFeatureId } from "@/lib/plan";

/**
 * The Nexdo Pro paywall inside the app — the same screen as onboarding's
 * (components/paywall/). Opened from Settings → Upgrade, at the end of setup
 * for a new account, and from a locked feature or a used-up allowance:
 * `reason` names that feature, and its card comes to the front. Close goes
 * back to where it was opened.
 *
 * Checks the account before anything else mounts: Pro belongs to an account,
 * and a direct link skips the tabs' own sign-in check.
 */
export default function PaywallScreen() {
  const { isLoaded, isSignedIn } = useAuth();
  const { reason } = useLocalSearchParams<{ reason?: string }>();
  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/onboarding" />;
  const feature = PRO_FEATURES.find((candidate) => candidate.id === reason);
  return <NexdoPaywall mode="app" reason={feature ? (feature.id as ProFeatureId) : null} />;
}
