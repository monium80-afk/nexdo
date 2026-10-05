import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";

// On the web build, Google/Apple sign-in comes back in a popup. This hands
// the result to the window that opened it. It does nothing on iOS and Android.
WebBrowser.maybeCompleteAuthSession();

let inFlight = false;

/**
 * Closes a Google/Apple sign-in sheet that an earlier flow left open.
 * Android has no way to close it from the app (expo-web-browser throws), so
 * there the sheet's session ends only when the person comes back to the app.
 */
export function dismissAuthSession() {
  if (Platform.OS !== "android") WebBrowser.dismissAuthSession();
}

/**
 * Runs `flow` unless another Google/Apple sign-in is still open. expo-web-browser
 * holds one auth session for the whole app: a second tap while the browser is
 * open throws on Android, because the first session's redirect handler is
 * still set. Returns false when it skipped `flow`.
 */
export async function runAuthSession(flow: () => Promise<void>): Promise<boolean> {
  if (inFlight) return false;
  inFlight = true;
  try {
    dismissAuthSession();
    await flow();
    return true;
  } finally {
    inFlight = false;
  }
}
