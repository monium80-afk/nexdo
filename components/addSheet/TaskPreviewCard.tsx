import { Text, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { SheetIcon } from "@/components/addSheet/SheetParts";
import { colors } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import { shadow } from "@/constants/shadow";

const P = colors.palette;

// Floating over the blurred page, so a deeper shadow than a card in a list.
const FLOAT_SHADOW = shadow("0 14px 30px rgba(20, 12, 6, 0.28), 0 2px 8px rgba(20, 12, 6, 0.12)", 10);

function Meta({ icon, label }: { icon: "calendar" | "clock"; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <SheetIcon name={icon} size={14} color={P.inkMuted} strokeWidth={1.8} />
      <Text numberOfLines={1} style={{ fontFamily: "SpaceGrotesk-Regular", fontSize: 14, color: P.inkMuted }}>
        {label}
      </Text>
    </View>
  );
}

/**
 * A task as it will look on the Tasks page — check circle, title, when and
 * how long — without the score, and with an orange repeat mark after the
 * title when it repeats. The new task's live preview over the sheet, and each
 * task Nexdo found in a photo (then the circle keeps it or not).
 */
export function TaskPreviewCard({
  title,
  dateLabel,
  lengthLabel,
  repeats,
  kept,
  onToggleKeep,
}: {
  title: string;
  dateLabel?: string;
  lengthLabel?: string;
  repeats: boolean;
  /** A found task: whether it's kept. Absent for the new task's preview. */
  kept?: boolean;
  onToggleKeep?: () => void;
}) {
  const t = useTranslation();
  const rtl = useRtlText();
  const found = kept !== undefined;

  const circle = kept ? (
    <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: P.accent, alignItems: "center", justifyContent: "center" }}>
      <SheetIcon name="check" size={15} color="#FFFFFF" strokeWidth={3} />
    </View>
  ) : (
    <View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: P.ringSoft }} />
  );

  const body = (
    <>
      {circle}
      <View style={{ flex: 1, gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
          <Text numberOfLines={2} style={[{ flexShrink: 1, fontFamily: "SpaceGrotesk-SemiBold", fontSize: 17, lineHeight: 22, color: P.ink }, rtl]}>
            {title}
          </Text>
          {repeats ? (
            <View accessibilityLabel={t.addSheet.repeats} style={{ marginLeft: 7 }}>
              <SheetIcon name="repeat" size={16} color={P.accent} strokeWidth={2.2} />
            </View>
          ) : null}
        </View>
        {dateLabel || lengthLabel ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 4 }}>
            {dateLabel ? <Meta icon="calendar" label={dateLabel} /> : null}
            {lengthLabel ? <Meta icon="clock" label={lengthLabel} /> : null}
          </View>
        ) : null}
      </View>
    </>
  );

  const cardStyle = [
    {
      borderRadius: 18,
      backgroundColor: P.paperCard,
      paddingTop: 14,
      paddingBottom: 14,
      paddingLeft: 16,
      paddingRight: 14,
      flexDirection: "row" as const,
      alignItems: "flex-start" as const,
      gap: 12,
      opacity: found && !kept ? 0.8 : 1,
    },
    FLOAT_SHADOW,
  ];

  return found ? (
    <AnimatedPressable
      onPress={onToggleKeep}
      scaleTo={0.98}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: kept }}
      accessibilityLabel={title}
      style={cardStyle}
    >
      {body}
    </AnimatedPressable>
  ) : (
    <View accessibilityLabel={t.addSheet.preview} style={cardStyle}>
      {body}
    </View>
  );
}
