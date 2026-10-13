import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import * as Haptics from "expo-haptics";
import { useEffect } from "react";

import { sounds } from "@/constants/sounds";
import { translate } from "@/lib/i18n";
import { setSessionEndReminder } from "@/lib/notifications";
import { isRecording } from "@/lib/recordingMode";
import { sessionElapsedMs, useSessionStore } from "@/store/useSessionStore";
import { useTaskStore } from "@/store/useTaskStore";

/**
 * Rings once when a running session's countdown reaches zero.
 *
 * Mounted once at the root rather than on the screen showing the clock: the
 * session keeps running while the user is on another tab, and the alarm has
 * to go off wherever they are. It is a plain timer set for exactly the time
 * left, so nothing has to tick in the background to make it fire — but a
 * timer only runs while the app does. For a phone locked mid-session, or
 * Nexdo in the background, a notification is scheduled for the same moment
 * (lib/notifications.ts); with the app open it stays silent, and this rings.
 */
export function useSessionAlarm() {
  const session = useSessionStore((state) => state.session);
  const player = useAudioPlayer(sounds.timerComplete);

  useEffect(() => {
    // A paused session has no deadline to reach, and one already past zero
    // has had its ring — the timer below only ever counts down to zero once,
    // so resuming into overtime stays quiet.
    const remainingMs =
      session && session.runningSince !== null ? session.plannedMinutes * 60_000 - sessionElapsedMs(session) : 0;
    if (!session || remainingMs <= 0) {
      void setSessionEndReminder(null);
      return;
    }

    const t = translate();
    const task = useTaskStore.getState().tasks.find((entry) => session.taskIds.includes(entry.id));
    void setSessionEndReminder({
      fireAt: Date.now() + remainingMs,
      title: t.notifications.sessionEndTitle,
      body: t.notifications.sessionEndBody(task?.title ?? ""),
    });

    const timer = setTimeout(async () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      try {
        // An alarm is worth hearing with the ringer off. While something is
        // recording (live voice, a voice note) the session is already in
        // record mode, which plays through the silent switch and the speaker
        // anyway — and switching recording off would cut the microphone.
        if (!isRecording()) await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        await player.seekTo(0);
        player.play();
      } catch (error) {
        console.warn("[useSessionAlarm] couldn't play the timer sound", error);
      }
    }, remainingMs);

    // Re-armed whenever the session changes — pausing, resuming and "+5 min"
    // all move the moment the clock hits zero, and the notification with it.
    return () => clearTimeout(timer);
  }, [session, player]);
}
