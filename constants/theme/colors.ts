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
  /**
   * The 2026-11 redesign's tokens (nexdo-design-handoff/HANDOFF.md), the same
   * as the paper / ink / accent / peach / alert / line utilities in
   * global.css. Pages move to these one at a time, Today first.
   */
  palette: {
    paper: "#FAF1E4",
    paperCard: "#FCF7EF",
    paperDim: "#E9DFD5",
    paperFaint: "#A89A8E",
    ink: "#221C17",
    inkMuted: "#7A6E64",
    accent: "#F26A2E",
    accentInk: "#C4461A",
    peach: "#FCE2D2",
    peachOnDark: "#FFB089",
    alert: "#D93A2B",
    line: "#E2D6C8",
    lineSoft: "#EADCCB",
    ring: "#D9CCBD",
    ringSoft: "#CFC4B9",
    chip: "#EFE3D4",
    // The Add task sheet (addtask-design/, 2026-11-08).
    handle: "#DCCFBF",
    tile: "#F3EADF",
    inkFaint: "#B5A99D",
    lineWarm: "#E7DACB",
    onAccentSoft: "#FFE1D2",
    menu: "#FFFFFF",
    /** The dark veil over the blurred page behind a sheet. */
    veil: "rgba(34, 28, 23, 0.42)",
    // ---- Added for dark mode (2026-11-17). In light mode each is the colour
    // these places already used; dark mode gives them their own. ----
    /** A dark card on the page (Today's card, the tab bar, the plan card, a toast). */
    inkCard: "#221C17",
    /** Text and icons on an inkCard — light in both modes. */
    onInk: "#FAF1E4",
    /** A card lifted over the page: the edit card, a menu. */
    raised: "#FCF7EF",
    /** A rule between rows on a light card. */
    rule: "#EADFD1",
    /** An idle switch track, an empty slider track. */
    track: "#E7DCCF",
    /** An idle bar in a small chart. */
    bar: "#EDE2D5",
    /** An open dot on a light card (a slider stop). */
    dot: "#D9CCBD",
    /** Text on an ink-filled pill or button (a picked tab, the round +): ink's opposite. */
    inverse: "#FFFFFF",
    /** A soft orange bar in a chart (past days). */
    barSoft: "#F6BC9A",
    /** A finished task's greyed text, strike and icons. */
    doneGrey: "#A79C92",
    /** A finished task's greyed pill. */
    donePill: "#EFE3D4",
  },
} as const;

export type Palette = { readonly [K in keyof typeof colors.palette]: string };

/**
 * Dark mode (2026-11-17, from the user's dark screenshots). The same names as
 * `colors.palette`, so a component reads `usePalette()` (hooks/useTheme.ts)
 * and never asks which mode it is in. The page is a warm near-black, cards
 * are one step lighter, and what was ink (text, picked pills, the round +
 * button) turns cream. Mirrored in global.css's dark block.
 */
export const darkPalette: Palette = {
  paper: "#15100D",
  paperCard: "#211A15",
  paperDim: "#E9DFD5",
  paperFaint: "#8F8379",
  ink: "#F2E8DC",
  inkMuted: "#9E9186",
  accent: "#F26A2E",
  accentInk: "#F5884F",
  peach: "#3F2416",
  peachOnDark: "#FFB089",
  alert: "#D93A2B",
  line: "#3B322B",
  lineSoft: "#2E251F",
  ring: "#4A3E35",
  ringSoft: "#4A3F37",
  chip: "#2A221C",
  handle: "#382D25",
  tile: "#2A221C",
  inkFaint: "#6E625A",
  lineWarm: "#3B322B",
  onAccentSoft: "#FFE1D2",
  menu: "#2E2620",
  veil: "rgba(0, 0, 0, 0.55)",
  inkCard: "#2B231D",
  onInk: "#FAF1E4",
  raised: "#2E2620",
  rule: "#2A221C",
  track: "#3A322C",
  bar: "#3A2E26",
  dot: "#4A3E35",
  inverse: "#15100D",
  barSoft: "#7A4A30",
  doneGrey: "#6E625A",
  donePill: "#2A221C",
};

/**
 * The older Warm Signal tokens (cream / charcoal / ink-cream…) in dark mode,
 * for the pages that still use them. Same shape as `colors`.
 */
export const darkColors = {
  ...colors,
  cream: { 50: "#211A15", 100: "#15100D", 200: "#2E251F", 300: "#3B322B" },
  charcoal: { 900: "#2B231D", 800: "#2D261F", 600: "#4D4338", 400: "#8F8474" },
  orange: { ...colors.orange, 50: "#2A1A12", 100: "#3F2416", 200: "#5A3220", 600: "#F0773A" },
  amber: { 500: "#E0A53A", 100: "#3A2B10" },
  olive: { 500: "#9CB06A", 100: "#26301A" },
  overdue: { ...colors.overdue, 50: "#2E1510", 100: "#3E1A12", 200: "#6A2A1C" },
  success: { ...colors.success, 100: "#15301F" },
  ink: { cream: "#F2E8DC", creamMuted: "#9E9186", creamSubtle: "#776A61", charcoal: "#FBF5EA", charcoalMuted: "#B1A796" },
  logoInk: "#F2E8DC",
  scrim: "rgba(0, 0, 0, 0.6)",
  palette: darkPalette,
} as unknown as typeof colors;

// Onboarding uses these values for shadow contrast. Keep the alias while the
// app's active palette remains the shared Warm Signal token set.
export const lightColors = colors;
