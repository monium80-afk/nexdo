import type { CustomerInfo, PurchasesEntitlementInfo } from "react-native-purchases";
import { create } from "zustand";

// Filled in by lib/purchases.ts whenever RevenueCat reports the account's
// customer info. Not persisted: the RevenueCat SDK keeps its own cached copy
// on the phone, so Pro survives restarts and works offline.
type SubscriptionStore = {
  /** The signed-in account's RevenueCat customer info — null until it loads, and after sign-out. */
  customerInfo: CustomerInfo | null;
  /** The account's active `nexdo_pro` entitlement, or null when it isn't Pro. */
  pro: PurchasesEntitlementInfo | null;
};

export const useSubscriptionStore = create<SubscriptionStore>()(() => ({
  customerInfo: null,
  pro: null,
}));

/** Whether the signed-in account has Nexdo Pro right now. Outside React: `useSubscriptionStore.getState().pro !== null`. */
export const useIsPro = () => useSubscriptionStore((state) => state.pro !== null);
