import { Platform } from "react-native";
import Purchases, { LOG_LEVEL, PURCHASES_ERROR_CODE, type CustomerInfo, type PurchasesError } from "react-native-purchases";
import RevenueCatUI, { PAYWALL_RESULT } from "react-native-purchases-ui";

import { useSubscriptionStore } from "@/store/useSubscriptionStore";

// Nexdo Pro through RevenueCat. The plans (monthly, yearly), the offering
// that bundles them and the paywall's design all live in the RevenueCat
// dashboard, so none of them is named here — only the entitlement that both
// plans unlock.

export const PRO_ENTITLEMENT = "nexdo_pro";

// The Test Store key only ever runs in development: RevenueCat makes a
// release build that carries one crash on purpose, so store builds read only
// the platform's own key. Expo Go and web can only use the test key.
const STORE_API_KEY = Platform.select({
  ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY,
  android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY,
});
const API_KEY = (__DEV__ ? process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY || STORE_API_KEY : STORE_API_KEY) || null;

/** False in a build without a RevenueCat key — Nexdo Pro is hidden then, rather than broken. */
export const isPurchasesEnabled = API_KEY !== null;

let configured = false;

// logIn / logOut can't overlap (the SDK refuses one while another is still
// running), so account changes run one after another. A failure is logged and
// the chain carries on, so the next change still gets its turn.
let queue: Promise<void> = Promise.resolve();
function enqueue(task: () => Promise<void>) {
  queue = queue.then(task).catch((error: unknown) => console.warn("[purchases]", error));
  return queue;
}

function publish(customerInfo: CustomerInfo | null) {
  useSubscriptionStore.setState({
    customerInfo,
    pro: customerInfo?.entitlements.active[PRO_ENTITLEMENT] ?? null,
  });
}

function errorCode(error: unknown): PURCHASES_ERROR_CODE | undefined {
  return typeof error === "object" && error !== null && "code" in error ? (error as PurchasesError).code : undefined;
}

/**
 * Ties RevenueCat to the signed-in Clerk account, so Pro follows the account
 * to any phone it signs in on. Set up on the first sign-in rather than at
 * launch: nothing reaches RevenueCat for someone who never makes an account.
 */
export function identifyPurchaser(userId: string) {
  if (!API_KEY) return Promise.resolve();
  const apiKey = API_KEY;
  return enqueue(async () => {
    if (!configured) {
      void Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.INFO : LOG_LEVEL.WARN);
      Purchases.configure({ apiKey, appUserID: userId });
      // Renewals, cancellations and purchases made elsewhere all arrive here
      // on iOS and Android. Expo Go and web never call it, which is why every
      // action below also refreshes by hand.
      Purchases.addCustomerInfoUpdateListener(publish);
      configured = true;
    } else if ((await Purchases.getAppUserID()) !== userId) {
      const { customerInfo } = await Purchases.logIn(userId);
      publish(customerInfo);
      return;
    }
    publish(await Purchases.getCustomerInfo());
  });
}

/**
 * On sign-out: RevenueCat goes back to an anonymous user, so the next
 * account on this phone doesn't inherit this one's Pro.
 */
export function resetPurchaser() {
  publish(null);
  if (!configured) return Promise.resolve();
  return enqueue(async () => {
    if (!(await Purchases.isAnonymous())) await Purchases.logOut();
  });
}

/** Reads the account's customer info again. The SDK caches it, so this is cheap. */
export async function refreshCustomerInfo() {
  if (!configured) return;
  try {
    publish(await Purchases.getCustomerInfo());
  } catch (error) {
    console.warn("[purchases] couldn't refresh customer info", error);
  }
}

/**
 * RevenueCat's paywall for the current offering (monthly and yearly), as
 * designed in its dashboard. Opens only if the account isn't Pro yet; a
 * failed purchase is explained inside the paywall itself, so the caller only
 * needs to act on ERROR.
 */
export async function presentProPaywall(): Promise<PAYWALL_RESULT> {
  await queue; // a tap right after launch waits for sign-in to reach RevenueCat
  if (!configured) return PAYWALL_RESULT.ERROR;
  try {
    return await RevenueCatUI.presentPaywallIfNeeded({ requiredEntitlementIdentifier: PRO_ENTITLEMENT });
  } catch (error) {
    console.warn("[purchases] paywall failed", error);
    return PAYWALL_RESULT.ERROR;
  } finally {
    await refreshCustomerInfo();
  }
}

export type RestoreOutcome = "restored" | "nothing" | "offline" | "error";

/** Brings back Pro bought with this phone's App Store / Google Play account. */
export async function restorePurchases(): Promise<RestoreOutcome> {
  await queue;
  if (!configured) return "error";
  try {
    const customerInfo = await Purchases.restorePurchases();
    publish(customerInfo);
    return customerInfo.entitlements.active[PRO_ENTITLEMENT] ? "restored" : "nothing";
  } catch (error) {
    console.warn("[purchases] restore failed", error);
    const code = errorCode(error);
    const offline = code === PURCHASES_ERROR_CODE.NETWORK_ERROR || code === PURCHASES_ERROR_CODE.OFFLINE_CONNECTION_ERROR;
    return offline ? "offline" : "error";
  }
}

/**
 * RevenueCat's Customer Center: switch or cancel the plan, restore, ask for a
 * refund (iOS). Set up under Customer Center in the dashboard. It needs a
 * development or store build — in Expo Go it does nothing.
 */
export async function presentCustomerCenter(): Promise<boolean> {
  await queue;
  if (!configured) return false;
  try {
    await RevenueCatUI.presentCustomerCenter();
    return true;
  } catch (error) {
    console.warn("[purchases] customer center failed", error);
    return false;
  } finally {
    // A cancellation there changes when Pro ends.
    await refreshCustomerInfo();
  }
}
