import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { isProFocusSound, playFocusSound } from "@/lib/focusSound";
import { isPurchasesEnabled } from "@/lib/purchases";
import { isRecording, onRecordingChange } from "@/lib/recordingMode";
import { useSessionStore } from "@/store/useSessionStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useIsPro } from "@/store/useSubscriptionStore";

/**
 * The focus sound picked in a session (Pro) plays while that session's clock
 * runs — and only then: it stops on Pause, when the session ends, when Nexdo
 * leaves the screen, and while the microphone is open (Magic mic would hear
 * it). Mounted once at the root, like the session alarm, so it carries on
 * while the user looks at another tab mid-session.
 */
export function useFocusSound() {
  const running = useSessionStore((state) => state.session !== null && state.session.runningSince !== null);
  const choice = useSettingsStore((state) => state.focusSound);
  const isPro = useIsPro();
  // Rain is free; the rest need Pro (lib/focusSound.ts).
  const allowed = isPro || !isPurchasesEnabled || !isProFocusSound(choice);
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const [recording, setRecording] = useState(isRecording());

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setAppActive(state === "active"));
    return () => subscription.remove();
  }, []);

  useEffect(() => onRecordingChange(() => setRecording(isRecording())), []);

  const wanted = allowed && running && appActive && !recording && choice !== "off" ? choice : null;

  useEffect(() => {
    playFocusSound(wanted);
  }, [wanted]);

  // Nothing should outlive the app's root.
  useEffect(() => () => playFocusSound(null), []);
}
