import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import * as Haptics from "expo-haptics";
import { useEffect } from "react";

import { sounds } from "@/constants/sounds";
import { sessionElapsedMs, useSessionStore } from "@/store/useSessionStore";

/**
 * Rings once when a running session's countdown reaches zero.
 *
 * Mounted once at the root rather than on the screen showing the clock: the
 * session keeps running while the user is on another tab, and the alarm has
 * to go off wherever they are. It is a plain timer set for exactly the time
 * left, so nothing has to tick in the background to make it fire — the app
 * does have to be open, though, so a phone locked mid-session rings when it
 * comes back rather than while it's away.
 */
export function useSessionAlarm() {
  const session = useSessionStore((state) => state.session);
  const player = useAudioPlayer(sounds.timerComplete);

  useEffect(() => {
    // A paused session has no deadline to reach, and one already past zero
    // has had its ring — the timer below only ever counts down to zero once,
    // so resuming into overtime stays quiet.
    if (!session || session.runningSince === null) return;
    const remainingMs = session.plannedMinutes * 60_000 - sessionElapsedMs(session);
    if (remainingMs <= 0) return;

    const timer = setTimeout(async () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      try {
        // An alarm is worth hearing with the ringer off, and recording a
        // voice note in AI Chat leaves the audio session in record mode.
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        await player.seekTo(0);
        player.play();
      } catch (error) {
        console.warn("[useSessionAlarm] couldn't play the timer sound", error);
      }
    }, remainingMs);

    // Re-armed whenever the session changes — pausing, resuming and "+5 min"
    // all move the moment the clock hits zero.
    return () => clearTimeout(timer);
  }, [session, player]);
}
