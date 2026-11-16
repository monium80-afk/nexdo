import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { gradients } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";

/**
 * The charcoal strip at the top of a screen, as on the Tasks page: the
 * screen's title with its actions on the right, an optional line of summary
 * under it, and warm light falling on it from the top-right corner. Actions
 * line up with the title's first line, so a title that wraps (a long task
 * name) doesn't drag them down.
 */
export function ScreenHeader({
  title,
  subtitle,
  accent = false,
  actions,
  children,
}: {
  title: string;
  /** A quiet line under the title ("Customize your experience"). */
  subtitle?: string;
  /** A short orange stroke under the title block — for a screen you fill in (Add Task). */
  accent?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const rtl = useRtlText();
  return (
    <View className="bg-charcoal-900 px-6 pb-4 pt-2">
      {/* Runs up under the status bar and down under the page's rounded
          corners, so the light has no edge anywhere. */}
      <View
        pointerEvents="none"
        className="absolute left-0 right-0"
        style={[{ top: -insets.top, bottom: -32 }, gradients.headerGlow]}
      />

      <View className="gap-2.5">
      <View className="flex-row items-start justify-between gap-3">
        {/* 3.3 = (39dp button − 32.4dp title line) / 2: one line sits centred on the buttons. */}
        <Text className="mt-[3.3px] flex-1 text-title text-ink-charcoal" style={rtl}>
          {title}
        </Text>
        {actions ? <View className="flex-row items-center gap-2">{actions}</View> : null}
      </View>
      {subtitle ? (
        <Text className="font-grotesk-medium text-sm text-ink-charcoal-muted" style={rtl}>
          {subtitle}
        </Text>
      ) : null}
      {children}
      {accent ? <View className="h-[3px] w-[28px] rounded-full bg-orange-500" /> : null}
      </View>
    </View>
  );
}
