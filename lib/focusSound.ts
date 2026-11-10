import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

import { sounds } from "@/constants/sounds";
import { isRecording } from "@/lib/recordingMode";
import { FOCUS_SOUND_CHOICES, type FocusSound } from "@/types/settings";

export type FocusSoundName = Exclude<FocusSound, "off">;

/** The order the session's picker lists them in. */
export const FOCUS_SOUNDS = FOCUS_SOUND_CHOICES.filter((choice): choice is FocusSoundName => choice !== "off");

const SOURCES: Record<FocusSoundName, number> = {
  rain: sounds.focusRain,
  waves: sounds.focusWaves,
  thunder: sounds.focusThunder,
  stream: sounds.focusStream,
  forest: sounds.focusForest,
  fireplace: sounds.focusFireplace,
  cafe: sounds.focusCafe,
};

/** Under the session's own sounds, never over them. */
const VOLUME = 0.55;
const FADE_IN_MS = 900;
const FADE_OUT_MS = 300;
const FADE_STEP_MS = 50;

type Playing = { name: FocusSoundName; player: AudioPlayer; fade: ReturnType<typeof setInterval> | null };

let playing: Playing | null = null;

function fadeTo(entry: Playing, target: number, durationMs: number, then?: () => void) {
  if (entry.fade) clearInterval(entry.fade);
  const start = entry.player.volume;
  const steps = Math.max(1, Math.round(durationMs / FADE_STEP_MS));
  let step = 0;
  entry.fade = setInterval(() => {
    step += 1;
    try {
      entry.player.volume = start + ((target - start) * step) / steps;
    } catch {
      // The player went away mid-fade.
    }
    if (step >= steps) {
      if (entry.fade) clearInterval(entry.fade);
      entry.fade = null;
      then?.();
    }
  }, FADE_STEP_MS);
}

function stop(entry: Playing) {
  fadeTo(entry, 0, FADE_OUT_MS, () => {
    try {
      entry.player.pause();
      entry.player.remove();
    } catch (error) {
      console.warn("[focusSound] couldn't stop", error);
    }
  });
}

/**
 * Plays one focus sound on a loop, fading in — or, given null, fades out
 * whatever is playing. Switching sounds crossfades. Driven by
 * hooks/useFocusSound.ts, which decides when a sound should be heard at all:
 * a session running, the app on screen, nothing recording. Never throws.
 */
export function playFocusSound(name: FocusSoundName | null): void {
  if (playing?.name === name) return;
  if (playing) {
    stop(playing);
    playing = null;
  }
  if (!name) return;
  try {
    // The user picked it: worth hearing with the ringer switch off, as the
    // timer's alarm is. Never touched while something records — leaving
    // record mode would cut the microphone (lib/recordingMode.ts).
    if (!isRecording()) {
      setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch((error) =>
        console.warn("[focusSound] couldn't set the audio mode", error),
      );
    }
    const player = createAudioPlayer(SOURCES[name]);
    player.loop = true;
    player.volume = 0;
    player.play();
    playing = { name, player, fade: null };
    fadeTo(playing, VOLUME, FADE_IN_MS);
  } catch (error) {
    console.warn(`[focusSound] couldn't play ${name}`, error);
    playing = null;
  }
}
