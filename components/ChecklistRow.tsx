import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { Checkbox } from "@/components/Checkbox";
import { useRtlText } from "@/hooks/useRtlText";

/**
 * One step of a task — a subtask on Task Details, a step in the AI
 * Breakdown sheet — drawn like a small task card: the same card, checkbox
 * and title weight. The checkbox and label toggle together; `children` are
 * the row's own trailing actions (edit, delete).
 */
export function ChecklistRow({
  label,
  checked,
  onToggle,
  disabled = false,
  caption,
  children,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  /** A quiet line under the label — e.g. the day the plan suggests for this step. */
  caption?: string;
  children?: ReactNode;
}) {
  const rtl = useRtlText();
  const labelClass = checked
    ? "font-grotesk-semibold text-base text-ink-cream-muted line-through"
    : "font-grotesk-semibold text-base text-ink-cream";
  return (
    <View className="card card--cream-soft flex-row items-center pr-1.5">
      <AnimatedPressable
        onPress={onToggle}
        disabled={disabled}
        scaleTo={0.98}
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled }}
        className="flex-1 flex-row items-center gap-3 py-3 pl-[16px] pr-2"
      >
        <Checkbox checked={checked} />
        {caption ? (
          <View className="flex-1 gap-0.5">
            <Text style={rtl} className={labelClass}>
              {label}
            </Text>
            <Text style={rtl} className="font-grotesk-medium text-sm text-ink-cream-muted">
              {caption}
            </Text>
          </View>
        ) : (
          <Text style={rtl} className={`flex-1 ${labelClass}`}>
            {label}
          </Text>
        )}
      </AnimatedPressable>
      {children}
    </View>
  );
}
