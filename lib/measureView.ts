import type { ScreenRect } from "@/store/useMagicMicStore";

/** Anything React Native can measure on screen: a View, a ScrollView. */
type Measurable = { measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void };

/** Where a view is on screen right now (window coordinates), or null if it isn't laid out. */
export function measureView(view: Measurable | null | undefined): Promise<ScreenRect | null> {
  return new Promise((resolve) => {
    if (!view) {
      resolve(null);
      return;
    }
    view.measureInWindow((x, y, width, height) => resolve(width > 0 && height > 0 ? { x, y, width, height } : null));
  });
}

/** Resolves on the next frame — once React Native has laid out what was just rendered. */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
