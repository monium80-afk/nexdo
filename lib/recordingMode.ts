import { setAudioModeAsync } from "expo-audio";

/** Everything in the app that opens the microphone. */
export type Recorder = "liveVoice" | "voiceNote" | "brainDump";

// Who has the microphone open right now.
const recorders = new Set<Recorder>();

/**
 * The phone has one audio session, shared by every recorder and by the
 * session alarm (hooks/useSessionAlarm.ts). Recorders switch record mode on
 * and off through here, so the alarm can see that something is listening
 * before it touches the mode — on iOS, turning recording off stops every
 * recording in progress.
 */
export async function beginRecording(recorder: Recorder): Promise<void> {
  recorders.add(recorder);
  // iOS refuses record mode unless playback ignores the silent switch too.
  await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
}

/**
 * Leaves record mode once nothing else is recording. iOS otherwise keeps the
 * input route active and playback quiet for the rest of the session. Safe to
 * call when `recorder` isn't recording, and fired off rather than awaited: it
 * is never allowed to cost the recording.
 */
export function endRecording(recorder: Recorder): void {
  if (!recorders.delete(recorder) || recorders.size > 0) return;
  setAudioModeAsync({ allowsRecording: false }).catch((error) =>
    console.warn(`[recordingMode] ${recorder} couldn't leave recording mode`, error),
  );
}

export function isRecording(): boolean {
  return recorders.size > 0;
}
