import { useClerk } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import Constants from "expo-constants";
import { useFocusEffect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Alert, Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { PAYWALL_RESULT } from "react-native-purchases-ui";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { AccountSheet } from "@/components/AccountSheet";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import type { FeatherIconName } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { IconTile } from "@/components/IconTile";
import { ProfileCard } from "@/components/ProfileCard";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useTabBarHeight } from "@/components/TabBar";
import { SUPPORT_LINKS } from "@/constants/support";
import { MOTION, gradients } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";
import { useColors, useThemeScheme } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { getNotificationPermission, requestNotificationPermission, type NotificationPermission } from "@/lib/notifications";
import { posthog } from "@/lib/posthog";
import {
  isPurchasesEnabled,
  presentCustomerCenter,
  presentProPaywall,
  resetPurchaser,
  restorePurchases,
} from "@/lib/purchases";
import { REMINDER_OFFSET_OPTIONS } from "@/lib/reminders";
import { useChatStore } from "@/store/useChatStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useSubscriptionStore } from "@/store/useSubscriptionStore";
import { useTaskStore } from "@/store/useTaskStore";
import type { AppLanguage } from "@/types/settings";

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

/** A section: a frosted tray holding its eyebrow and the cards under it. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const rtl = useRtlText();
  return (
    <View className="tray gap-3 px-2.5 pb-2.5 pt-4">
      <Text className="eyebrow px-3.5 text-ink-cream-muted" style={rtl}>
        {title}
      </Text>
      {children}
    </View>
  );
}

/** The card a section's rows sit in — the task list's card. */
function Group({ children }: { children: ReactNode }) {
  return (
    <View className="card card--cream-soft gap-4 p-[16px]" style={gradients.card}>
      {children}
    </View>
  );
}

/**
 * Starts under a row's label rather than its tile, so rows read as one list.
 * 46.5 = the 36dp tile + the row's gap-3.
 */
function Divider() {
  return <View className="ml-[46.5px] h-px bg-cream-200" />;
}

/** Controls that belong to the row above them, indented to its label. */
function RowDetails({ children }: { children: ReactNode }) {
  return <View className="gap-3 pl-[46.5px]">{children}</View>;
}

function ToggleControl({ label, value, onValueChange }: { label: string; value: boolean; onValueChange: (next: boolean) => void }) {
  const progress = useSharedValue(value ? 1 : 0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    progress.value = withTiming(value ? 1 : 0, {
      duration: reduceMotion ? 0 : MOTION.duration.standard,
      easing: MOTION.easing.standard,
    });
  }, [progress, reduceMotion, value]);

  // A gradient can't be colour-interpolated, so the lit track fades in over
  // the resting one instead.
  const litStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  // 16 = the 42dp track − its two 1dp edges − 2dp padding each side − the 20dp thumb.
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * 16 }],
  }));

  const toggle = () => {
    const next = !value;
    // eslint-disable-next-line react-hooks/immutability
    progress.value = withTiming(next ? 1 : 0, {
      duration: reduceMotion ? 0 : MOTION.duration.standard,
      easing: MOTION.easing.standard,
    });
    onValueChange(next);
  };

  return (
    <Pressable
      onPress={toggle}
      hitSlop={6}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      className="h-10 items-center justify-center"
    >
      {/* Flat rather than pressed in: an inset shadow per switch was a real
          cost on Android, and the darker edge reads as a track on its own. */}
      <View className="h-7 w-12 justify-center rounded-full border border-cream-300 bg-cream-200/60 px-[2px]">
        {/* Over the edge too, so a switched-on track is orange right to its
            rim. Its glow only while it's on — hidden, it still cost a shadow. */}
        <Animated.View className="absolute -inset-px rounded-full" style={[gradients.accent, value ? TRACK_GLOW : null, litStyle]} />
        <Animated.View className="h-[20px] w-[20px] rounded-full bg-white" style={[THUMB_SHADOW, thumbStyle]} />
      </View>
    </Pressable>
  );
}

// The lit track glows onto the card; the thumb sits up on it.
const TRACK_GLOW = { boxShadow: "0 4px 12px -4px rgba(236, 86, 28, 0.6)" };
const THUMB_SHADOW = { boxShadow: "0 2px 5px rgba(60, 30, 10, 0.25)" };

/** Tile, label + explanation, and a switch on the right. */
function ToggleRow({
  icon,
  label,
  body,
  value,
  onValueChange,
}: {
  /** Left out on a row nested under another row's label, which has no room for one. */
  icon?: FeatherIconName;
  label: string;
  body: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
}) {
  const rtl = useRtlText();
  return (
    <View className="flex-row items-center gap-3">
      {icon ? <IconTile icon={icon} /> : null}
      <View className="flex-1 gap-1">
        <Text className="font-grotesk-bold text-base text-ink-cream" style={rtl}>
          {label}
        </Text>
        <Text className="font-grotesk-medium text-sm text-ink-cream-muted" style={rtl}>
          {body}
        </Text>
      </View>
      <ToggleControl label={label} value={value} onValueChange={onValueChange} />
    </View>
  );
}

/** A tappable row inside a card: tile, label, optional explanation, chevron. */
function ActionRow({
  icon,
  label,
  body,
  disabled = false,
  onPress,
}: {
  icon: FeatherIconName;
  label: string;
  body?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const rtl = useRtlText();
  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      className={`flex-row items-center gap-3 ${disabled ? "opacity-40" : ""}`}
    >
      <IconTile icon={icon} tone="neutral" />
      <View className="flex-1 gap-1">
        <Text className="font-grotesk-bold text-base text-ink-cream" style={rtl}>
          {label}
        </Text>
        {body ? (
          <Text className="font-grotesk-medium text-sm text-ink-cream-muted" style={rtl}>
            {body}
          </Text>
        ) : null}
      </View>
      <Feather name="chevron-right" size={16} color={colors.ink.creamSubtle} />
    </AnimatedPressable>
  );
}

/**
 * A row that ends or destroys something (Sign out, Clear chat history): its
 * own red-tinted card, so it can't be mistaken for a setting.
 */
function DangerRow({
  icon,
  label,
  disabled = false,
  onPress,
}: {
  icon: FeatherIconName;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const rtl = useRtlText();
  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      scaleTo={0.98}
      style={gradients.danger}
      className={`card card--danger flex-row items-center gap-3 px-[16px] py-[10px] ${disabled ? "opacity-40" : ""}`}
    >
      <IconTile icon={icon} tone="red" size="sm" />
      <Text className="flex-1 font-grotesk-bold text-base text-overdue-500" style={rtl}>
        {label}
      </Text>
      <Feather name="chevron-right" size={16} color={colors.overdue[500]} />
    </AnimatedPressable>
  );
}

export default function Settings() {
  const colors = useColors();
  const scheme = useThemeScheme();
  const t = useTranslation();
  const rtl = useRtlText();
  const { signOut } = useClerk();
  const handleChatSignOut = useChatStore((state) => state.handleSignOut);
  const handleTaskSignOut = useTaskStore((state) => state.handleSignOut);
  const saveUnsyncedTasks = useTaskStore((state) => state.saveUnsyncedTasks);
  const language = useSettingsStore((state) => state.language);
  const setLanguage = useSettingsStore((state) => state.setLanguage);
  const aiAutoMode = useSettingsStore((state) => state.aiAutoMode);
  const setAiAutoMode = useSettingsStore((state) => state.setAiAutoMode);
  const voiceAddButton = useSettingsStore((state) => state.voiceAddButton);
  const setVoiceAddButton = useSettingsStore((state) => state.setVoiceAddButton);
  const dailyNudgeEnabled = useSettingsStore((state) => state.dailyNudgeEnabled);
  const setDailyNudgeEnabled = useSettingsStore((state) => state.setDailyNudgeEnabled);
  const dailyNudgeTime = useSettingsStore((state) => state.dailyNudgeTime);
  const setDailyNudgeTime = useSettingsStore((state) => state.setDailyNudgeTime);
  const overdueAlertsEnabled = useSettingsStore((state) => state.overdueAlertsEnabled);
  const setOverdueAlertsEnabled = useSettingsStore((state) => state.setOverdueAlertsEnabled);
  const deadlineRemindersEnabled = useSettingsStore((state) => state.deadlineRemindersEnabled);
  const setDeadlineRemindersEnabled = useSettingsStore((state) => state.setDeadlineRemindersEnabled);
  const dayReminderTime = useSettingsStore((state) => state.dayReminderTime);
  const setDayReminderTime = useSettingsStore((state) => state.setDayReminderTime);
  const reminderOffsets = useSettingsStore((state) => state.reminderOffsets);
  const toggleReminderOffset = useSettingsStore((state) => state.toggleReminderOffset);
  const importantExtraReminder = useSettingsStore((state) => state.importantExtraReminder);
  const setImportantExtraReminder = useSettingsStore((state) => state.setImportantExtraReminder);
  const clearChatHistory = useChatStore((state) => state.clearHistory);
  const pro = useSubscriptionStore((state) => state.pro);
  const tabBarHeight = useTabBarHeight();
  useStatusBarStyle("light");

  const [accountOpen, setAccountOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [historyStatus, setHistoryStatus] = useState<string | null>(null);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showReminderTimePicker, setShowReminderTimePicker] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("undetermined");

  // Checked again whenever Settings comes into view — the user may have just
  // changed it in the phone's own settings.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      getNotificationPermission().then((value) => {
        if (active) setPermission(value);
      });
      return () => {
        active = false;
      };
    }, []),
  );

  const nudgeTimeLabel = timeToDate(dailyNudgeTime).toLocaleTimeString(t.locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const reminderTimeLabel = timeToDate(dayReminderTime).toLocaleTimeString(t.locale, {
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

  // Asked right as the user turns a kind of notification on, while it's
  // obvious why Nexdo wants to notify them. The switch stays off until the
  // phone says yes; if the phone won't ask again, the way to its settings is shown.
  const enableWithPermission = async (enable: () => void) => {
    const granted = await requestNotificationPermission();
    setPermission(await getNotificationPermission());
    if (granted) {
      enable();
      return;
    }
    Alert.alert(t.settings.notificationsBlockedTitle, t.settings.notificationsBlockedBody, [
      { text: t.common.cancel, style: "cancel" },
      { text: t.settings.openPhoneSettings, onPress: () => Linking.openSettings() },
    ]);
  };

  const handleOverdueAlertsChange = async (enabled: boolean) => {
    if (!enabled) {
      setOverdueAlertsEnabled(false);
      return;
    }
    await enableWithPermission(() => setOverdueAlertsEnabled(true));
  };

  const handleDeadlineRemindersChange = async (enabled: boolean) => {
    if (!enabled) {
      setDeadlineRemindersEnabled(false);
      return;
    }
    await enableWithPermission(() => setDeadlineRemindersEnabled(true));
  };

  const handleDailyNudgeChange = async (enabled: boolean) => {
    if (!enabled) {
      setDailyNudgeEnabled(false);
      return;
    }
    await enableWithPermission(() => setDailyNudgeEnabled(true));
  };

  const handleReminderTimeChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === "android") setShowReminderTimePicker(false);
    if (event.type === "dismissed" || !selected) return;
    setDayReminderTime(dateToTime(selected));
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

  // Under the Pro row: when the plan renews, or — once cancelled — when Pro
  // ends. A plan without an end date is simply active.
  const proExpiry = pro?.expirationDate
    ? new Date(pro.expirationDate).toLocaleDateString(t.locale, { day: "numeric", month: "short", year: "numeric" })
    : null;
  const proStatus = !proExpiry ? t.settings.proActive : pro?.willRenew ? t.settings.proRenews(proExpiry) : t.settings.proEnds(proExpiry);

  // Buying, and any error while buying, happens inside RevenueCat's paywall;
  // only a paywall that couldn't open at all is left to explain here.
  const handleUpgrade = async () => {
    const result = await presentProPaywall();
    if (result === PAYWALL_RESULT.ERROR) Alert.alert(t.settings.upgradeError);
  };

  const handleRestore = async () => {
    setIsRestoring(true);
    const outcome = await restorePurchases();
    setIsRestoring(false);
    const messages = {
      restored: t.settings.restoreDone,
      nothing: t.settings.restoreNothing,
      offline: t.settings.restoreOffline,
      error: t.settings.restoreError,
    };
    Alert.alert(messages[outcome]);
  };

  const handleManageSubscription = async () => {
    if (!(await presentCustomerCenter())) Alert.alert(t.settings.manageError);
  };

  const signOutNow = async () => {
    setIsSigningOut(true);
    setSignOutError(null);
    try {
      await signOut();
      // Only once it worked: a failed sign-out leaves the user signed in, and
      // their later events should still carry who they are.
      posthog.capture('user_signed_out')
      posthog.reset()
      const cleanupResults = await Promise.allSettled([
        Promise.resolve().then(() => handleChatSignOut()),
        Promise.resolve().then(() => handleTaskSignOut()),
        resetPurchaser(),
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
      <ScreenHeader title={t.settings.title} subtitle={t.settings.subtitle} />

      <View className="screen-body">
        <View pointerEvents="none" className="absolute inset-0" style={gradients.pageGlow} />
        <ScrollView
          // Clear of the tab bar, which floats over the foot of the page.
          contentContainerStyle={{ paddingBottom: 40 + tabBarHeight }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="gap-4 px-3 pt-3">
            <Section title={t.settings.account}>
              <ProfileCard onPress={() => setAccountOpen(true)} />

              <DangerRow
                icon="log-out"
                label={isSigningOut ? t.settings.signingOut : t.settings.signOut}
                disabled={isSigningOut}
                onPress={handleSignOut}
              />

              {signOutError ? (
                <Text className="px-3.5 font-grotesk-medium text-sm text-overdue-500" style={rtl}>
                  {signOutError}
                </Text>
              ) : null}
            </Section>

            {isPurchasesEnabled ? (
              <Section title={t.settings.pro}>
                <Group>
                  {pro ? (
                    <ActionRow
                      icon="award"
                      label={t.settings.manageSubscription}
                      body={proStatus}
                      onPress={handleManageSubscription}
                    />
                  ) : (
                    <>
                      <ActionRow icon="star" label={t.settings.upgrade} body={t.settings.upgradeBody} onPress={handleUpgrade} />

                      <Divider />

                      <ActionRow
                        icon="rotate-ccw"
                        label={isRestoring ? t.settings.restoring : t.settings.restorePurchases}
                        disabled={isRestoring}
                        onPress={handleRestore}
                      />
                    </>
                  )}
                </Group>
              </Section>
            ) : null}

            <Section title={t.settings.aiChat}>
              <Group>
                <ToggleRow
                  icon="zap"
                  label={t.settings.autoMode}
                  body={t.settings.autoModeBody}
                  value={aiAutoMode}
                  onValueChange={setAiAutoMode}
                />

                <Divider />

                <ToggleRow
                  icon="mic"
                  label={t.settings.voiceButton}
                  body={t.settings.voiceButtonBody}
                  value={voiceAddButton}
                  onValueChange={setVoiceAddButton}
                />
              </Group>

              <DangerRow icon="trash-2" label={t.settings.clearHistory} onPress={handleClearHistory} />

              {historyStatus ? (
                <Text className="px-3.5 font-grotesk-medium text-sm text-ink-cream-muted" style={rtl}>
                  {historyStatus}
                </Text>
              ) : null}
            </Section>

            <Section title={t.settings.notifications}>
              <Group>
                {permission === "denied" ? (
                  <View className="gap-2">
                    <Text className="font-grotesk-medium text-sm text-overdue-500" style={rtl}>
                      {t.settings.notificationsDenied}
                    </Text>
                    <AnimatedPressable onPress={() => Linking.openSettings()} accessibilityRole="button" className="self-start">
                      <Text className="font-grotesk-semibold text-sm text-orange-600">{t.settings.openPhoneSettings}</Text>
                    </AnimatedPressable>
                  </View>
                ) : null}

                <ToggleRow
                  icon="bell"
                  label={t.settings.deadlineReminders}
                  body={t.settings.deadlineRemindersBody}
                  value={deadlineRemindersEnabled}
                  onValueChange={handleDeadlineRemindersChange}
                />

                {deadlineRemindersEnabled ? (
                  <RowDetails>
                    <AnimatedPressable
                      onPress={() => setShowReminderTimePicker((open) => !open)}
                      accessibilityRole="button"
                      className="card card--cream-inset min-h-[44px] flex-row items-center gap-2 px-4"
                    >
                      <Feather name="bell" size={14} color={colors.ink.creamMuted} />
                      <Text className="flex-1 font-grotesk-medium text-sm text-ink-cream" style={rtl}>
                        {t.settings.reminderTime}
                      </Text>
                      <Text className="font-grotesk-bold text-sm text-orange-600">{reminderTimeLabel}</Text>
                    </AnimatedPressable>

                    {showReminderTimePicker ? (
                      <DateTimePicker
                        value={timeToDate(dayReminderTime)}
                        mode="time"
                        display={Platform.OS === "ios" ? "spinner" : "default"}
                        themeVariant={scheme}
                        textColor={colors.ink.cream}
                        accentColor={colors.orange[500]}
                        onChange={handleReminderTimeChange}
                      />
                    ) : null}

                    <Text className="eyebrow text-ink-cream-muted" style={rtl}>
                      {t.settings.beforeDeadline}
                    </Text>
                    <View className="flex-row flex-wrap gap-2">
                      {REMINDER_OFFSET_OPTIONS.map((minutes) => (
                        <Chip
                          key={minutes}
                          label={t.settings.offsetChip(minutes)}
                          selected={reminderOffsets.includes(minutes)}
                          onPress={() => toggleReminderOffset(minutes)}
                        />
                      ))}
                    </View>

                    <ToggleRow
                      label={t.settings.importantReminder}
                      body={t.settings.importantReminderBody}
                      value={importantExtraReminder}
                      onValueChange={setImportantExtraReminder}
                    />
                  </RowDetails>
                ) : null}

                <Divider />

                <ToggleRow
                  icon="sun"
                  label={t.settings.dailyNudge}
                  body={t.settings.dailyNudgeBody}
                  value={dailyNudgeEnabled}
                  onValueChange={handleDailyNudgeChange}
                />

                {dailyNudgeEnabled ? (
                  <RowDetails>
                    {/* The picked time, shown like a filled field that opens the picker. */}
                    <AnimatedPressable
                      onPress={() => setShowTimePicker((open) => !open)}
                      accessibilityRole="button"
                      className="card card--cream-inset min-h-[44px] flex-row items-center gap-2 px-4"
                    >
                      <Feather name="clock" size={14} color={colors.ink.creamMuted} />
                      <Text className="flex-1 font-grotesk-medium text-sm text-ink-cream" style={rtl}>
                        {t.settings.nudgeTime}
                      </Text>
                      <Text className="font-grotesk-bold text-sm text-orange-600">{nudgeTimeLabel}</Text>
                    </AnimatedPressable>

                    {showTimePicker ? (
                      <DateTimePicker
                        value={timeToDate(dailyNudgeTime)}
                        mode="time"
                        display={Platform.OS === "ios" ? "spinner" : "default"}
                        themeVariant={scheme}
                        textColor={colors.ink.cream}
                        accentColor={colors.orange[500]}
                        onChange={handleTimeChange}
                      />
                    ) : null}
                  </RowDetails>
                ) : null}

                <Divider />

                <ToggleRow
                  icon="alert-triangle"
                  label={t.settings.overdueAlerts}
                  body={t.settings.overdueAlertsBody}
                  value={overdueAlertsEnabled}
                  onValueChange={handleOverdueAlertsChange}
                />

                <Text className="font-grotesk-medium text-sm text-ink-cream-muted" style={rtl}>
                  {t.settings.notificationsNote}
                </Text>
              </Group>
            </Section>

            <Section title={t.settings.appearance}>
              <Group>
                <View className="gap-3">
                  <View className="flex-row items-center gap-3">
                    <IconTile icon="globe" />
                    <Text className="flex-1 font-grotesk-bold text-base text-ink-cream" style={rtl}>
                      {t.settings.language}
                    </Text>
                  </View>
                  <View className="flex-row flex-wrap gap-2">
                    {LANGUAGE_OPTIONS.map((option) => (
                      <Chip
                        key={option.value}
                        label={option.label}
                        selected={language === option.value}
                        onPress={() => handleSelectLanguage(option.value)}
                        accessibilityRole="radio"
                      />
                    ))}
                  </View>
                </View>
              </Group>
            </Section>

            <Section title={t.settings.support}>
              <Group>
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
              </Group>

              <Text className="pb-1 text-center font-grotesk-medium text-sm text-ink-cream-subtle">
                {t.settings.version(APP_VERSION)}
              </Text>
            </Section>
          </View>
        </ScrollView>
      </View>

      <AccountSheet visible={accountOpen} onClose={() => setAccountOpen(false)} />
    </SafeAreaView>
  );
}
