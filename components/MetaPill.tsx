import type { ReactNode } from "react";
import { Text, View, type TextStyle } from "react-native";

type MetaPillProps = {
  icon: ReactNode;
  label: string;
  /** Replaces the label's weight and color (e.g. a deadline that's coming up). */
  labelClassName?: string;
  labelStyle?: TextStyle;
  /** A tinted chip for the one item that needs flagging (a deadline due soon or overdue). */
  className?: string;
  /** What a screen reader says instead of the bare label (e.g. "Score: 49" for "49"). */
  accessibilityLabel?: string;
};

/**
 * One piece of a task's metadata (deadline, score, duration) on a cream card:
 * an icon and a short label. Bare by default so a row of them reads as one
 * line of detail. Every item keeps the same vertical padding, tinted or not,
 * so a card is the same height whichever of its items is flagged.
 */
export function MetaPill({
  icon,
  label,
  labelClassName = "font-grotesk-medium text-ink-cream-muted",
  labelStyle,
  className = "",
  accessibilityLabel,
}: MetaPillProps) {
  return (
    <View
      accessible={accessibilityLabel !== undefined}
      accessibilityLabel={accessibilityLabel}
      className={`flex-row items-center gap-1 py-[3px] ${className}`}
    >
      {icon}
      <Text className={`text-sm ${labelClassName}`} style={labelStyle}>{label}</Text>
    </View>
  );
}
