import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { gradients } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useSessionCountdown } from "@/hooks/useSessionCountdown";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { formatTaskLength } from "@/lib/formatDuration";
import type { ActiveSession } from "@/store/useSessionStore";

// The lift under the white play disc.
const PLAY_SHADOW = { boxShadow: "0 3px 8px -2px rgba(150, 50, 10, 0.45)" };

/** A running session's clock, small, on the Resume button — its own component so only it ticks. */
function ResumeClock({ session }: { session: ActiveSession }) {
  const countdown = useSessionCountdown(session);
  return (
    <Text className="font-grotesk-semibold text-[14px] text-on-accent" style={{ opacity: 0.85, fontVariant: ["tabular-nums"] }}>
      {countdown.clock}
    </Text>
  );
}

/**
 * The orange "▶ Start session" button — on a Today card, and on Task Details
 * for any task, deadline or not. While that task's session is running it
 * reads "Resume session" with the clock beside it, and takes the user back
 * into it rather than starting the clock again.
 */
export function StartSessionButton({
  minutes,
  runningSession,
  onPress,
}: {
  /** The task's length — read out with the label; 0 for a task with no duration. */
  minutes: number;
  /** This task's own session, while one is running. */
  runningSession?: ActiveSession;
  onPress: () => void;
}) {
  const colors = useColors();
  const t = useTranslation();
  const rtl = useRtlText();
  return (
    <AnimatedPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        runningSession
          ? t.next.resumeSession
          : minutes > 0
            ? t.next.startSessionFor(formatTaskLength(minutes))
            : t.next.startSessionLabel
      }
      style={gradients.accent}
      className="glow-accent min-h-[44px] flex-row items-center justify-center gap-3 rounded-[16px] bg-orange-500 px-4 py-1.5"
    >
      <View className="h-[28px] w-[28px] items-center justify-center rounded-full bg-white" style={PLAY_SHADOW}>
        {/* Nudged right: a triangle's visual centre sits left of its box. */}
        <Ionicons name="play" size={13} color={colors.orange[500]} style={{ marginLeft: 2 }} />
      </View>
      <Text style={rtl} className="font-grotesk-bold text-[15px] text-on-accent">
        {runningSession ? t.next.resumeSession : t.next.startSessionLabel}
      </Text>
      {/* No clock for a task with no duration: its session has none. */}
      {runningSession && runningSession.plannedMinutes > 0 ? <ResumeClock session={runningSession} /> : null}
    </AnimatedPressable>
  );
}
