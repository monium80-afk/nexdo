import { useAuth } from "@clerk/expo";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { useAiLocked } from "@/hooks/useAiLocked";
import { useTranslation } from "@/hooks/useTranslation";
import { toLocalDateKey } from "@/lib/localDate";
import { updateHomeWidget } from "@/lib/widget";
import { buildWidgetData } from "@/lib/widgetData";
import { useTaskStore } from "@/store/useTaskStore";

/** Changes in a burst (a sync, Magic mic) reach the widget once. */
const DEBOUNCE_MS = 800;

/**
 * Keeps the home screen widget (lib/widgetData.ts) in step with the app:
 * the tasks, signing in or out, the language, Free or Pro — and the day,
 * worked out again each time the app comes back or goes to the background.
 * Lives in the root layout's account setup, so it runs on every screen.
 */
export function useWidgetSync() {
  const { isLoaded, isSignedIn } = useAuth();
  const tasks = useTaskStore((state) => state.tasks);
  const micLocked = useAiLocked();
  const t = useTranslation();

  // Bumped when the app comes back or leaves, so the day is read again.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" || state === "background") setTick((value) => value + 1);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    const timer = setTimeout(() => {
      const now = new Date();
      updateHomeWidget(
        buildWidgetData({ tasks, signedIn: !!isSignedIn, micLocked, now, today: toLocalDateKey(now), t }),
      );
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [isLoaded, isSignedIn, tasks, micLocked, t, tick]);
}
