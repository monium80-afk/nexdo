import { Platform } from "react-native";
import Purchases, {
  INTRO_ELIGIBILITY_STATUS,
  LOG_LEVEL,
  PURCHASES_ERROR_CODE,
  type CustomerInfo,
  type PurchasesError,
  type PurchasesPackage,
} from "react-native-purchases";
import RevenueCatUI from "react-native-purchases-ui";

import { storeTrial, type FreeTrial } from "@/lib/freeTrial";
import { PRO_ENTITLEMENT } from "@/lib/plan";
import { useSubscriptionStore } from "@/store/useSubscriptionStore";

// Nexdo Pro through RevenueCat. The two subscriptions (monthly, yearly), their
// prices and the offering that bundles them live in the RevenueCat dashboard
// and the stores, so none of them is named here: the paywall
// (app/paywall.tsx) shows whatever the current offering holds. What each plan
// includes is the app's own business — lib/plan.ts.

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

function isOffline(code: PURCHASES_ERROR_CODE | undefined): boolean {
  return code === PURCHASES_ERROR_CODE.NETWORK_ERROR || code === PURCHASES_ERROR_CODE.OFFLINE_CONNECTION_ERROR;
}

/** One plan on sale, and the free trial — if any — this account would start it with. */
export type ProPlan = { package: PurchasesPackage; trial: FreeTrial | null };

/** The plans on sale: the current offering's monthly and yearly packages. Either can be missing if the dashboard doesn't have it. */
export type ProPlans = { monthly: ProPlan | null; annual: ProPlan | null };

/**
 * Which of these products' free trials this account can still have. Only the
 * App Store needs asking. An answer RevenueCat can't give counts as no, as it
 * advises: the paywall never promises a trial the purchase sheet then won't
 * give.
 */
async function trialEligibleProducts(productIds: string[]): Promise<Set<string>> {
  if (Platform.OS !== "ios") return new Set(productIds);
  try {
    const answers = await Purchases.checkTrialOrIntroductoryPriceEligibility(productIds);
    return new Set(
      productIds.filter((id) => answers[id]?.status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE),
    );
  } catch (error) {
    console.warn("[purchases] couldn't check free trial eligibility", error);
    return new Set();
  }
}

/**
 * What the paywall sells, with the store's own prices in the buyer's
 * currency and the free trial this account can still have. Throws when the
 * plans can't be loaded (offline, or no offering set up yet) — the paywall
 * offers a retry.
 *
 * Reads the dashboard's current offering ("default") rather than naming one,
 * so what's on sale can change there without an app update.
 */
export async function loadProPlans(): Promise<ProPlans> {
  await queue; // a tap right after launch waits for sign-in to reach RevenueCat
  if (!configured) throw new Error("[purchases] not configured");
  const { current } = await Purchases.getOfferings();
  const packages = [current?.monthly, current?.annual].filter((plan): plan is PurchasesPackage => Boolean(plan));
  if (packages.length === 0) throw new Error("[purchases] the current offering has no monthly or yearly package");

  const eligible = await trialEligibleProducts(packages.map((plan) => plan.product.identifier));
  const withTrial = (plan: PurchasesPackage | null | undefined): ProPlan | null =>
    plan ? { package: plan, trial: eligible.has(plan.product.identifier) ? storeTrial(plan.product) : null } : null;
  return { monthly: withTrial(current?.monthly), annual: withTrial(current?.annual) };
}

export type PurchaseOutcome = "purchased" | "cancelled" | "pending" | "offline" | "error";

/** Buys one plan through the store's own purchase sheet. Never throws. */
export async function purchasePlan(plan: PurchasesPackage): Promise<PurchaseOutcome> {
  // An account change still on its way to RevenueCat finishes first, so the
  // purchase is made for — and its Pro shown to — the account now signed in.
  await queue;
  if (!configured) return "error";
  try {
    const { customerInfo } = await Purchases.purchasePackage(plan);
    publish(customerInfo);
    if (customerInfo.entitlements.active[PRO_ENTITLEMENT]) return "purchased";
    // Paid for, but RevenueCat didn't unlock Pro: the product isn't attached
    // to the entitlement in the dashboard.
    console.warn(`[purchases] ${plan.product.identifier} bought, but "${PRO_ENTITLEMENT}" isn't active`);
    return "error";
  } catch (error) {
    const code = errorCode(error);
    if (code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) return "cancelled";
    // Waiting on something outside the app (a parent's approval, a slow
    // payment): Pro arrives through the customer-info listener when it clears.
    if (code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) return "pending";
    // This phone's store account already has the subscription: bring it over.
    if (code === PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR) {
      return (await restorePurchases()) === "restored" ? "purchased" : "error";
    }
    console.warn("[purchases] purchase failed", error);
    return isOffline(code) ? "offline" : "error";
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
    return isOffline(errorCode(error)) ? "offline" : "error";
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
