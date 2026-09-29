import { useColorScheme } from "react-native";

import { colors } from "@/constants/theme/colors";
import { useSettingsStore } from "@/store/useSettingsStore";

export function useColors() {
  return colors;
}

export function useThemeScheme(): "light" | "dark" {
  const preference = useSettingsStore((state) => state.theme);
  const systemScheme = useColorScheme();

  if (preference !== "system") return preference;
  return systemScheme === "dark" ? "dark" : "light";
}