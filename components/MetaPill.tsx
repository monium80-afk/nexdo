import type { ReactNode } from "react";
import { Text, View } from "react-native";

export function MetaPill({
  icon,
  label,
  labelClassName = "font-grotesk-medium text-ink-cream",
  surface = "raised",
}: {
  icon?: ReactNode;
  label: string;
  /** The label's font weight and color classes — the deadline tag is bold and colored by urgency. */
  labelClassName?: string;
  surface?: "raised" | "recessed";
}) {
  return (
    <View
      className={
        surface === "raised"
          ? "flex-row items-center gap-1.5 rounded-xl border border-cream-300 bg-cream-100 px-3 py-1.5"
          : "flex-row items-center gap-1.5 rounded-xl border border-cream-300 bg-cream-50 px-3 py-1.5"
      }
    >
      {icon}
      <Text className={`text-xs ${labelClassName}`}>{label}</Text>
    </View>
  );
}
