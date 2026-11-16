import type { ScreenRect } from "@/store/useMagicMicStore";

/** Anything React Native can measure on screen: a View, a ScrollView. */
type Measurable = { measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void };

/**
 * The longest to wait for a measurement. A view that goes away mid-measure
 * may never answer, and whatever waits on it (Magic mic's Done) must not
 * wait forever.
 */
const MEASURE_TIMEOUT_MS = 500;

/** Where a view is on screen right now (window coordinates), or null if it isn't laid out. */
export function measureView(view: Measurable | null | undefined): Promise<ScreenRect | null> {
  return new Promise((resolve) => {
    if (!view) {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => resolve(null), MEASURE_TIMEOUT_MS);
    try {
      view.measureInWindow((x, y, width, height) => {
        clearTimeout(timer);
        resolve(width > 0 && height > 0 ? { x, y, width, height } : null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/** Resolves on the next frame — once React Native has laid out what was just rendered. */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
