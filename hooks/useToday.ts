import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

import { toLocalDateKey, type LocalDate } from "@/lib/localDate";

/**
 * Today's date on this phone, kept current while the screen stays open: it
 * moves on at midnight, when the app comes back from the background, and
 * when the screen comes back into view — a phone left open overnight, or put
 * away and picked up the next morning, shows the new day.
 */
export function useToday(): LocalDate {
  const [today, setToday] = useState(() => toLocalDateKey(new Date()));
  // Same value, same state: React skips the re-render.
  const refresh = useCallback(() => setToday(toLocalDateKey(new Date())), []);

  useFocusEffect(refresh);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer !== undefined) clearTimeout(timer);
      const now = new Date();
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
      timer = setTimeout(() => {
        refresh();
        schedule();
      }, nextMidnight.getTime() - now.getTime());
    };
    schedule();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        refresh();
        schedule();
      }
    });
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      subscription.remove();
    };
  }, [refresh]);

  return today;
}
