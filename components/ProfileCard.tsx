import { useUser } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { Image, Text, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { gradients } from "@/constants/theme";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";

const AVATAR_SHADOW = { boxShadow: "0 4px 10px -3px rgba(92, 58, 26, 0.3)" };

type ProfileCardProps = {
  /** Opens the Account sheet, where these details are actually edited. */
  onPress: () => void;
};

/**
 * The account summary at the top of Settings — picture, name and email, read
 * straight off the Clerk user. Tapping it opens AccountSheet.
 */
export function ProfileCard({ onPress }: ProfileCardProps) {
  const colors = useColors();
  const t = useTranslation();
  const { user } = useUser();

  const displayName = user?.fullName?.trim();

  return (
    <AnimatedPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t.profile.editAccount}
      scaleTo={0.98}
      style={gradients.card}
      className="card card--cream-soft flex-row items-center gap-3 p-[16px]"
    >
      {/* Drawn like a task card: title-weight name, muted detail, chevron. The
          picture sits in a white ring, lifted off the card — 42dp, ring included. */}
      <View className="rounded-full border-2 border-white" style={AVATAR_SHADOW}>
        {user?.hasImage ? (
          <Image source={{ uri: user.imageUrl }} className="h-[38px] w-[38px] rounded-full" />
        ) : (
          <View className="h-[38px] w-[38px] items-center justify-center rounded-full bg-cream-200">
            <Feather name="user" size={20} color={colors.ink.creamMuted} />
          </View>
        )}
      </View>

      <View className="flex-1 gap-0.5">
        <Text
          numberOfLines={1}
          className={
            displayName
              ? "font-grotesk-bold text-[17px] leading-[22px] text-ink-cream"
              : "font-grotesk-bold text-[17px] leading-[22px] text-ink-cream-muted"
          }
        >
          {displayName || t.profile.addName}
        </Text>
        <Text numberOfLines={1} className="font-grotesk-medium text-sm text-ink-cream-muted">
          {user?.primaryEmailAddress?.emailAddress ?? ""}
        </Text>
      </View>

      <Feather name="chevron-right" size={16} color={colors.ink.creamSubtle} />
    </AnimatedPressable>
  );
}
