import { Fragment } from "react";
import { ScrollView, Text, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { SheetIcon } from "@/components/addSheet/SheetParts";
import { PaperSheet } from "@/components/PaperSheet";
import { colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/useTranslation";
import type { AppLanguage } from "@/types/settings";

const P = colors.palette;

/** Each language in its own name (so someone who reads it finds it), and in English beside it. */
export const LANGUAGE_OPTIONS: { value: AppLanguage; label: string; english: string }[] = [
  { value: "en", label: "English", english: "English" },
  { value: "fr", label: "Français", english: "French" },
  { value: "es", label: "Español", english: "Spanish" },
  { value: "ar", label: "العربية", english: "Arabic" },
  { value: "de", label: "Deutsch", english: "German" },
  { value: "zh", label: "简体中文", english: "Chinese" },
  { value: "hi", label: "हिन्दी", english: "Hindi" },
  { value: "pt", label: "Português (Brasil)", english: "Portuguese" },
  { value: "bn", label: "বাংলা", english: "Bengali" },
  { value: "ru", label: "Русский", english: "Russian" },
];

/** Settings → Language: the ten languages in one card, the current one ticked. */
export function LanguageSheet({
  visible,
  value,
  onChange,
  onClose,
}: {
  visible: boolean;
  value: AppLanguage;
  onChange: (language: AppLanguage) => void;
  onClose: () => void;
}) {
  const t = useTranslation();
  return (
    <PaperSheet visible={visible} onClose={onClose}>
      <Text accessibilityRole="header" style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 22, letterSpacing: -0.3, color: P.ink, marginBottom: 14 }}>
        {t.redesign.language}
      </Text>
      <ScrollView style={{ flexGrow: 0 }} showsVerticalScrollIndicator={false}>
        <View style={{ borderRadius: 22, backgroundColor: P.paperCard, paddingHorizontal: 16 }} accessibilityRole="radiogroup">
          {LANGUAGE_OPTIONS.map((option, index) => {
            const picked = option.value === value;
            return (
              <Fragment key={option.value}>
                {index > 0 ? <View style={{ height: 1, backgroundColor: "#EADFD1" }} /> : null}
                <AnimatedPressable
                  onPress={() => {
                    onChange(option.value);
                    onClose();
                  }}
                  scaleTo={0.99}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: picked }}
                  style={{ height: 48.5, flexDirection: "row", alignItems: "center", gap: 12 }}
                >
                  <Text style={{ flex: 1, fontFamily: "SpaceGrotesk-Medium", fontSize: 15.5, color: P.ink }}>{option.label}</Text>
                  {option.english !== option.label ? (
                    <Text style={{ fontFamily: "SpaceGrotesk-Regular", fontSize: 13, color: P.inkMuted }}>{option.english}</Text>
                  ) : null}
                  <View style={{ width: 24, height: 24 }}>
                    {picked ? (
                      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: P.accent, alignItems: "center", justifyContent: "center" }}>
                        <SheetIcon name="check" size={13} color="#FFFFFF" strokeWidth={3} />
                      </View>
                    ) : null}
                  </View>
                </AnimatedPressable>
              </Fragment>
            );
          })}
        </View>
      </ScrollView>
    </PaperSheet>
  );
}
