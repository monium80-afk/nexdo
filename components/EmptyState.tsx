import type { ReactNode } from "react";
import { Text, View } from "react-native";

import type { FeatherIconName } from "@/components/Button";
import { IconTile } from "@/components/IconTile";

/** A quiet centred message for a place with nothing in it (no tasks match, task not found). */
export function EmptyState({
  icon,
  title,
  body,
  children,
}: {
  icon: FeatherIconName;
  title: string;
  body?: string;
  /** An action under the message, e.g. a Go back button. */
  children?: ReactNode;
}) {
  return (
    <View className="items-center gap-2 py-16">
      <IconTile icon={icon} />
      <Text className="font-grotesk-bold text-base text-ink-cream">{title}</Text>
      {body ? <Text className="text-body text-center text-ink-cream-muted">{body}</Text> : null}
      {children}
    </View>
  );
}
