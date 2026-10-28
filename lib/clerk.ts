import { resourceCache as nativeResourceCache } from "@clerk/expo/resource-cache";
import { Platform } from "react-native";

export { tokenCache } from "@clerk/expo/token-cache";

/**
 * Keeps what Clerk last fetched (the account, the session) on the phone, so
 * the app opens signed in without a connection. Without it Clerk waits for
 * the network before it says who's signed in, and an offline launch never
 * gets past the splash. Native only: it's built on expo-secure-store.
 */
export const resourceCache = Platform.OS === "web" ? undefined : nativeResourceCache;

export const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

if (!publishableKey) {
  throw new Error("Add EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY to your .env file");
}

/**
 * Where Google/Apple sign-in sends the browser back to. Left to itself,
 * useSSO() builds this from wherever the app is running, so a dev build on
 * Metro asked for a different address than a store build — and Clerk's
 * production instance refuses any address that isn't on its allowlist
 * ("Redirect url mismatch"). Pinned, every build asks for the one address
 * that is: Clerk Dashboard → Native applications → mobile SSO redirect allowlist.
 */
export const SSO_REDIRECT_URL = "nexdo://sso-callback";
