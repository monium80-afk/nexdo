import { useClerk, useUser } from "@clerk/expo";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import Constants from "expo-constants";
import { useFocusEffect, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Fragment, useCallback, useMemo, useState, type ReactNode } from "react";
import { Image, Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AccountSheet } from "@/components/AccountSheet";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { SheetIcon } from "@/components/addSheet/SheetParts";
import { GemMascot } from "@/components/GemMascot";
import { LanguageSheet, LANGUAGE_OPTIONS } from "@/components/LanguageSheet";
import { useTabBarHeight } from "@/components/TabBar";
import { SUPPORT_LINKS } from "@/constants/support";
import { colors } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";
import { useToday } from "@/hooks/useToday";
import { useTranslation } from "@/hooks/useTranslation";
import { showAlert } from "@/lib/alert";
import { getNotificationPermission, requestNotificationPermission, type NotificationPermission } from "@/lib/notifications";
import { buildInsights } from "@/lib/pace";
import { openPaywall } from "@/lib/paywall";
import { displayLimit, isTimeMeter, PLAN_LIMITS, type Meter } from "@/lib/plan";
import { posthog } from "@/lib/posthog";
import {
  isPurchasesEnabled,
  openStoreSubscriptions,
  presentCustomerCenter,
  resetPurchaser,
  restorePurchases,
  resyncTrialReminder,
} from "@/lib/purchases";
import { entriesFor, useFocusLogStore } from "@/store/useFocusLogStore";
import { usePlanUsageStore } from "@/store/usePlanUsageStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useSubscriptionStore } from "@/store/useSubscriptionStore";
import { useTaskStore } from "@/store/useTaskStore";
import type { AppLanguage } from "@/types/settings";
import { shadow, SOFT_SHADOW } from "@/constants/shadow";

const P = colors.palette;
const APP_VERSION = Constants.expoConfig?.version ?? "1.0.0";
const TIGHT = { includeFontPadding: false } as const;
const CARD_SHADOW = SOFT_SHADOW;
const RULE = "#EADFD1";
/** On the dark plan card. */
const ON_DARK_MUTED = "#C9BDB2";
const ON_DARK_FAINT = "#A99D92";
const ON_DARK_TRACK = "#3A322C";
/** The three allowances the plan card shows. */
const CARD_METERS: Meter[] = ["live", "assist", "media"];

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

/** Days until the 1st of next month, when the allowances start again. */
function daysToReset(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((next.getTime() - today.getTime()) / 86_400_000);
}

/** "Monium Benmouna" → "MB". */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

/** A small uppercase section label, in Space Mono. */
function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <Text style={[{ fontFamily: "SpaceMono-Bold", fontSize: 10, lineHeight: 12, letterSpacing: 2, color: P.inkMuted }, TIGHT]}>
      {children}
    </Text>
  );
}

/** A list row on the page itself: label, an optional value, a ›. */
function Row({ label, value, onPress, disabled = false }: { label: string; value?: string; onPress: () => void; disabled?: boolean }) {
  const rtl = useRtlText();
  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      scaleTo={0.99}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      style={{ height: 54.5, flexDirection: "row", alignItems: "center", gap: 12, opacity: disabled ? 0.4 : 1 }}
    >
      <Text numberOfLines={1} style={[{ flex: 1, fontFamily: "SpaceGrotesk-Medium", fontSize: 16, color: P.ink }, TIGHT, rtl]}>
        {label}
      </Text>
      {value ? <Text style={[{ fontFamily: "SpaceGrotesk-Regular", fontSize: 15, color: P.inkMuted }, TIGHT]}>{value}</Text> : null}
      <SheetIcon name="chevronRight" size={17} color={P.inkFaint} />
    </AnimatedPressable>
  );
}

function RowList({ rows }: { rows: { key: string; label: string; value?: string; onPress: () => void; disabled?: boolean }[] }) {
  return (
    <View>
      {rows.map((row, index) => (
        <Fragment key={row.key}>
          {index > 0 ? <View style={{ height: 1, backgroundColor: RULE }} /> : null}
          <Row label={row.label} value={row.value} onPress={row.onPress} disabled={row.disabled} />
        </Fragment>
      ))}
    </View>
  );
}

/**
 * One of the three notification tiles: orange while on, light while off, and
 * what it does under its name. A plain Pressable: its colour follows `value`
 * straight away, with no press animation in the way.
 */
function NotificationTile({ title, body, value, onChange }: { title: string; body: string; value: boolean; onChange: (next: boolean) => unknown }) {
  return (
    <Pressable
      onPress={() => void onChange(!value)}
      accessibilityRole="switch"
      accessibilityLabel={`${title}. ${body}`}
      accessibilityState={{ checked: value }}
      style={({ pressed }) => [
        { flex: 1, minHeight: 124, borderRadius: 22, padding: 14, paddingBottom: 13, justifyContent: "space-between", backgroundColor: value ? P.accent : P.paperCard, opacity: pressed ? 0.85 : 1 },
        value ? shadow("0 8px 18px rgba(242, 106, 46, 0.3)", 6, "#F26A2E") : CARD_SHADOW,
      ]}
    >
      <View
        style={{
          width: 34,
          height: 20,
          borderRadius: 10,
          padding: 2,
          backgroundColor: value ? "rgba(255, 255, 255, 0.35)" : "#E7DCCF",
          alignItems: value ? "flex-end" : "flex-start",
        }}
      >
        <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: "#FFFFFF" }} />
      </View>
      <View>
        <Text numberOfLines={1} adjustsFontSizeToFit style={[{ fontFamily: "SpaceGrotesk-Bold", fontSize: 14.5, lineHeight: 19, color: value ? "#FFFFFF" : P.ink }, TIGHT]}>
          {title}
        </Text>
        <Text numberOfLines={3} style={[{ marginTop: 2, fontFamily: "SpaceGrotesk-Regular", fontSize: 11.5, lineHeight: 15, color: value ? P.onAccentSoft : P.inkMuted }, TIGHT]}>
          {body}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * Settings (2026-11 redesign, from the user's screenshots): who's signed in
 * and the Account button; the plan card with this month's allowances; this
 * week at a glance (→ Insights); the three notification switches; then
 * Preferences and Support as plain lists, and Sign out at the foot.
 */
export default function Settings() {
  const router = useRouter();
  const t = useTranslation();
  const rtl = useRtlText();
  const { user } = useUser();
  const { signOut } = useClerk();
  const handleTaskSignOut = useTaskStore((state) => state.handleSignOut);
  const saveUnsyncedTasks = useTaskStore((state) => state.saveUnsyncedTasks);
  const language = useSettingsStore((state) => state.language);
  const setLanguage = useSettingsStore((state) => state.setLanguage);
  const dailyNudgeEnabled = useSettingsStore((state) => state.dailyNudgeEnabled);
  const setDailyNudgeEnabled = useSettingsStore((state) => state.setDailyNudgeEnabled);
  const dailyNudgeTime = useSettingsStore((state) => state.dailyNudgeTime);
  const setDailyNudgeTime = useSettingsStore((state) => state.setDailyNudgeTime);
  const setDayReminderTime = useSettingsStore((state) => state.setDayReminderTime);
  const overdueAlertsEnabled = useSettingsStore((state) => state.overdueAlertsEnabled);
  const setOverdueAlertsEnabled = useSettingsStore((state) => state.setOverdueAlertsEnabled);
  const deadlineRemindersEnabled = useSettingsStore((state) => state.deadlineRemindersEnabled);
  const setDeadlineRemindersEnabled = useSettingsStore((state) => state.setDeadlineRemindersEnabled);
  // Unmarking the tour is all it takes: the tab bar starts it again (components/AppTour.tsx).
  const setTourSeen = useSettingsStore((state) => state.setTourSeen);
  const pro = useSubscriptionStore((state) => state.pro);
  const tabBarHeight = useTabBarHeight();
  const today = useToday();
  useStatusBarStyle("dark");

  const [accountOpen, setAccountOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
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

  // What the month has used of the plan, asked again each time Settings comes into view.
  const usagePlan = usePlanUsageStore((state) => state.plan);
  const usageUsed = usePlanUsageStore((state) => state.used);
  useFocusEffect(
    useCallback(() => {
      void usePlanUsageStore.getState().refresh();
    }, []),
  );

  // This week, from the phone's focus log (as on Insights).
  const userId = useTaskStore((state) => state.syncUserId);
  const tasks = useTaskStore((state) => state.tasks);
  const allEntries = useFocusLogStore((state) => state.entries);
  const allCompletions = useFocusLogStore((state) => state.completions);
  const week = useMemo(
    () => buildInsights(entriesFor(allEntries, userId), entriesFor(allCompletions, userId), tasks, "week"),
    [allEntries, allCompletions, tasks, userId],
  );
  const weekMax = Math.max(1, ...week.bars.map((bar) => bar.tasksDone));

  const name = user?.fullName?.trim() || user?.primaryEmailAddress?.emailAddress?.split("@")[0] || "";
  const firstName = name.split(/\s+/)[0] ?? "";
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const timeLabel = timeToDate(dailyNudgeTime).toLocaleTimeString(t.locale, { hour: "numeric", minute: "2-digit" });
  const languageName = LANGUAGE_OPTIONS.find((option) => option.value === language)?.label ?? "";

  const handleSelectLanguage = (value: AppLanguage) => {
    setLanguage(value);
    posthog.capture("language_changed", { language: value });
  };

  // One time for both: the daily plan and the reminder on a due day with no set time.
  const handleTimeChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === "android") setShowTimePicker(false);
    if (event.type === "dismissed" || !selected) return;
    setDailyNudgeTime(dateToTime(selected));
    setDayReminderTime(dateToTime(selected));
  };

  // A tile turns on the moment it's tapped (waiting on the phone's answer
  // first made it look broken, 2026-11-09). Then the phone is asked, if it
  // hasn't been; if it says no, the user is told and shown the way to its
  // settings — the red line under the tiles says so too, until it's allowed.
  const switchWith = (set: (on: boolean) => void) => async (enabled: boolean) => {
    set(enabled);
    if (!enabled) return;
    const granted = await requestNotificationPermission();
    const current = await getNotificationPermission();
    setPermission(current);
    if (granted) {
      resyncTrialReminder();
      return;
    }
    if (current === "unsupported") return;
    showAlert(t.settings.notificationsBlockedTitle, t.settings.notificationsBlockedBody, [
      { text: t.common.cancel, style: "cancel" },
      { text: t.settings.openPhoneSettings, onPress: () => Linking.openSettings() },
    ]);
  };

  const handleOpenLink = async (url: string) => {
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch (error) {
      console.warn("[Settings] couldn't open link", error);
      showAlert(t.settings.linkError);
    }
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
    showAlert(messages[outcome]);
  };

  // Android: Google Play's own subscriptions page, straight away — RevenueCat's
  // Customer Center could open nothing at all there (2026-11-09). iOS: the
  // Customer Center first, then the App Store's page.
  const handleManageSubscription = async () => {
    if (Platform.OS !== "android" && (await presentCustomerCenter())) return;
    if (!(await openStoreSubscriptions())) showAlert(t.settings.manageError);
  };

  const signOutNow = async () => {
    setIsSigningOut(true);
    setSignOutError(null);
    try {
      await signOut();
      posthog.capture("user_signed_out");
      posthog.reset();
      const cleanupResults = await Promise.allSettled([Promise.resolve().then(() => handleTaskSignOut()), resetPurchaser()]);
      if (cleanupResults.some((result) => result.status === "rejected")) setSignOutError(t.settings.signOutCleanupError);
    } catch {
      setSignOutError(t.settings.signOutError);
    } finally {
      setIsSigningOut(false);
    }
  };

  // Signing out never deletes tasks; anything not yet saved gets one more try first.
  const handleSignOut = async () => {
    setIsSigningOut(true);
    setSignOutError(null);
    const unsaved = await saveUnsyncedTasks();
    if (unsaved === 0) {
      await signOutNow();
      return;
    }
    setIsSigningOut(false);
    showAlert(t.settings.unsavedTasksTitle, t.settings.unsavedTasksBody(unsaved), [
      { text: t.common.cancel, style: "cancel" },
      { text: t.settings.signOutAnyway, onPress: () => signOutNow() },
    ]);
  };

  // The plan card's line: when Pro renews (or ends), and when the allowances start again.
  const now = new Date();
  const resets = t.redesign.resetsIn(daysToReset(now));
  const expiry = pro?.expirationDate ? new Date(pro.expirationDate).toLocaleDateString(t.locale, { month: "short", day: "numeric" }) : null;
  const planLine = pro
    ? expiry
      ? `${pro.willRenew ? t.redesign.renews(expiry) : t.redesign.ends(expiry)} · ${resets}`
      : `${t.settings.proActive} · ${resets}`
    : t.redesign.freeBody;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: P.paper }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28 + tabBarHeight }} showsVerticalScrollIndicator={false}>
        {/* Who's signed in, and their Account sheet. */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 15 }}>
          <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: P.accent, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            {user?.hasImage ? (
              <Image source={{ uri: user.imageUrl }} style={{ width: 60, height: 60 }} />
            ) : (
              <Text style={[{ fontFamily: "SpaceGrotesk-Bold", fontSize: 21, letterSpacing: -0.4, color: "#FFFFFF" }, TIGHT]}>{initials(name)}</Text>
            )}
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text numberOfLines={1} style={[{ fontFamily: "SpaceGrotesk-Bold", fontSize: 23, lineHeight: 28, letterSpacing: -0.4, color: P.ink }, TIGHT, rtl]}>
              {firstName}
            </Text>
            <Text numberOfLines={1} style={[{ fontFamily: "SpaceGrotesk-Regular", fontSize: 13.5, lineHeight: 17, color: P.inkMuted }, TIGHT]}>
              {email}
            </Text>
          </View>
          <AnimatedPressable
            onPress={() => setAccountOpen(true)}
            scaleTo={0.95}
            accessibilityRole="button"
            style={{ height: 37.5, paddingHorizontal: 14, borderRadius: 19, backgroundColor: P.chip, justifyContent: "center" }}
          >
            <Text style={[{ fontFamily: "SpaceGrotesk-SemiBold", fontSize: 14, color: P.ink }, TIGHT]}>{t.redesign.accountButton}</Text>
          </AnimatedPressable>
        </View>

        {/* The plan: Pro with this month's allowances, or Free and the way to Pro. */}
        {isPurchasesEnabled ? (
          <View style={{ marginTop: 14, borderRadius: 24, backgroundColor: P.ink, paddingTop: 18, paddingHorizontal: 18, paddingBottom: 18, ...shadow("0 10px 24px rgba(34, 28, 23, 0.22)", 8) }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
              <View style={{ width: 44, alignItems: "center" }}>
                <GemMascot level={4} width={44} animate={false} />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={[{ fontFamily: "SpaceGrotesk-Bold", fontSize: 17.5, color: "#FFFFFF" }, TIGHT]}>{pro ? "Nexdo Pro" : t.redesign.freePlan}</Text>
                <Text style={[{ fontFamily: "SpaceGrotesk-Regular", fontSize: 13, lineHeight: 16.5, color: ON_DARK_MUTED }, TIGHT, rtl]}>{planLine}</Text>
              </View>
              <AnimatedPressable
                onPress={pro ? handleManageSubscription : () => openPaywall()}
                scaleTo={0.95}
                accessibilityRole="button"
                style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: pro ? ON_DARK_TRACK : P.accent, justifyContent: "center" }}
              >
                <Text style={[{ fontFamily: "SpaceGrotesk-Bold", fontSize: 13.5, color: "#FFFFFF" }, TIGHT]}>{pro ? t.redesign.manage : t.redesign.upgrade}</Text>
              </AnimatedPressable>
            </View>

            {pro && usagePlan && usageUsed ? (
              <View style={{ marginTop: 20, flexDirection: "row", gap: 16 }}>
                {CARD_METERS.map((meter) => {
                  const limit = PLAN_LIMITS[usagePlan][meter];
                  const amount = usageUsed[meter] ?? 0;
                  const shownLimit = displayLimit(usagePlan, meter);
                  const shownUsed = amount >= limit ? shownLimit : isTimeMeter(meter) ? Math.floor(amount / 60) : amount;
                  const fraction = limit === 0 ? 0 : Math.min(1, amount / limit);
                  return (
                    <View key={meter} style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={[{ fontFamily: "SpaceGrotesk-Regular", fontSize: 11.5, color: ON_DARK_MUTED }, TIGHT]}>
                        {t.redesign.meterLabels[meter as "live" | "assist" | "media"]}
                      </Text>
                      <View style={{ marginTop: 7, flexDirection: "row", alignItems: "baseline", gap: 4 }}>
                        <Text style={[{ fontFamily: "SpaceGrotesk-Bold", fontSize: 20, color: "#FFFFFF" }, TIGHT]}>{shownUsed}</Text>
                        <Text numberOfLines={1} style={[{ flexShrink: 1, fontFamily: "SpaceGrotesk-Regular", fontSize: 11.5, color: ON_DARK_FAINT }, TIGHT]}>
                          {isTimeMeter(meter) ? t.redesign.ofMinutes(shownLimit) : `/ ${shownLimit}`}
                        </Text>
                      </View>
                      <View style={{ marginTop: 8, height: 4, borderRadius: 2, backgroundColor: ON_DARK_TRACK, overflow: "hidden" }}>
                        <View style={{ height: 4, borderRadius: 2, width: `${fraction * 100}%`, backgroundColor: P.accent }} />
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* This week at a glance; the full picture is on Insights. */}
        <AnimatedPressable
          onPress={() => {
            posthog.capture("insights_opened", { from: "settings" });
            router.push("/insights");
          }}
          scaleTo={0.98}
          accessibilityRole="button"
          style={[{ marginTop: 14, height: 116, borderRadius: 24, backgroundColor: P.paperCard, paddingLeft: 16, paddingRight: 16, flexDirection: "row" }, CARD_SHADOW]}
        >
          <View style={{ flex: 1, paddingTop: 18 }}>
            <Eyebrow>{t.redesign.thisWeek}</Eyebrow>
            <Text numberOfLines={1} adjustsFontSizeToFit style={[{ marginTop: 6, fontFamily: "SpaceGrotesk-Bold", fontSize: 23, lineHeight: 28, letterSpacing: -0.3, color: P.ink }, TIGHT]}>
              {t.redesign.tasksDone(week.tasksDone)}
            </Text>
            <Text numberOfLines={2} style={[{ marginTop: 3, maxWidth: 180, fontFamily: "SpaceGrotesk-Regular", fontSize: 13, lineHeight: 16, color: P.inkMuted }, TIGHT, rtl]}>
              {t.redesign.focused(t.format.budget(Math.floor(week.focusMinutes / 60), Math.round(week.focusMinutes % 60)))}
            </Text>
          </View>
          <View style={{ paddingBottom: 17, flexDirection: "row", alignItems: "flex-end", gap: 5 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {week.bars.map((bar) => {
              const isToday = bar.start <= today && today <= bar.end;
              return bar.tasksDone > 0 ? (
                <View
                  key={bar.start}
                  style={{ width: 10, height: Math.max(12, (bar.tasksDone / weekMax) * 56), borderRadius: 5, backgroundColor: isToday ? P.accent : "#EDE2D5" }}
                />
              ) : (
                <View key={bar.start} style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: isToday ? P.accent : "#EDE2D5", marginHorizontal: 0.5 }} />
              );
            })}
          </View>
        </AnimatedPressable>

        {/* Notifications: the time, then the three switches. */}
        <View style={{ marginTop: 25, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Eyebrow>{t.redesign.notifications}</Eyebrow>
          <AnimatedPressable onPress={() => setShowTimePicker((open) => !open)} scaleTo={0.96} hitSlop={8} accessibilityRole="button" style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text style={[{ fontFamily: "SpaceGrotesk-Regular", fontSize: 12.5, color: P.inkMuted }, TIGHT]}>{t.redesign.at}</Text>
            <Text style={[{ fontFamily: "SpaceGrotesk-Bold", fontSize: 13, color: P.ink }, TIGHT]}>{timeLabel}</Text>
            <SheetIcon name="chevronRight" size={11} color={P.inkMuted} strokeWidth={2.4} />
          </AnimatedPressable>
        </View>
        {showTimePicker ? (
          <DateTimePicker
            value={timeToDate(dailyNudgeTime)}
            mode="time"
            display={Platform.OS === "ios" ? "spinner" : "default"}
            accentColor={P.accent}
            onChange={handleTimeChange}
          />
        ) : null}
        <View style={{ marginTop: 17, flexDirection: "row", gap: 8 }}>
          <NotificationTile
            title={t.redesign.reminders}
            body={t.redesign.remindersHint}
            value={deadlineRemindersEnabled}
            onChange={switchWith(setDeadlineRemindersEnabled)}
          />
          <NotificationTile
            title={t.redesign.dailyPlan}
            body={t.redesign.dailyPlanHint}
            value={dailyNudgeEnabled}
            onChange={switchWith(setDailyNudgeEnabled)}
          />
          <NotificationTile
            title={t.redesign.overdue}
            body={t.redesign.overdueHint}
            value={overdueAlertsEnabled}
            onChange={switchWith(setOverdueAlertsEnabled)}
          />
        </View>
        {permission === "denied" ? (
          <AnimatedPressable onPress={() => Linking.openSettings()} accessibilityRole="button" style={{ marginTop: 10 }}>
            <Text style={[{ fontFamily: "SpaceGrotesk-Medium", fontSize: 13, lineHeight: 18, color: P.alert }, rtl]}>
              {`${t.settings.notificationsDenied} ${t.settings.openPhoneSettings} ›`}
            </Text>
          </AnimatedPressable>
        ) : null}

        <View style={{ marginTop: 25 }}>
          <Eyebrow>{t.redesign.preferences}</Eyebrow>
        </View>
        <View style={{ marginTop: 6 }}>
          <RowList
            rows={[
              { key: "language", label: t.redesign.language, value: languageName, onPress: () => setLanguageOpen(true) },
              { key: "tour", label: t.redesign.appTour, onPress: () => setTourSeen(false) },
              ...(isPurchasesEnabled && !pro
                ? [{ key: "restore", label: isRestoring ? t.settings.restoring : t.redesign.restore, onPress: handleRestore, disabled: isRestoring }]
                : []),
            ]}
          />
        </View>

        <View style={{ marginTop: 24 }}>
          <Eyebrow>{t.redesign.support}</Eyebrow>
        </View>
        <View style={{ marginTop: 6 }}>
          <RowList
            rows={[
              { key: "help", label: t.redesign.help, onPress: () => handleOpenLink(SUPPORT_LINKS.helpCenter) },
              { key: "feedback", label: t.settings.sendFeedback, onPress: () => router.push("/feedback") },
              { key: "privacy", label: t.settings.privacy, onPress: () => handleOpenLink(SUPPORT_LINKS.privacyPolicy) },
              { key: "terms", label: t.settings.terms, onPress: () => handleOpenLink(SUPPORT_LINKS.termsOfService) },
            ]}
          />
        </View>

        {/* Sign out on the left, the version on the right. */}
        <View style={{ marginTop: 26, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <AnimatedPressable onPress={handleSignOut} disabled={isSigningOut} scaleTo={0.96} hitSlop={8} accessibilityRole="button">
            <Text style={[{ fontFamily: "SpaceGrotesk-SemiBold", fontSize: 15, color: P.alert, opacity: isSigningOut ? 0.5 : 1 }, TIGHT]}>
              {isSigningOut ? t.settings.signingOut : t.settings.signOut}
            </Text>
          </AnimatedPressable>
          <Text style={[{ fontFamily: "SpaceMono-Bold", fontSize: 10.5, letterSpacing: 2, color: P.inkFaint }, TIGHT]}>{`NEXDO ${APP_VERSION}`}</Text>
        </View>
        {signOutError ? (
          <Text style={[{ marginTop: 8, fontFamily: "SpaceGrotesk-Medium", fontSize: 13, color: P.alert }, rtl]}>{signOutError}</Text>
        ) : null}
      </ScrollView>

      <AccountSheet visible={accountOpen} onClose={() => setAccountOpen(false)} />
      <LanguageSheet visible={languageOpen} value={language} onChange={handleSelectLanguage} onClose={() => setLanguageOpen(false)} />
    </SafeAreaView>
  );
}
