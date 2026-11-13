import { NexdoPaywall } from "@/components/NexdoPaywall";

// 12 · Paywall (screens/12-paywall.html): the shared paywall
// (components/NexdoPaywall.tsx), which goes on to sign-up (13).

export default function OnboardingPaywall() {
  return <NexdoPaywall mode="onboarding" reason="onboarding" />;
}
