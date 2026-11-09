import { Easing, FadeInUp, FadeOut, LinearTransition } from "react-native-reanimated";

/** Shared timing and spring values for routine interface motion. */
export const MOTION = {
  duration: {
    pressIn: 100,
    pressOut: 160,
    short: 180,
    standard: 240,
    screen: 300,
    layout: 350,
  },
  easing: {
    standard: Easing.inOut(Easing.cubic),
    enter: Easing.out(Easing.cubic),
    exit: Easing.in(Easing.cubic),
    layout: Easing.out(Easing.quad),
  },
  spring: {
    gesture: { damping: 18, stiffness: 180, mass: 0.9 },
  },
} as const;

/**
 * How items in a list move — the Tasks page's list, shared by every list of
 * cards or steps. Functions rather than constants: each call hands a view
 * its own animation.
 */

/** A short rise into place, staggered over the first few items. */
export const listItemEntering = (index: number) =>
  FadeInUp.delay(Math.min(index, 8) * 40).duration(MOTION.duration.standard);

/** A quick fade while its former space closes through the shared layout transition. */
export const listItemExiting = () => FadeOut.duration(MOTION.duration.short).easing(MOTION.easing.exit);

/** How the items around one slide when it's added or removed. */
export const listItemLayout = () => LinearTransition.duration(MOTION.duration.layout).easing(MOTION.easing.layout);
