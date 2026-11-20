import { useFocusEffect } from "expo-router";
import { setStatusBarStyle } from "expo-status-bar";
import { useCallback } from "react";

import { useIsDark } from "@/hooks/useTheme";

/**
 * The status bar's icon colour while this screen is in view: "light" over a
 * charcoal header, "dark" over a cream one. Set on focus rather than with a
 * <StatusBar /> element, because tab screens stay mounted and the last one
 * mounted would otherwise win. In dark mode a page asking for "dark" icons
 * (made for the light page) gets light ones: its page is dark there — unless
 * the page keeps its own colours in both modes (onboarding: `followTheme` false).
 */
export function useStatusBarStyle(style: "light" | "dark", { followTheme = true }: { followTheme?: boolean } = {}) {
  const dark = useIsDark();
  const shown = dark && followTheme ? "light" : style;
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle(shown);
    }, [shown]),
  );
}
