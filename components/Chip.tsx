import { Feather } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Text } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { gradients } from "@/constants/theme";
import { useColors } from "@/hooks/useTheme";

type ChipProps = {
  label: string;
  onPress: () => void;
  selected?: boolean;
  /**
   * Picked, fill the chip with the glowing orange instead of tinting it —
   * for the one set of options on a screen that decides the most (the Add
   * form's duration).
   */
  solid?: boolean;
  /** Drawn in the chip's own colour, so it follows the selected state. */
  icon?: (color: string) => ReactNode;
  /** A trailing down-arrow, for a chip that opens a list (the Tasks filter and sort). */
  chevron?: boolean;
  disabled?: boolean;
  /** "radio" for one choice out of a set (a duration, a deadline, a language). */
  accessibilityRole?: "button" | "radio";
  /** Layout from the caller, e.g. flex-1 for chips sharing a row equally. */
  className?: string;
};

/**
 * The pill from the Tasks page toolbar, used for every set of options in the
 * app: a lifted cream pill at rest, orange-tinted with an orange edge once
 * it's the one picked.
 */
export function Chip({
  label,
  onPress,
  selected = false,
  solid = false,
  icon,
  chevron = false,
  disabled = false,
  accessibilityRole = "button",
  className = "",
}: ChipProps) {
  const colors = useColors();
  const filled = selected && solid;
  const color = filled ? colors.onAccent : selected ? colors.orange[600] : colors.ink.creamMuted;
  // A little less room beside an icon or the chevron, whose glyphs carry
  // their own space — the same padding the Tasks toolbar uses.
  const padding = `${icon ? "pl-3" : "pl-3.5"} ${chevron ? "pr-2.5" : "pr-3.5"}`;
  const surface = filled
    ? "glow-accent border-orange-500 bg-orange-500"
    : selected
      ? "border-orange-500 bg-orange-100"
      : "chip--idle";

  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityState={accessibilityRole === "radio" ? { selected } : undefined}
      style={filled ? gradients.accent : undefined}
      className={`chip min-h-[34px] shrink flex-row items-center gap-1.5 ${padding} ${surface} ${className}`}
    >
      {icon ? icon(color) : null}
      <Text
        className={
          filled
            ? "shrink font-grotesk-bold text-sm text-on-accent"
            : selected
              ? "shrink font-grotesk-bold text-sm text-orange-600"
              : "shrink font-grotesk-semibold text-sm text-ink-cream"
        }
        numberOfLines={1}
      >
        {label}
      </Text>
      {chevron ? <Feather name="chevron-down" size={14} color={color} /> : null}
    </AnimatedPressable>
  );
}
