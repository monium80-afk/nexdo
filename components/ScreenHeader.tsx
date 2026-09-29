import type { ReactNode } from "react";
import { Text, View } from "react-native";

/**
 * The charcoal strip at the top of a screen, as on the Tasks page: the
 * screen's title with its actions on the right, and an optional line of
 * summary under it. Actions line up with the title's first line, so a
 * title that wraps (a long task name) doesn't drag them down.
 */
export function ScreenHeader({ title, actions, children }: { title: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <View className="gap-2.5 bg-charcoal-900 px-6 pb-4 pt-2">
      <View className="flex-row items-start justify-between gap-3">
        {/* 3.3 = (39dp button − 32.4dp title line) / 2: one line sits centred on the buttons. */}
        <Text className="mt-[3.3px] flex-1 text-title text-ink-charcoal">{title}</Text>
        {actions ? <View className="flex-row items-center gap-2">{actions}</View> : null}
      </View>
      {children}
    </View>
  );
}
