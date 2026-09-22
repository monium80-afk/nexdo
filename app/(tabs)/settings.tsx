import { useClerk } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { Alert, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { ProfileCard } from "@/components/ProfileCard";
import { colors } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import { posthog } from "@/lib/posthog";
import { useChatStore } from "@/store/useChatStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTaskStore } from "@/store/useTaskStore";
import type { AppLanguage, ThemePreference } from "@/types/settings";

const THEME_OPTIONS: { value: ThemePreference; icon: keyof typeof Feather.glyphMap }[] = [
  { value: "light", icon: "sun" },
  { value: "dark", icon: "moon" },
  { value: "system", icon: "smartphone" },
];

// Each language is listed in its own name, so it's recognizable to someone who reads it.
const LANGUAGE_OPTIONS: { value: AppLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
  { value: "es", label: "Español" },
  { value: "ar", label: "العربية" },
  { value: "de", label: "Deutsch" },
];

export default function Settings() {
  const t = useTranslation();
  const rtl = useRtlText();
  const { signOut } = useClerk();
  const handleChatSignOut = useChatStore((state) => state.handleSignOut);
  const handleTaskSignOut = useTaskStore((state) => state.handleSignOut);
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const language = useSettingsStore((state) => state.language);
  const setLanguage = useSettingsStore((state) => state.setLanguage);
  const aiAutoMode = useSettingsStore((state) => state.aiAutoMode);
  const setAiAutoMode = useSettingsStore((state) => state.setAiAutoMode);
  const clearChatHistory = useChatStore((state) => state.clearHistory);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [historyStatus, setHistoryStatus] = useState<string | null>(null);

  const handleSelectLanguage = (value: AppLanguage) => {
    setLanguage(value);
    posthog.capture("language_changed", { language: value });
  };

  const handleClearHistory = () => {
    Alert.alert(t.settings.clearConfirmTitle, t.settings.clearConfirmBody, [
      { text: t.common.cancel, style: "cancel" },
      {
        text: t.settings.clear,
        style: "destructive",
        onPress: async () => {
          try {
            await clearChatHistory();
            setHistoryStatus(t.settings.historyCleared);
          } catch {
            setHistoryStatus(t.settings.historyClearFailed);
          }
        },
      },
    ]);
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);
    setSignOutError(null);
    try {
      posthog.capture('user_signed_out')
      posthog.reset()
      await signOut();
      const cleanupResults = await Promise.allSettled([
        Promise.resolve().then(() => handleChatSignOut()),
        Promise.resolve().then(() => handleTaskSignOut()),
      ]);
      if (cleanupResults.some((result) => result.status === "rejected")) {
        setSignOutError(t.settings.signOutCleanupError);
      }
    } catch {
      setSignOutError(t.settings.signOutError);
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.charcoal[900] }} edges={["top"]}>
      <ScrollView
        style={{ backgroundColor: colors.charcoal[900] }}
        contentContainerStyle={{ gap: 24, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-title text-ink-charcoal" style={rtl}>
          {t.settings.title}
        </Text>

        <ProfileCard />

        <View className="gap-3">
          <Text className="eyebrow text-ink-charcoal-muted" style={rtl}>
            {t.settings.aiChat}
          </Text>
          <View className="card card--charcoal gap-4 p-4">
            <View className="flex-row items-center gap-3">
              <View className="flex-1 gap-1">
                <Text className="font-grotesk-semibold text-base text-ink-charcoal" style={rtl}>
                  {t.settings.autoMode}
                </Text>
                <Text className="font-grotesk-medium text-sm text-ink-charcoal-muted" style={rtl}>
                  {t.settings.autoModeBody}
                </Text>
              </View>
              <Switch
                value={aiAutoMode}
                onValueChange={setAiAutoMode}
                trackColor={{ false: colors.charcoal[600], true: colors.orange[500] }}
                thumbColor={colors.cream[50]}
                ios_backgroundColor={colors.charcoal[600]}
                accessibilityLabel={t.settings.autoMode}
              />
            </View>

            <View className="h-px bg-white/10" />

            <AnimatedPressable onPress={handleClearHistory} className="flex-row items-center gap-3">
              <Feather name="trash-2" size={18} color={colors.overdue[500]} />
              <Text className="flex-1 font-grotesk-semibold text-base text-overdue-500">{t.settings.clearHistory}</Text>
            </AnimatedPressable>

            {historyStatus ? (
              <Text className="font-grotesk-medium text-sm text-ink-charcoal-muted" style={rtl}>
                {historyStatus}
              </Text>
            ) : null}
          </View>
        </View>

        <View className="gap-3">
          <Text className="eyebrow text-ink-charcoal-muted" style={rtl}>
            {t.settings.appearance}
          </Text>
          <View className="card card--charcoal gap-4 p-4">
            <View className="gap-3">
              <Text className="font-grotesk-semibold text-base text-ink-charcoal" style={rtl}>
                {t.settings.theme}
              </Text>
              <View className="flex-row gap-2">
                {THEME_OPTIONS.map((option) => {
                  const selected = theme === option.value;
                  return (
                    <AnimatedPressable
                      key={option.value}
                      onPress={() => setTheme(option.value)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      className={
                        selected
                          ? "choice choice--charcoal-selected flex-1 flex-row items-center justify-center gap-2 py-3"
                          : "choice choice--charcoal flex-1 flex-row items-center justify-center gap-2 py-3"
                      }
                    >
                      <Feather
                        name={option.icon}
                        size={15}
                        color={selected ? colors.orange[500] : colors.ink.charcoalMuted}
                      />
                      <Text
                        className={
                          selected
                            ? "font-grotesk-semibold text-sm text-orange-500"
                            : "font-grotesk-medium text-sm text-ink-charcoal"
                        }
                      >
                        {t.settings.themes[option.value]}
                      </Text>
                    </AnimatedPressable>
                  );
                })}
              </View>
            </View>

            <View className="h-px bg-white/10" />

            <View className="gap-3">
              <Text className="font-grotesk-semibold text-base text-ink-charcoal" style={rtl}>
                {t.settings.language}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {LANGUAGE_OPTIONS.map((option) => {
                  const selected = language === option.value;
                  return (
                    <AnimatedPressable
                      key={option.value}
                      onPress={() => handleSelectLanguage(option.value)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      className={
                        selected
                          ? "choice choice--charcoal-selected flex-row items-center gap-1.5 px-3.5 py-2.5"
                          : "choice choice--charcoal flex-row items-center gap-1.5 px-3.5 py-2.5"
                      }
                    >
                      {selected ? <Feather name="check" size={14} color={colors.orange[500]} /> : null}
                      <Text
                        className={
                          selected
                            ? "font-grotesk-semibold text-sm text-orange-500"
                            : "font-grotesk-medium text-sm text-ink-charcoal"
                        }
                      >
                        {option.label}
                      </Text>
                    </AnimatedPressable>
                  );
                })}
              </View>
            </View>
          </View>
        </View>

        <AnimatedPressable
          onPress={handleSignOut}
          disabled={isSigningOut}
          className="card card--charcoal flex-row items-center gap-3 p-4"
          style={isSigningOut ? { opacity: 0.6 } : undefined}
        >
          <Feather name="log-out" size={18} color={colors.overdue[500]} />
          <Text className="font-grotesk-semibold text-base text-overdue-500">
            {isSigningOut ? t.settings.signingOut : t.settings.signOut}
          </Text>
        </AnimatedPressable>

        {signOutError ? (
          <Text className="text-sm font-grotesk-medium text-overdue-500">
            {signOutError}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
