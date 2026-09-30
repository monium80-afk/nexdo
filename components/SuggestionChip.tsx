import type { ReactNode } from "react";
import { Text } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { gradients } from "@/constants/theme";

// Each tone tints the chip with its action's colour, so a row of quick
// actions reads by colour before it's read by word. "accent" is the one
// glowing orange chip — the action the row leads with. Class strings are
// written out in full so Tailwind can see them.
const TONES = {
  idle: "chip--idle",
  accent: "glow-accent border-orange-500 bg-orange-500",
  green: "border-success-500/35 bg-success-100",
  red: "border-overdue-200 bg-overdue-50",
  amber: "border-amber-500/35 bg-amber-100",
  olive: "border-olive-500/35 bg-olive-100",
  blue: "border-[#2F7BD6]/30 bg-[#E4EEFB]",
} as const;

export type SuggestionTone = keyof typeof TONES;

type SuggestionChipProps = {
  emoji: string;
  /** Rendered in place of the emoji — pass a sized, colored icon element. */
  icon?: ReactNode;
  label: string;
  onPress: () => void;
  tone?: SuggestionTone;
  /** Stacked greeting suggestions stretch full-width; the quick-action bar stays compact. */
  fullWidth?: boolean;
};

export function SuggestionChip({ emoji, icon, label, onPress, tone = "idle", fullWidth = false }: SuggestionChipProps) {
  const accent = tone === "accent";
  return (
    <AnimatedPressable
      onPress={onPress}
      style={accent ? gradients.accent : undefined}
      className={
        fullWidth
          ? `chip ${TONES[tone]} flex-row items-center gap-2 self-stretch px-4 py-3`
          : `chip ${TONES[tone]} flex-row items-center gap-1.5 px-3 py-[6px]`
      }
    >
      {icon ? (
        icon
      ) : (
        <Text className={fullWidth ? "text-sm" : "text-xs"}>{emoji}</Text>
      )}
      <Text
        numberOfLines={1}
        className={
          fullWidth
            ? "flex-1 font-grotesk-semibold text-sm text-ink-cream"
            : accent
              ? "font-grotesk-bold text-xs text-on-accent"
              : "font-grotesk-semibold text-xs text-ink-cream"
        }
      >
        {label}
      </Text>
    </AnimatedPressable>
  );
}
