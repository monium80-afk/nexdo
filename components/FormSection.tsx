import type { ReactNode } from "react";
import { View } from "react-native";

import type { FeatherIconName } from "@/components/Button";
import { SectionHeader, type SectionAction } from "@/components/SectionHeader";

/**
 * One part of a form (Add Task, Send feedback): the section's label, with its
 * icon beside it, over its controls — which run the full width of the section.
 * Sits on a light panel unless `plain` — the first field of a form, which
 * stands on the page by itself.
 */
export function FormSection({
  icon,
  label,
  required,
  action,
  hint,
  plain = false,
  children,
}: {
  /** A Feather icon name — drawn muted — or an icon of your own. */
  icon: FeatherIconName | ReactNode;
  label: string;
  required?: boolean;
  action?: SectionAction;
  hint?: string;
  plain?: boolean;
  children: ReactNode;
}) {
  // A plain section's content lines up with a panel's: its padding plus its 1px edge.
  return (
    <View className={plain ? "gap-3 px-[15px]" : "panel gap-3 p-[14px]"}>
      <SectionHeader icon={icon} label={label} required={required} action={action} hint={hint} />
      {children}
    </View>
  );
}
