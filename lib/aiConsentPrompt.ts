import * as WebBrowser from "expo-web-browser";
import { Alert, Platform } from "react-native";

import { SUPPORT_LINKS } from "@/constants/support";
import { hasAiConsent } from "@/lib/aiConsent";
import { translate } from "@/lib/i18n";
import { useSettingsStore } from "@/store/useSettingsStore";

type Answer = "allow" | "notNow" | "privacy";

function ask(): Promise<Answer> {
  const t = translate().aiConsent;
  // A browser's dialog can only say yes or no (lib/alert.ts).
  if (Platform.OS === "web") {
    return Promise.resolve(window.confirm(`${t.title}\n\n${t.body}`) ? "allow" : "notNow");
  }
  return new Promise((resolve) => {
    // Android lays three buttons out left to right as given; iOS stacks them
    // and moves the cancel one to the bottom. Tapping outside counts as "Not now".
    Alert.alert(
      t.title,
      t.body,
      [
        { text: t.privacy, onPress: () => resolve("privacy") },
        { text: t.notNow, style: "cancel", onPress: () => resolve("notNow") },
        { text: t.allow, onPress: () => resolve("allow") },
      ],
      { cancelable: true, onDismiss: () => resolve("notNow") },
    );
  });
}

let asking: Promise<boolean> | null = null;

/**
 * Asks once whether Nexdo may use Google's Gemini AI, unless it already may.
 * Several AI calls at once (a few photos read together) share one question.
 * "Privacy policy" opens the policy and asks again once it's closed.
 */
export function requestAiConsent(): Promise<boolean> {
  if (hasAiConsent()) return Promise.resolve(true);
  asking ??= (async () => {
    for (;;) {
      const answer = await ask();
      if (answer === "allow") {
        useSettingsStore.getState().setAiConsent(true);
        return true;
      }
      if (answer === "notNow") return false;
      try {
        await WebBrowser.openBrowserAsync(SUPPORT_LINKS.privacyPolicy);
      } catch (error) {
        console.warn("[aiConsent] couldn't open the privacy policy", error);
        return false;
      }
    }
  })().finally(() => {
    asking = null;
  });
  return asking;
}
