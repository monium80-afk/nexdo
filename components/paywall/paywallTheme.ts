// The paywall's colours (paywall-7b.html) — a dark screen of its own, in the
// app's orange.

export const PAYWALL_BG = "#1B1512";

export const PW = {
  bg: PAYWALL_BG,
  ink: "#FAF1E4",
  /** Restore, Terms and Privacy. */
  soft: "#D9CCBF",
  muted: "#A3968A",
  /** The small caps under a card's number. */
  unit: "#8C8077",
  orange: "#F26A2E",
  /** The card numbers and the headline's second line. */
  peach: "#FF9A55",
  /** The pills, cards and unpicked plan, over the dark. */
  glass: "rgba(250,241,228,0.08)",
  card: "rgba(250,241,228,0.05)",
  line: "rgba(250,241,228,0.14)",
} as const;
