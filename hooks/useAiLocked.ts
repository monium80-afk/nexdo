import { isPurchasesEnabled } from "@/lib/purchases";
import { useIsPro } from "@/store/useSubscriptionStore";

/**
 * Whether this account's AI features are locked: on Free, every one of them
 * is (lib/plan.ts — Free has no AI since 2026-10-26). Locked features are
 * shown with a padlock and open the plans when tapped, so a Free user sees
 * what Pro adds before reaching for it — never a request that gets refused.
 * A build without store keys has no Pro to sell, so nothing is locked there.
 */
export function useAiLocked(): boolean {
  const isPro = useIsPro();
  return !isPro && isPurchasesEnabled;
}
