import type { ViewStyle } from "react-native";

/**
 * Gradient fills, as React Native's own `experimental_backgroundImage`.
 *
 * NativeWind compiles `background-image` in global.css, but its runtime hands
 * the colour stops to the native view in a form React Native can't read — so
 * gradients live here and go on through `style`, the one styling exception in
 * this design system. Each is meant to sit on top of its class recipe from
 * global.css (the class brings the shadow, edge and a flat fallback colour;
 * the gradient paints over that colour).
 */
const fill = (value: string): ViewStyle => ({ experimental_backgroundImage: value });

export const gradients = {
  /** The orange CTA (btn--primary, glow-accent): lit at the top-left, deepening to the bottom-right. */
  accent: fill("linear-gradient(160deg, #FB9459 0%, #F26A2F 50%, #E4521E 100%)"),
  /** A finished-it action (Complete). */
  success: fill("linear-gradient(160deg, #45B971 0%, #28995A 100%)"),

  /** A raised cream card — a whisper of light at the top. */
  card: fill("linear-gradient(180deg, #FFFCF7 0%, #FCF5EA 100%)"),
  /** card--danger: Sign out, Clear chat history. */
  danger: fill("linear-gradient(170deg, #FFF6F2 0%, #FEE8DF 100%)"),

  /** Icon tiles (tile--*). */
  tileOrange: fill("linear-gradient(145deg, #FFF2E6 0%, #FCD9C1 100%)"),
  tileRed: fill("linear-gradient(145deg, #FFEFE9 0%, #F9D2C5 100%)"),
  tileGreen: fill("linear-gradient(145deg, #EFF8EA 0%, #D3EAC9 100%)"),

  /** Warm lamplight falling on a charcoal header from its top-right corner. */
  headerGlow: fill(
    "radial-gradient(circle at 96% 0%, rgba(250, 130, 62, 0.34) 0%, rgba(250, 130, 62, 0.1) 38%, rgba(250, 130, 62, 0) 62%), " +
      "radial-gradient(circle at 0% 120%, rgba(255, 196, 128, 0.12) 0%, rgba(255, 196, 128, 0) 50%)",
  ),
  /** The same light on a cream header (Next, AI Chat). */
  creamGlow: fill(
    "radial-gradient(circle at 100% 0%, rgba(252, 180, 120, 0.55) 0%, rgba(252, 196, 140, 0.18) 40%, rgba(252, 196, 140, 0) 65%)",
  ),
  /**
   * Soft grey shading at the edges of a cream page — depth without colour.
   * Sized in points, and kept clear of the page's foot, where the tab bar
   * floats over it.
   */
  pageGlow: fill(
    "radial-gradient(circle 240px at 108% 38%, rgba(96, 90, 84, 0.07) 0%, rgba(96, 90, 84, 0) 100%), " +
      "radial-gradient(circle 200px at -12% 66%, rgba(96, 90, 84, 0.05) 0%, rgba(96, 90, 84, 0) 100%)",
  ),

  /** A charcoal card on the cream page (the Next card): lit from its top-left. */
  charcoalCard: fill("linear-gradient(165deg, #342C25 0%, #231D18 45%, #1B1612 100%)"),
  /**
   * The focus session's backdrop: plain charcoal, a touch lighter at the top.
   * No orange — the user found the ember glow too bright (2026-09-30). It
   * fills the page down to the bottom of the screen, under the floating tab
   * bar, and is redrawn every frame the session opens and closes, so it stays
   * one simple gradient.
   */
  session: fill("linear-gradient(180deg, #2C2926 0%, #201E1C 55%, #1C1A18 100%)"),
  /** The Next card's "#1 Priority" pill. */
  rankPill: fill("linear-gradient(135deg, rgba(242, 101, 42, 0.38) 0%, rgba(242, 101, 42, 0.18) 100%)"),
} satisfies Record<string, ViewStyle>;
