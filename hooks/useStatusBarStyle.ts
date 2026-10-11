import { useFocusEffect } from "expo-router";
import { setStatusBarStyle } from "expo-status-bar";
import { useCallback } from "react";

/**
 * The status bar's icon colour while this screen is in view: "light" over a
 * charcoal header, "dark" over a cream one. Set on focus rather than with a
 * <StatusBar /> element, because tab screens stay mounted and the last one
 * mounted would otherwise win.
 */
export function useStatusBarStyle(style: "light" | "dark") {
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle(style);
    }, [style]),
  );
}
