import { createAudioPlayer, type AudioPlayer } from "expo-audio";

import { sounds } from "@/constants/sounds";
import { isRecording } from "@/lib/recordingMode";

/**
 * The app's small sounds, kept for the moments that earn one (the user asked
 * for sound, 2026-10-26, "but not to a point where it feels off"):
 * - complete: a task done — two soft rising notes
 * - step: a step ticked off in a session — one light tick
 * - dayDone: the last of today's tasks done — a short three-note chime
 * - sessionStart: a focus session opening — a soft low swell
 * Nothing else makes a sound: not taps, not navigation, not adding or deleting.
 *
 * They're quiet (made at about a quarter of full scale, played at
 * PLAYBACK_VOLUME) and never play while the microphone is open (Magic mic would
 * hear them). There's no setting for them (Settings → Sounds was removed at
 * the user's request, 2026-10-28). The audio mode isn't
 * touched here: on iPhone the ringer switch mutes them — until the session's
 * timer alarm (hooks/useSessionAlarm.ts) has rung through it, which leaves
 * the mode playing through the switch. Android plays them at media volume.
 */
export type SoundName = "complete" | "step" | "dayDone" | "sessionStart";

const SOURCES: Record<SoundName, number> = {
  complete: sounds.taskComplete,
  step: sounds.stepCheck,
  dayDone: sounds.dayDone,
  sessionStart: sounds.sessionStart,
};

const PLAYBACK_VOLUME = 0.7;

// One player per sound, made the first time it's needed and kept: they're a
// few kilobytes each, and making one on every tap would add a delay.
const players: Partial<Record<SoundName, AudioPlayer>> = {};

function playerFor(name: SoundName): AudioPlayer {
  let player = players[name];
  if (!player) {
    player = createAudioPlayer(SOURCES[name]);
    player.volume = PLAYBACK_VOLUME;
    players[name] = player;
  }
  return player;
}

/** Plays one of the app's sounds. Never throws, never waits. */
export function playSound(name: SoundName): void {
  if (isRecording()) return;
  try {
    const player = playerFor(name);
    // From the top, so a quick second one isn't lost in the tail of the first.
    player
      .seekTo(0)
      .then(() => player.play())
      .catch((error) => console.warn(`[sounds] couldn't play ${name}`, error));
  } catch (error) {
    console.warn(`[sounds] couldn't play ${name}`, error);
  }
}
