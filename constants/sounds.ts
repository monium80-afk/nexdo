import timerComplete from "../assets/sounds/timer-complete.wav";

/**
 * Every sound the app plays, imported in one place — the same rule the app's
 * images follow (see constants/images.ts), so nothing `require`s an asset
 * from inside a screen or a hook.
 */
export const sounds = {
  timerComplete,
};
