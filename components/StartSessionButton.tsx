import { Text } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { AppIcon } from "@/components/icons/AppIcons";
import { useRtlText } from "@/hooks/useRtlText";
import { useSessionCountdown } from "@/hooks/useSessionCountdown";
import { useTranslation } from "@/hooks/useTranslation";
import { formatTaskLength } from "@/lib/formatDuration";
import type { ActiveSession } from "@/store/useSessionStore";

/** A running session's clock, small, on the Resume button — its own component so only it ticks. */
function ResumeClock({ session }: { session: ActiveSession }) {
  const countdown = useSessionCountdown(session);
  return (
    <Text className="font-grotesk-semibold text-[13px] text-white" style={{ opacity: 0.85, fontVariant: ["tabular-nums"] }}>
      {countdown.clock}
    </Text>
  );
}

/**
 * The orange "▶ Start focus" pill on a Today card (the 2026-11 redesign,
 * Final-Today.html: flat orange, 50 tall, fully round). While that task's
 * session is running it reads "Resume session" with the clock beside it, and
 * takes the user back into it rather than starting the clock again.
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
  const t = useTranslation();
  const rtl = useRtlText();
  return (
    <AnimatedPressable
      onPress={onPress}
      scaleTo={0.97}
      accessibilityRole="button"
      accessibilityLabel={
        runningSession
          ? t.next.resumeSession
          : minutes > 0
            ? t.next.startFocusFor(formatTaskLength(minutes))
            : t.next.startFocus
      }
      className="h-[44px] flex-row items-center justify-center gap-[7px] rounded-full bg-accent px-4"
    >
      <AppIcon name="play" size={11} color="#FFFFFF" />
      <Text numberOfLines={1} style={rtl} className="shrink font-grotesk-bold text-[14px] text-white">
        {runningSession ? t.next.resumeSession : t.next.startFocus}
      </Text>
      {/* No clock for a task with no duration: its session has none. */}
      {runningSession && runningSession.plannedMinutes > 0 ? <ResumeClock session={runningSession} /> : null}
    </AnimatedPressable>
  );
}
