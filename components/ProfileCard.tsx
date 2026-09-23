import { useUser } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { Image, Text, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/useTranslation";

type ProfileCardProps = {
  /** Opens the Account sheet, where these details are actually edited. */
  onPress: () => void;
};

/**
 * The account summary at the top of Settings — picture, name and email, read
 * straight off the Clerk user. Tapping it opens AccountSheet.
 */
export function ProfileCard({ onPress }: ProfileCardProps) {
  const t = useTranslation();
  const { user } = useUser();

  const displayName = user?.fullName?.trim();

  return (
    <AnimatedPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t.profile.editAccount}
      className="card card--charcoal flex-row items-center gap-4 p-4"
    >
      {user?.hasImage ? (
        <Image source={{ uri: user.imageUrl }} className="h-14 w-14 rounded-full border-2 border-orange-500" />
      ) : (
        <View className="h-14 w-14 items-center justify-center rounded-full border-2 border-orange-500 bg-charcoal-600">
          <Feather name="user" size={22} color={colors.ink.charcoal} />
        </View>
      )}

      <View className="flex-1 gap-0.5">
        <Text
          numberOfLines={1}
          className={
            displayName
              ? "font-grotesk-semibold text-base text-ink-charcoal"
              : "font-grotesk-semibold text-base text-ink-charcoal-muted"
          }
        >
          {displayName || t.profile.addName}
        </Text>
        <Text numberOfLines={1} className="font-grotesk-regular text-sm text-ink-charcoal-muted">
          {user?.primaryEmailAddress?.emailAddress ?? ""}
        </Text>
      </View>

      <Feather name="chevron-right" size={20} color={colors.ink.charcoalMuted} />
    </AnimatedPressable>
  );
}
