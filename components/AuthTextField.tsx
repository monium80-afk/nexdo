import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { Text, TextInput, View, type TextInputProps } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";

type AuthTextFieldProps = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  secureEntry?: boolean;
  keyboardType?: "email-address" | "default";
  autoComplete?: TextInputProps["autoComplete"];
};

export function AuthTextField({
  label,
  value,
  onChangeText,
  secureEntry = false,
  keyboardType = "default",
  autoComplete,
}: AuthTextFieldProps) {
  const colors = useColors();
  const t = useTranslation();
  const [hidden, setHidden] = useState(secureEntry);

  return (
    <View className="field gap-1">
      <Text className="eyebrow text-ink-cream-muted">{label}</Text>
      <View className="flex-row items-center">
        <TextInput
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={hidden}
          keyboardType={keyboardType}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect={false}
          className="flex-1 font-grotesk-medium text-base text-ink-cream"
        />
        {secureEntry ? (
          <AnimatedPressable
            onPress={() => setHidden((prev) => !prev)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={hidden ? t.auth.showPassword : t.auth.hidePassword}
          >
            <Feather
              name={hidden ? "eye" : "eye-off"}
              size={18}
              color={colors.ink.creamMuted}
            />
          </AnimatedPressable>
        ) : null}
      </View>
    </View>
  );
}
