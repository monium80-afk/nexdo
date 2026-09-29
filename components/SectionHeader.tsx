import { Feather } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { TextButton, type FeatherIconName } from "@/components/Button";
import { useColors } from "@/hooks/useTheme";

/**
 * The label over a group of controls: the Tasks page's sheet title (a muted
 * eyebrow), with an optional icon and an optional link on the right.
 */
export function SectionHeader({
  icon,
  label,
  required = false,
  action,
  hint,
}: {
  /** A Feather icon name — drawn muted — or an icon of your own (e.g. the AI's orange sparkle). */
  icon?: FeatherIconName | ReactNode;
  label: string;
  /** Marks a field that has to be filled in. */
  required?: boolean;
  action?: { label: string; onPress: () => void };
  /** Quiet text on the right when there's no action, e.g. "Optional". */
  hint?: string;
}) {
  const colors = useColors();
  return (
    <View className="flex-row items-center justify-between gap-3">
      <View className="shrink flex-row items-center gap-2">
        {typeof icon === "string" ? <Feather name={icon as FeatherIconName} size={14} color={colors.ink.creamMuted} /> : icon}
        <Text className="eyebrow text-ink-cream-muted">
          {label}
          {required ? <Text className="text-orange-600"> *</Text> : null}
        </Text>
      </View>
      {action ? (
        <TextButton label={action.label} onPress={action.onPress} tone="accent" />
      ) : hint ? (
        <Text className="font-grotesk-medium text-sm text-ink-cream-muted">{hint}</Text>
      ) : null}
    </View>
  );
}
