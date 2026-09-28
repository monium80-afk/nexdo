import { useClerk } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import { useState, type ReactNode } from "react";
import { Alert, Linking, Platform, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AccountSheet } from "@/components/AccountSheet";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { ProfileCard } from "@/components/ProfileCard";
import { SUPPORT_LINKS } from "@/constants/support";
import { colors } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import { requestNotificationPermission } from "@/lib/notifications";
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

const APP_VERSION = Constants.expoConfig?.version ?? "1.0.0";

/** "09:00" → a Date today at 09:00, which is what the picker works in. */
function timeToDate(value: string): Date {
  const [hours, minutes] = value.split(":").map(Number);
  const date = new Date();
  date.setHours(hours || 0, minutes || 0, 0, 0);
  return date;
}

function dateToTime(date: Date): string {
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

/** An eyebrow plus whatever cards the section holds. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const rtl = useRtlText();
  return (
    <View className="gap-3">
      <Text className="eyebrow text-ink-charcoal-muted" style={rtl}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function Divider() {
  return <View className="h-px bg-white/10" />;
}

/** Label + explanation on the left, a switch on the right. */
function ToggleRow({
  label,
  body,
  value,
  onValueChange,
}: {
  label: string;
  body: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
}) {
  const rtl = useRtlText();
  return (
    <View className="flex-row items-center gap-3">
      <View className="flex-1 gap-1">
        <Text className="font-grotesk-semibold text-base text-ink-charcoal" style={rtl}>
          {label}
        </Text>
        <Text className="font-grotesk-medium text-sm text-ink-charcoal-muted" style={rtl}>
          {body}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.charcoal[600], true: colors.orange[500] }}
        thumbColor={colors.cream[50]}
        ios_backgroundColor={colors.charcoal[600]}
        accessibilityLabel={label}
      />
    </View>
  );
}

/** A tappable row inside a card: icon, label, optional explanation. */
function ActionRow({
  icon,
  label,
  body,
  destructive = false,
  disabled = false,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  body?: string;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const rtl = useRtlText();
  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      className="flex-row items-center gap-3"
      style={disabled ? { opacity: 0.6 } : undefined}
    >
      <Feather name={icon} size={18} color={destructive ? colors.overdue[500] : colors.ink.charcoal} />
      <View className="flex-1 gap-1">
        <Text
          className={
            destructive
              ? "font-grotesk-semibold text-base text-overdue-500"
              : "font-grotesk-semibold text-base text-ink-charcoal"
          }
          style={rtl}
        >
          {label}
        </Text>
        {body ? (
          <Text className="font-grotesk-medium text-sm text-ink-charcoal-muted" style={rtl}>
            {body}
          </Text>
        ) : null}
      </View>
      {/* A chevron reads as "this opens something" — wrong on a row that
          destroys data, and those rows say what they do already. */}
      {destructive ? null : <Feather name="chevron-right" size={18} color={colors.ink.charcoalMuted} />}
    </AnimatedPressable>
  );
}

export default function Settings() {
  const t = useTranslation();
  const rtl = useRtlText();
  const { signOut } = useClerk();
  const handleChatSignOut = useChatStore((state) => state.handleSignOut);
  const handleTaskSignOut = useTaskStore((state) => state.handleSignOut);
  const saveUnsyncedTasks = useTaskStore((state) => state.saveUnsyncedTasks);
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const language = useSettingsStore((state) => state.language);
  const setLanguage = useSettingsStore((state) => state.setLanguage);
  const aiAutoMode = useSettingsStore((state) => state.aiAutoMode);
  const setAiAutoMode = useSettingsStore((state) => state.setAiAutoMode);
  const dailyNudgeEnabled = useSettingsStore((state) => state.dailyNudgeEnabled);
  const setDailyNudgeEnabled = useSettingsStore((state) => state.setDailyNudgeEnabled);
  const dailyNudgeTime = useSettingsStore((state) => state.dailyNudgeTime);
  const setDailyNudgeTime = useSettingsStore((state) => state.setDailyNudgeTime);
  const overdueAlertsEnabled = useSettingsStore((state) => state.overdueAlertsEnabled);
  const setOverdueAlertsEnabled = useSettingsStore((state) => state.setOverdueAlertsEnabled);
  const clearChatHistory = useChatStore((state) => state.clearHistory);

  const [accountOpen, setAccountOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [historyStatus, setHistoryStatus] = useState<string | null>(null);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const nudgeTimeLabel = timeToDate(dailyNudgeTime).toLocaleTimeString(t.locale, {
    hour: "2-digit",
    minute: "2-digit",
  });

  const handleSelectLanguage = (value: AppLanguage) => {
    setLanguage(value);
    posthog.capture("language_changed", { language: value });
  };

  const handleTimeChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === "android") setShowTimePicker(false);
    if (event.type === "dismissed" || !selected) return;
    setDailyNudgeTime(dateToTime(selected));
  };

  const handleOverdueAlertsChange = async (enabled: boolean) => {
    if (!enabled) {
      setOverdueAlertsEnabled(false);
      return;
    }
    // Asked right as the user turns alerts on, while it's obvious why Nexdo
    // wants to notify them. The switch stays off until the phone says yes.
    if (await requestNotificationPermission()) {
      setOverdueAlertsEnabled(true);
      return;
    }
    Alert.alert(t.settings.notificationsBlockedTitle, t.settings.notificationsBlockedBody, [
      { text: t.common.cancel, style: "cancel" },
      { text: t.settings.openPhoneSettings, onPress: () => Linking.openSettings() },
    ]);
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

  const handleOpenLink = async (url: string) => {
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch (error) {
      console.warn("[Settings] couldn't open link", error);
      Alert.alert(t.settings.linkError);
    }
  };

  const signOutNow = async () => {
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

  // Signing out never deletes tasks: the account keeps them for the next
  // sign-in. This is the last moment the app can still save any change that
  // hasn't reached the account yet, so it tries once more first. Anything
  // still unsaved stays on this phone (useTaskStore.handleSignOut) — the
  // question is only whether to wait for a better connection.
  const handleSignOut = async () => {
    setIsSigningOut(true);
    setSignOutError(null);
    const unsaved = await saveUnsyncedTasks();
    if (unsaved === 0) {
      await signOutNow();
      return;
    }
    setIsSigningOut(false);
    Alert.alert(t.settings.unsavedTasksTitle, t.settings.unsavedTasksBody(unsaved), [
      { text: t.common.cancel, style: "cancel" },
      { text: t.settings.signOutAnyway, onPress: () => signOutNow() },
    ]);
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

        <Section title={t.settings.account}>
          <ProfileCard onPress={() => setAccountOpen(true)} />

          <View className="card card--charcoal p-4">
            <AnimatedPressable
              onPress={handleSignOut}
              disabled={isSigningOut}
              accessibilityRole="button"
              className="flex-row items-center gap-3"
              style={isSigningOut ? { opacity: 0.6 } : undefined}
            >
              <Feather name="log-out" size={18} color={colors.overdue[500]} />
              <Text className="flex-1 font-grotesk-semibold text-base text-overdue-500" style={rtl}>
                {isSigningOut ? t.settings.signingOut : t.settings.signOut}
              </Text>
            </AnimatedPressable>
          </View>

          {signOutError ? (
            <Text className="font-grotesk-medium text-sm text-overdue-500" style={rtl}>
              {signOutError}
            </Text>
          ) : null}
        </Section>

        <Section title={t.settings.aiChat}>
          <View className="card card--charcoal gap-4 p-4">
            <ToggleRow
              label={t.settings.autoMode}
              body={t.settings.autoModeBody}
              value={aiAutoMode}
              onValueChange={setAiAutoMode}
            />

            <Divider />

            <ActionRow icon="trash-2" label={t.settings.clearHistory} destructive onPress={handleClearHistory} />

            {historyStatus ? (
              <Text className="font-grotesk-medium text-sm text-ink-charcoal-muted" style={rtl}>
                {historyStatus}
              </Text>
            ) : null}
          </View>
        </Section>

        <Section title={t.settings.notifications}>
          <View className="card card--charcoal gap-4 p-4">
            <ToggleRow
              label={t.settings.dailyNudge}
              body={t.settings.dailyNudgeBody}
              value={dailyNudgeEnabled}
              onValueChange={setDailyNudgeEnabled}
            />

            {dailyNudgeEnabled ? (
              <View className="gap-3">
                <AnimatedPressable
                  onPress={() => setShowTimePicker((open) => !open)}
                  accessibilityRole="button"
                  className="choice choice--charcoal flex-row items-center gap-3 px-3.5 py-3"
                >
                  <Feather name="clock" size={16} color={colors.orange[500]} />
                  <Text className="flex-1 font-grotesk-medium text-sm text-ink-charcoal" style={rtl}>
                    {t.settings.nudgeTime}
                  </Text>
                  <Text className="font-grotesk-bold text-sm text-orange-500">{nudgeTimeLabel}</Text>
                </AnimatedPressable>

                {showTimePicker ? (
                  <DateTimePicker
                    value={timeToDate(dailyNudgeTime)}
                    mode="time"
                    display={Platform.OS === "ios" ? "spinner" : "default"}
                    themeVariant="dark"
                    textColor={colors.ink.charcoal}
                    accentColor={colors.orange[500]}
                    onChange={handleTimeChange}
                  />
                ) : null}
              </View>
            ) : null}

            <Divider />

            <ToggleRow
              label={t.settings.overdueAlerts}
              body={t.settings.overdueAlertsBody}
              value={overdueAlertsEnabled}
              onValueChange={handleOverdueAlertsChange}
            />

            <Text className="font-grotesk-regular text-xs text-ink-charcoal-muted" style={rtl}>
              {t.settings.notificationsNote}
            </Text>
          </View>
        </Section>

        <Section title={t.settings.appearance}>
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

            <Divider />

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
        </Section>

        <Section title={t.settings.support}>
          <View className="card card--charcoal gap-4 p-4">
            <ActionRow
              icon="help-circle"
              label={t.settings.help}
              body={t.settings.helpBody}
              onPress={() => handleOpenLink(SUPPORT_LINKS.helpCenter)}
            />

            <Divider />

            <ActionRow
              icon="shield"
              label={t.settings.privacy}
              onPress={() => handleOpenLink(SUPPORT_LINKS.privacyPolicy)}
            />

            <Divider />

            <ActionRow
              icon="file-text"
              label={t.settings.terms}
              onPress={() => handleOpenLink(SUPPORT_LINKS.termsOfService)}
            />
          </View>

          <Text className="text-center font-grotesk-medium text-xs text-ink-charcoal-muted">
            {t.settings.version(APP_VERSION)}
          </Text>
        </Section>
      </ScrollView>

      <AccountSheet visible={accountOpen} onClose={() => setAccountOpen(false)} />
    </SafeAreaView>
  );
}
