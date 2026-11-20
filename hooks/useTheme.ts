import { useColorScheme } from "react-native";

import { colors, darkColors, darkPalette, type Palette } from "@/constants/theme/colors";

/**
 * Dark mode (2026-11-17). Settings → Dark mode sets the app's appearance
 * with React Native's Appearance (app/_layout.tsx), so useColorScheme() here
 * answers with the user's choice, or the phone's when they left it on "system".
 * NativeWind classes follow on their own (global.css's dark block); these
 * hooks are for the colours that go through `style`.
 */
export function useIsDark(): boolean {
  return useColorScheme() === "dark";
}

/** Every colour token, in the current mode. */
export function useColors() {
  return useIsDark() ? darkColors : colors;
}

/** The redesign's palette (paper / ink / accent…), in the current mode. */
export function usePalette(): Palette {
  return useIsDark() ? darkPalette : colors.palette;
}
