import type { WidgetData } from "@/lib/widgetData";

/**
 * Hands the home screen widget its data (lib/widgetData.ts). The phone's
 * own files do the work: lib/widget.ios.ts and lib/widget.android.ts. The
 * web has no widget, so this one does nothing.
 */
export function updateHomeWidget(_data: WidgetData): void {}
