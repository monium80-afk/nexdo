import type { ReactNode } from "react";
import { Text } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";

type SuggestionChipProps = {
  emoji: string;
  /** Rendered in place of the emoji — pass a sized, colored icon element. */
  icon?: ReactNode;
  label: string;
  onPress: () => void;
  /** Stacked greeting suggestions stretch full-width; the quick-action bar stays compact. */
  fullWidth?: boolean;
};

export function SuggestionChip({ emoji, icon, label, onPress, fullWidth = false }: SuggestionChipProps) {
  return (
    <AnimatedPressable
      onPress={onPress}
      className={
        fullWidth
          ? "chip chip--idle flex-row items-center gap-2 self-stretch px-4 py-3"
          : "chip chip--idle flex-row items-center gap-1.5 px-3 py-[6px]"
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
            : "font-grotesk-semibold text-xs text-ink-cream"
        }
      >
        {label}
      </Text>
    </AnimatedPressable>
  );
}
