import { FontAwesome } from "@expo/vector-icons";
import { ActivityIndicator, Text } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { GoogleIcon } from "@/components/icons/GoogleIcon";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";

type SocialAuthButtonProps = {
  provider: "google" | "apple";
  onPress?: () => void;
  disabled?: boolean;
  /** Swaps the provider icon for a spinner while this provider's flow runs. */
  loading?: boolean;
};

export function SocialAuthButton({ provider, onPress, disabled, loading }: SocialAuthButtonProps) {
  const colors = useColors();
  const t = useTranslation();
  const isApple = provider === "apple";
  const iconColor = isApple ? colors.onAccent : colors.ink.cream;

  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      accessibilityState={{ disabled, busy: loading }}
      className={`btn flex-row items-center justify-center gap-3 ${
        isApple ? "btn--charcoal-solid" : "bg-cream-50 btn--secondary-cream"
      }`}
      style={disabled ? { opacity: 0.6 } : null}
    >
      {loading ? (
        <ActivityIndicator size="small" color={iconColor} />
      ) : isApple ? (
        <FontAwesome name="apple" size={20} color={iconColor} />
      ) : (
        <GoogleIcon size={18} />
      )}
      <Text
        className={`font-grotesk-bold text-base ${
          isApple ? "text-on-accent" : "text-ink-cream"
        }`}
      >
        {isApple ? t.auth.continueWithApple : t.auth.continueWithGoogle}
      </Text>
    </AnimatedPressable>
  );
}
