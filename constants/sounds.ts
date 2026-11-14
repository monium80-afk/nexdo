import dayDone from "../assets/sounds/day-done.wav";
import focusFireplace from "../assets/sounds/focus-fireplace.m4a";
import focusForest from "../assets/sounds/focus-forest.m4a";
import focusRain from "../assets/sounds/focus-rain.m4a";
import focusStream from "../assets/sounds/focus-stream.m4a";
import focusThunder from "../assets/sounds/focus-thunder.m4a";
import focusWaves from "../assets/sounds/focus-waves.m4a";
import sessionStart from "../assets/sounds/session-start.wav";
import stepCheck from "../assets/sounds/step-check.wav";
import taskComplete from "../assets/sounds/task-complete.wav";
import timerComplete from "../assets/sounds/timer-complete.wav";

/**
 * Every sound the app plays, imported in one place — the same rule the app's
 * images follow (see constants/images.ts), so nothing `require`s an asset
 * from inside a screen or a hook. The four short ones are made by
 * scripts/make-sounds.mjs and played through lib/sounds.ts.
 */
export const sounds = {
  timerComplete,
  taskComplete,
  stepCheck,
  dayDone,
  sessionStart,
  // Loops a focus session can play (scripts/make-focus-sounds.mjs, lib/focusSound.ts).
  focusRain,
  focusWaves,
  focusThunder,
  focusStream,
  focusForest,
  focusFireplace,
};
