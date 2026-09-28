import type { ReactNode } from "react";
import { Text, View } from "react-native";

type MetaPillProps = {
  icon: ReactNode;
  label: string;
  /** Replaces the label's weight and color (e.g. an urgency-tinted deadline). */
  labelClassName?: string;
};

/** A small icon + label tag for a task's metadata (score, deadline, duration) on a cream card. */
export function MetaPill({ icon, label, labelClassName = "font-grotesk-semibold text-ink-cream" }: MetaPillProps) {
  return (
    <View className="flex-row items-center gap-1.5 rounded-full border border-cream-300 bg-cream-50 px-3 py-1.5">
      {icon}
      <Text className={`text-xs ${labelClassName}`}>{label}</Text>
    </View>
  );
}
