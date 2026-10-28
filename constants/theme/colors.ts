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
    50: "#FDF8EF",
    100: "#FBF3E5",
    200: "#F0E5D2",
    300: "#E2D4BD",
  },
  charcoal: {
    900: "#221C16",
    800: "#2D261F",
    600: "#4D4338",
    400: "#8F8474",
  },
  orange: {
    50: "#FFF3E8",
    100: "#FDE6D5",
    200: "#FBCFB3",
    300: "#F9B07F",
    400: "#FA8B4C",
    500: "#F2652A",
    600: "#D04816",
  },
  amber: {
    500: "#BA7A0C",
    100: "#F8EACB",
  },
  olive: {
    500: "#6F8245",
    100: "#E6EDD5",
  },
  overdue: {
    500: "#CC3B1E",
    300: "#F0957E",
    200: "#F7BCA9",
    100: "#FCE3DA",
    50: "#FFF1EB",
  },
  success: {
    500: "#1F8F54",
    300: "#7FD48F",
    100: "#E2F2E2",
  },
  ink: {
    cream: "#1D1813",
    creamMuted: "#6A6157",
    creamSubtle: "#9C9184",
    charcoal: "#FBF5EA",
    charcoalMuted: "#B1A796",
  },
  logoInk: "#1D1813",
  // Icon-only colors for the AI Chat quick-action chips (no CSS utility needed).
  quickAction: {
    add: "#F2652A",
    complete: "#1F8F54",
    remove: "#CC3B1E",
    change: "#D9820F",
    breakDown: "#4F6B4C",
    prioritize: "#2F7BD6",
  },
  // Ink on a filled button (orange-500, charcoal-900, Apple black) — the
  // `text-on-accent` utility, for icons and spinners that can't take a class.
  onAccent: "#FFF9F2",
  scrim: "rgba(34, 28, 22, 0.5)",
  hairlineCharcoal: "rgba(255, 255, 255, 0.08)",
} as const;

// Onboarding uses these values for shadow contrast. Keep the alias while the
// app's active palette remains the shared Warm Signal token set.
export const lightColors = colors;
