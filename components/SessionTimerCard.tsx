import { Feather } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import type { SessionCountdown } from "@/hooks/useSessionCountdown";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";

export function SessionTimerCard({
  countdown,
  onToggleRunning,
  onReset,
}: {
  countdown: SessionCountdown;
  onToggleRunning: () => void;
  onReset: () => void;
}) {
  const colors = useColors();
  const t = useTranslation();
  const { clock, caption, progress, isRunning, isOvertime } = countdown;

  return (
    <View className="card card--charcoal gap-4 p-5">
      <View className="flex-row items-center gap-2">
        <View className="h-1.5 w-1.5 rounded-full bg-orange-500" />
        <Text className="eyebrow text-ink-charcoal-muted">{t.session.timerTitle}</Text>
      </View>

      <View className="flex-row items-baseline gap-3">
        <Text
          className="font-grotesk-bold text-[38px] leading-[1.05] tracking-tight"
          style={{ color: isOvertime ? colors.orange[500] : colors.ink.charcoal }}
        >
          {clock}
        </Text>
        <Text className="flex-1 font-grotesk-medium text-sm text-ink-charcoal-muted">{caption}</Text>
      </View>

      {/* Flex ratios rather than a percentage width: RN takes fractional
          flex directly, so there's no `${n}%` string to type-wrangle. */}
      <View className="h-1 flex-row overflow-hidden rounded-full bg-white/10">
        <View className="rounded-full bg-orange-500" style={{ flex: progress }} />
        <View style={{ flex: 1 - progress }} />
      </View>

      <View className="flex-row items-center gap-2">
        <AnimatedPressable
          onPress={onToggleRunning}
          accessibilityRole="button"
          accessibilityLabel={isRunning ? t.session.pauseA11y : t.session.resumeA11y}
          className="flex-row items-center gap-2 rounded-full bg-white/10 px-5 py-3"
        >
          <Feather name={isRunning ? "pause" : "play"} size={15} color={colors.ink.charcoal} />
          <Text className="font-grotesk-semibold text-sm text-ink-charcoal">
            {isRunning ? t.session.pause : t.session.resume}
          </Text>
        </AnimatedPressable>

        <AnimatedPressable
          onPress={onReset}
          accessibilityRole="button"
          accessibilityLabel={t.session.restartA11y}
          className="h-11 w-11 items-center justify-center rounded-full bg-white/10"
        >
          <Feather name="rotate-ccw" size={15} color={colors.ink.charcoal} />
        </AnimatedPressable>
      </View>
    </View>
  );
}
