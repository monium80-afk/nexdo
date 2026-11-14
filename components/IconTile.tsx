import { Feather } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { View } from "react-native";

import type { FeatherIconName } from "@/components/Button";
import { colors, gradients } from "@/constants/theme";

const TONES = {
  orange: { tile: "tile--orange", icon: colors.orange[500], fill: gradients.tileOrange },
  red: { tile: "tile--red", icon: colors.overdue[500], fill: gradients.tileRed },
  green: { tile: "tile--green", icon: colors.success[500], fill: gradients.tileGreen },
  neutral: { tile: "tile--neutral", icon: colors.ink.creamMuted, fill: undefined },
} as const;

export type IconTileTone = keyof typeof TONES;

// Class strings written out in full so Tailwind can see them. Sized to sit
// beside a two-line label (a title and its explanation) without making the
// row any taller than the text already makes it.
const SIZES = {
  md: { box: "h-[36px] w-[36px] rounded-[12px]", icon: 17 },
  sm: { box: "h-[32px] w-[32px] rounded-[10px]", icon: 15 },
} as const;

/**
 * The tinted square an icon sits in beside a label — a Settings row, the
 * "Open AI Chat" row. Tone says what kind of thing it is:
 * orange for the app's own features, red for something destructive, green
 * for repeating/finished things.
 */
export function IconTile({
  icon,
  tone = "orange",
  size = "md",
}: {
  /** A Feather icon name, drawn in the tone's colour — or an icon of your own. */
  icon: FeatherIconName | ReactNode;
  tone?: IconTileTone;
  size?: keyof typeof SIZES;
}) {
  const t = TONES[tone];
  const s = SIZES[size];
  return (
    <View className={`tile ${t.tile} ${s.box}`} style={t.fill}>
      {typeof icon === "string" ? <Feather name={icon as FeatherIconName} size={s.icon} color={t.icon} /> : icon}
    </View>
  );
}

/** The colour a tone draws its icon in, for callers passing their own icon. */
export function iconTileColor(tone: IconTileTone): string {
  return TONES[tone].icon;
}
