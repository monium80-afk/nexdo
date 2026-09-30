import type { ReactNode } from "react";
import { View } from "react-native";

import type { FeatherIconName } from "@/components/Button";
import { IconTile, type IconTileTone } from "@/components/IconTile";
import { SectionHeader, type SectionAction } from "@/components/SectionHeader";

/**
 * One part of a form (Add Task): an icon tile on the left, and the section's
 * label with its controls in a column beside it. Sits on a light panel unless
 * `plain` — the first field of a form, which stands on the page by itself.
 */
export function FormSection({
  icon,
  tone = "orange",
  label,
  required,
  action,
  hint,
  plain = false,
  children,
}: {
  icon: FeatherIconName | ReactNode;
  tone?: IconTileTone;
  label: string;
  required?: boolean;
  action?: SectionAction;
  hint?: string;
  plain?: boolean;
  children: ReactNode;
}) {
  return (
    <View className={plain ? "flex-row gap-3 px-3" : "panel flex-row gap-3 p-3"}>
      <IconTile icon={icon} tone={tone} />
      {/* The label's line sits level with the middle of the tile. */}
      <View className="flex-1 gap-3 pt-[9px]">
        <SectionHeader label={label} required={required} action={action} hint={hint} />
        {children}
      </View>
    </View>
  );
}
