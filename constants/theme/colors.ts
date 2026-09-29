/**
 * Nexdo — Design System ("Warm Signal") color tokens.
 * Mirrors the `@theme` block in global.css. Use these only where a
 * component can't take a `className` (SafeAreaView, Modal, Animated.View,
 * StyleSheet-driven shadows) — everywhere else, use the NativeWind
 * utilities (e.g. `bg-cream-50`, `text-ink-charcoal`) instead.
 *
 * Keep this file's values in sync with global.css if the design system
 * changes — it is not generated from the CSS.
 */

export const colors = {
  cream: {
    50: "#F7F4E8",
    100: "#EFEBDA",
    200: "#E2DDC6",
    300: "#CFC9AC",
  },
  charcoal: {
    900: "#1E1C19",
    800: "#28251F",
    600: "#4A453B",
    400: "#8B8574",
  },
  orange: {
    500: "#E2622E",
    600: "#C74F20",
    100: "#F7E1D2",
  },
  amber: {
    500: "#C8912C",
    100: "#F3E7CC",
  },
  olive: {
    500: "#71824A",
    100: "#E4E8D3",
  },
  overdue: {
    500: "#B5432F",
    300: "#E8907C",
    100: "#F2DCD5",
  },
  success: {
    500: "#3E9B5F",
  },
  ink: {
    cream: "#211E19",
    creamMuted: "#6B6656",
    creamSubtle: "#9A9382",
    charcoal: "#F5F1E6",
    charcoalMuted: "#A39D8A",
  },
  logoInk: "#211E19",
  // Icon-only colors for the AI Chat quick-action chips (no CSS utility needed).
  quickAction: {
    add: "#E2622E",
    complete: "#3E9B5F",
    remove: "#B5432F",
    change: "#E08A1F",
    breakDown: "#4F6B4C",
    prioritize: "#2F7BD6",
  },
  // Ink on a filled button (orange-500, charcoal-900, Apple black) — the
  // `text-on-accent` utility, for icons and spinners that can't take a class.
  onAccent: "#F7F4E8",
  scrim: "rgba(30, 28, 25, 0.5)",
  hairlineCharcoal: "rgba(255, 255, 255, 0.08)",
} as const;

// Onboarding uses these values for shadow contrast. Keep the alias while the
// app's active palette remains the shared Warm Signal token set.
export const lightColors = colors;
