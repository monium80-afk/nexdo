import { Platform, type ViewStyle } from "react-native";

/**
 * A drop shadow that holds still. iOS draws the CSS `boxShadow`; Android gets
 * its own `elevation` shadow instead. Android draws a box shadow apart from
 * its view, so on a card that scales, slides or fades it lagged behind and
 * left odd shapes around cards and fields (2026-11-09). An elevation shadow
 * is part of the view and moves with it. The view needs a background colour.
 */
export function shadow(css: string, elevation: number, color = "#3C230F"): ViewStyle {
  return Platform.OS === "android" ? { elevation, shadowColor: color } : { boxShadow: css };
}

/** The light lift under a paper card. */
export const SOFT_SHADOW = shadow("0 2px 10px rgba(60, 35, 15, 0.07)", 2);
