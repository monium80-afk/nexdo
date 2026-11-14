import { Feather } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { colors } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";

const P = colors.palette;

/**
 * Break it down's sheets (the user's screenshots, 2026-11-10): a spaced-out
 * eyebrow with a round ✕ beside it, and the big title under them.
 */
export function BreakdownSheetHeader({
  eyebrow,
  title,
  subtitle,
  closeLabel,
  onClose,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  closeLabel: string;
  onClose: () => void;
}) {
  const rtl = useRtlText();
  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <Text style={{ fontFamily: "SpaceMono-Bold", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: P.inkMuted }}>
          {eyebrow}
        </Text>
        <AnimatedPressable
          onPress={onClose}
          scaleTo={0.92}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: P.chip, alignItems: "center", justifyContent: "center" }}
        >
          <Feather name="x" size={19} color={P.ink} />
        </AnimatedPressable>
      </View>
      <Text
        numberOfLines={3}
        style={[{ marginTop: 6, fontFamily: "SpaceGrotesk-Bold", fontSize: 25, lineHeight: 30, letterSpacing: -0.5, color: P.ink }, rtl]}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text numberOfLines={2} style={[{ marginTop: 4, fontFamily: "SpaceGrotesk-Regular", fontSize: 15, lineHeight: 20, color: P.inkMuted }, rtl]}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}
