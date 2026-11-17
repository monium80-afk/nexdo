import { NexdoPaywall } from "@/components/paywall/NexdoPaywall";

// 12 · Paywall: the shared Nexdo Pro paywall (components/paywall/). Close
// carries on to sign-up (13) on Free.

export default function OnboardingPaywall() {
  return <NexdoPaywall mode="onboarding" reason={null} />;
}
