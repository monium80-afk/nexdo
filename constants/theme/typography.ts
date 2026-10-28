/**
 * Nexdo — Space Grotesk font family names, as registered with
 * `useFonts` in app/_layout.tsx. Use these for the `fontFamily` style
 * on components that can't take a className — everywhere else, use
 * the `font-grotesk-*` NativeWind utilities instead.
 *
 * Always pick a weight via one of these family names, never via a
 * numeric `fontWeight` style — React Native does not synthesize
 * weights from a single custom font file.
 */

export const fonts = {
  light: "SpaceGrotesk-Light", // 300 — quoted/AI/chat content only
  regular: "SpaceGrotesk-Regular", // 400 — body copy, metadata
  medium: "SpaceGrotesk-Medium", // 500 — default UI chrome
  semibold: "SpaceGrotesk-SemiBold", // 600 — labels of consequence
  bold: "SpaceGrotesk-Bold", // 700 — the one or two things that must win first
} as const;
