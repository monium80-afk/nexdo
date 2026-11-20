import { useClerk, useUser } from "@clerk/expo";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import Constants from "expo-constants";
import { useFocusEffect, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Fragment, useCallback, useMemo, useState, type ReactNode } from "react";
import { Image, Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Feather } from "@expo/vector-icons";

import { AccountSheet } from "@/components/AccountSheet";
import { type FeatherIconName } from "@/components/Button";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { SheetIcon } from "@/components/addSheet/SheetParts";
import { GemMascot } from "@/components/GemMascot";
import { LanguageSheet, LANGUAGE_OPTIONS } from "@/components/LanguageSheet";
import { useTabBarHeight } from "@/components/TabBar";
import { SUPPORT_LINKS } from "@/constants/support";
import { useIsDark, usePalette } from "@/hooks/useTheme";
import { useRtlText } from "@/hooks/useRtlText";
import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";
import { useToday } from "@/hooks/useToday";
import { useTranslation } from "@/hooks/useTranslation";
import { showAlert } from "@/lib/alert";
import { keyToLocalDate } from "@/lib/localDate";
import { getNotificationPermission, requestNotificationPermission, type NotificationPermission } from "@/lib/notifications";
import { buildInsights } from "@/lib/pace";
import { openPaywall } from "@/lib/paywall";
import { displayLimit, isTimeMeter, PLAN_LIMITS, type Meter } from "@/lib/plan";
import { posthog } from "@/lib/posthog";
import { LeadSlider, leadText } from "@/components/ReminderParts";
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
import { defaultReminderLead, useSettingsStore } from "@/store/useSettingsStore";
import { useSubscriptionStore } from "@/store/useSubscriptionStore";
import { useTaskStore } from "@/store/useTaskStore";
import type { AppLanguage } from "@/types/settings";
import { shadow, SOFT_SHADOW } from "@/constants/shadow";

const APP_VERSION = Constants.expoConfig?.version ?? "2.0.0";
const TIGHT = { includeFontPadding: false } as const;
const CARD_SHADOW = SOFT_SHADOW;
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
  const P = usePalette();
  return (
    <Text style={[{ fontFamily: "SpaceMono-Bold", fontSize: 10, lineHeight: 12, letterSpacing: 2, color: P.inkMuted }, TIGHT]}>
      {children}
    </Text>
  );
}

/** A list row on the page itself: label, an optional value, a ›. */
function Row({ label, value, onPress, disabled = false, toggle }: { label: string; value?: string; onPress: () => void; disabled?: boolean; toggle?: boolean }) {
  const P = usePalette();
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
      {toggle !== undefined ? (
        // A switch instead of a value and a › (Dark mode).
        <MiniSwitch value={toggle} onChange={onPress} label={label} />
      ) : (
        <>
          {value ? <Text style={[{ fontFamily: "SpaceGrotesk-Regular", fontSize: 15, color: P.inkMuted }, TIGHT]}>{value}</Text> : null}
          <SheetIcon name="chevronRight" size={17} color={P.inkFaint} />
        </>
      )}
    </AnimatedPressable>
  );
}

function RowList({ rows }: { rows: { key: string; label: string; value?: string; onPress: () => void; disabled?: boolean; toggle?: boolean }[] }) {
  const P = usePalette();
  return (
    <View>
      {rows.map((row, index) => (
        <Fragment key={row.key}>
          {index > 0 ? <View style={{ height: 1, backgroundColor: P.rule }} /> : null}
          <Row label={row.label} value={row.value} onPress={row.onPress} disabled={row.disabled} toggle={row.toggle} />
        </Fragment>
      ))}
    </View>
  );
}

/** The notifications card's corner and padding: the panel inside it is rounded by their difference. */
const NOTIFY_CARD_RADIUS = 24;
const NOTIFY_CARD_PADDING = 12;

/** The orange switch (the screenshot's 48 × 28); `size` "small" inside the notifications panel. */
function MiniSwitch({ value, onChange, label, size = "large" }: { value: boolean; onChange: (next: boolean) => unknown; label: string; size?: "large" | "small" }) {
  const P = usePalette();
  const width = size === "large" ? 48 : 44;
  const height = size === "large" ? 28 : 26;
  const knob = height - 6;
  const dark = useIsDark();
  return (
    <Pressable
      onPress={() => void onChange(!value)}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      style={{ width, height, borderRadius: height / 2, padding: 3, backgroundColor: value ? P.accent : P.track, alignItems: value ? "flex-end" : "flex-start" }}
    >
      {/* In dark mode an "on" knob is dark, as in the user's dark screenshot. */}
      <View style={{ width: knob, height: knob, borderRadius: knob / 2, backgroundColor: dark && value ? P.inkCard : "#FFFFFF" }} />
    </Pressable>
  );
}

/**
 * One kind of notification in the panel: its name, a line under it, and its
 * switch. With `expanded` set (it has settings of its own and is on), a
 * chevron next to the switch folds those settings away or opens them, and so
 * does tapping the name — so the whole card isn't open every time (2026-11-18).
 */
function SubSwitchRow({
  title,
  hint,
  value,
  onChange,
  expanded,
  onToggleExpanded,
}: {
  title: string;
  hint: string;
  value: boolean;
  onChange: (next: boolean) => unknown;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}) {
  const P = usePalette();
  const rtl = useRtlText();
  const foldable = expanded !== undefined && onToggleExpanded !== undefined;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 16 }}>
      <Pressable
        onPress={onToggleExpanded}
        disabled={!foldable}
        accessibilityRole={foldable ? "button" : undefined}
        accessibilityState={foldable ? { expanded } : undefined}
        accessibilityLabel={`${title}. ${hint}`}
        style={{ flex: 1 }}
      >
        <Text style={[{ fontFamily: "SpaceGrotesk-Bold", fontSize: 16, lineHeight: 20, color: P.ink }, TIGHT, rtl]}>{title}</Text>
        <Text style={[{ marginTop: 2, fontFamily: "SpaceGrotesk-Regular", fontSize: 13, lineHeight: 17, color: P.inkMuted }, TIGHT, rtl]}>{hint}</Text>
      </Pressable>
      {foldable ? (
        <Pressable onPress={onToggleExpanded} hitSlop={10} accessibilityElementsHidden importantForAccessibility="no" style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}>
          <Feather name={expanded ? "chevron-up" : "chevron-down"} size={18} color={P.inkMuted} />
        </Pressable>
      ) : null}
      <MiniSwitch value={value} onChange={onChange} label={title} size="small" />
    </View>
  );
}

/** A setting's name and its value in orange ("Time — 8:00 AM ›"); tappable when it opens something. */
function ValueRow({ label, value, icon, onPress }: { label: string; value: string; icon?: FeatherIconName; onPress?: () => void }) {
  const P = usePalette();
  const rtl = useRtlText();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`${label}, ${value}`}
      style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 2, paddingBottom: 16 }}
    >
      <Text style={[{ flex: 1, fontFamily: "SpaceGrotesk-Medium", fontSize: 15, color: P.ink }, TIGHT, rtl]}>{label}</Text>
      <Text style={[{ fontFamily: "SpaceGrotesk-Bold", fontSize: 15, color: P.accentInk }, TIGHT]}>{value}</Text>
      {icon ? <Feather name={icon} size={16} color={P.inkMuted} /> : null}
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
  const P = usePalette();
  const router = useRouter();
  const t = useTranslation();
  const rtl = useRtlText();
  const { user } = useUser();
  const { signOut } = useClerk();
  const handleTaskSignOut = useTaskStore((state) => state.handleSignOut);
  const saveUnsyncedTasks = useTaskStore((state) => state.saveUnsyncedTasks);
  const language = useSettingsStore((state) => state.language);
  const setLanguage = useSettingsStore((state) => state.setLanguage);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const dark = useIsDark();
  const notificationsEnabled = useSettingsStore((state) => state.notificationsEnabled);
  const setNotificationsEnabled = useSettingsStore((state) => state.setNotificationsEnabled);
  const lead = useSettingsStore(defaultReminderLead);
  const setReminderLead = useSettingsStore((state) => state.setReminderLead);
  const overdueAlertsEnabled = useSettingsStore((state) => state.overdueAlertsEnabled);
  const setOverdueAlertsEnabled = useSettingsStore((state) => state.setOverdueAlertsEnabled);
  const deadlineRemindersEnabled = useSettingsStore((state) => state.deadlineRemindersEnabled);
  const setDeadlineRemindersEnabled = useSettingsStore((state) => state.setDeadlineRemindersEnabled);
  const morningNudgeEnabled = useSettingsStore((state) => state.dailyNudgeEnabled);
  const setMorningNudgeEnabled = useSettingsStore((state) => state.setDailyNudgeEnabled);
  const morningNudgeTime = useSettingsStore((state) => state.dailyNudgeTime);
  const setMorningNudgeTime = useSettingsStore((state) => state.setDailyNudgeTime);
  // Unmarking the tour is all it takes: the tab bar starts it again (components/AppTour.tsx).
  const setTourSeen = useSettingsStore((state) => state.setTourSeen);
  const pro = useSubscriptionStore((state) => state.pro);
  // Settings → Preferences → Share usage data (PostHog on or off, app/_layout.tsx).
  const analyticsEnabled = useSettingsStore((state) => state.analyticsEnabled);
  const setAnalyticsEnabled = useSettingsStore((state) => state.setAnalyticsEnabled);
  const tabBarHeight = useTabBarHeight();
  const today = useToday();
  useStatusBarStyle("dark");

  const [accountOpen, setAccountOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  // Whether the morning summary's time picker is open.
  const [timePicker, setTimePicker] = useState(false);
  // Which parts of the notifications panel are open (folded by default, 2026-11-18).
  const [morningOpen, setMorningOpen] = useState(false);
  const [timedOpen, setTimedOpen] = useState(false);
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
    () => buildInsights(entriesFor(allEntries, userId), entriesFor(allCompletions, userId), tasks, "week", keyToLocalDate(today)),
    [allEntries, allCompletions, tasks, userId, today],
  );
  const weekMax = Math.max(1, ...week.bars.map((bar) => bar.tasksDone));

  const name = user?.fullName?.trim() || user?.primaryEmailAddress?.emailAddress?.split("@")[0] || "";
  const firstName = name.split(/\s+/)[0] ?? "";
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const morningTimeLabel = timeToDate(morningNudgeTime).toLocaleTimeString(t.locale, { hour: "numeric", minute: "2-digit" });
  const languageName = LANGUAGE_OPTIONS.find((option) => option.value === language)?.label ?? "";

  const handleSelectLanguage = (value: AppLanguage) => {
    setLanguage(value);
    posthog.capture("language_changed", { language: value });
  };

  // The morning summary's time.
  const handleTimeChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === "android") setTimePicker(false);
    if (event.type === "dismissed" || !selected) return;
    setMorningNudgeTime(dateToTime(selected));
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
          <View style={{ marginTop: 14, borderRadius: 24, backgroundColor: P.inkCard, paddingTop: 18, paddingHorizontal: 18, paddingBottom: 18, ...shadow("0 10px 24px rgba(34, 28, 23, 0.22)", 8) }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
              {/* Pro shows the blazing gem. The plain gem sits low in its drawing (room
                  is kept above it for the flame), so it's lifted to the row's middle. */}
              <View style={{ width: 44, alignItems: "center", transform: [{ translateY: pro ? -1 : -7 }] }}>
                <GemMascot level={pro ? 5 : 4} width={44} animate={false} />
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

            {/* Always there on Pro, so the card never jumps: "–" until this
                month's numbers arrive, and Pro's limits even if the server
                still counts the account as Free for a moment after buying. */}
            {pro ? (
              <View style={{ marginTop: 20, flexDirection: "row", gap: 16 }}>
                {CARD_METERS.map((meter) => {
                  const limit = PLAN_LIMITS.pro[meter];
                  const known = usageUsed !== null && usagePlan !== null;
                  const amount = usageUsed?.[meter] ?? 0;
                  const shownLimit = displayLimit("pro", meter);
                  const shownUsed = !known ? "–" : amount >= limit ? shownLimit : isTimeMeter(meter) ? Math.floor(amount / 60) : amount;
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
                  style={{ width: 10, height: Math.max(12, (bar.tasksDone / weekMax) * 56), borderRadius: 5, backgroundColor: isToday ? P.accent : P.bar }}
                />
              ) : (
                <View key={bar.start} style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: isToday ? P.accent : P.bar, marginHorizontal: 0.5 }} />
              );
            })}
          </View>
        </AnimatedPressable>

        {/* Notifications (2026-11-18, the user's Claude Design screenshots):
            one main switch, and under it — only while it's on — the three
            kinds Nexdo sends. Turning any of them off never touches a task's
            own reminder choice: it's all there again when switched back on. */}
        <View style={{ marginTop: 25 }}>
          <Eyebrow>{t.redesign.notifications}</Eyebrow>
        </View>
        {/* Nested corners follow inner radius = outer radius − padding
            (24 − 12 = 12), so the panel's curve runs parallel to the card's. */}
        <View style={[{ marginTop: 12, borderRadius: NOTIFY_CARD_RADIUS, backgroundColor: P.paperCard, padding: NOTIFY_CARD_PADDING }, CARD_SHADOW]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 6, paddingVertical: 6 }}>
            <View style={{ flex: 1 }}>
              <Text style={[{ fontFamily: "SpaceGrotesk-Bold", fontSize: 19, lineHeight: 24, color: P.ink }, TIGHT, rtl]}>{t.reminderUi.title}</Text>
              <Text style={[{ marginTop: 3, fontFamily: "SpaceGrotesk-Regular", fontSize: 13.5, lineHeight: 18, color: P.inkMuted }, TIGHT, rtl]}>
                {notificationsEnabled ? t.reminderUi.notificationsOn : t.reminderUi.notificationsOff}
              </Text>
            </View>
            <MiniSwitch value={notificationsEnabled} onChange={switchWith(setNotificationsEnabled)} label={t.reminderUi.title} />
          </View>

          {notificationsEnabled ? (
            <View style={{ marginTop: 12, borderRadius: NOTIFY_CARD_RADIUS - NOTIFY_CARD_PADDING, backgroundColor: P.tile, paddingHorizontal: 14 }}>
              <SubSwitchRow
                title={t.reminderUi.morningSummary}
                hint={t.reminderUi.morningSummaryHint}
                value={morningNudgeEnabled}
                onChange={switchWith((on) => {
                  setMorningNudgeEnabled(on);
                  // Opens when turned on, so its time is seen; folds away when off.
                  setMorningOpen(on);
                })}
                expanded={morningNudgeEnabled ? morningOpen : undefined}
                onToggleExpanded={() => setMorningOpen((open) => !open)}
              />
              {morningNudgeEnabled && morningOpen ? (
                <>
                  <ValueRow label={t.reminderUi.time} value={morningTimeLabel} icon="chevron-right" onPress={() => setTimePicker((open) => !open)} />
                  {timePicker ? (
                    <DateTimePicker value={timeToDate(morningNudgeTime)} mode="time" display={Platform.OS === "ios" ? "spinner" : "default"} accentColor={P.accent} themeVariant={dark ? "dark" : "light"} onChange={handleTimeChange} />
                  ) : null}
                </>
              ) : null}
              <View style={{ height: 1, backgroundColor: P.rule }} />
              <SubSwitchRow
                title={t.reminderUi.timedTitle}
                hint={t.reminderUi.timedHint}
                value={deadlineRemindersEnabled}
                onChange={switchWith((on) => {
                  setDeadlineRemindersEnabled(on);
                  setTimedOpen(on);
                })}
                expanded={deadlineRemindersEnabled ? timedOpen : undefined}
                onToggleExpanded={() => setTimedOpen((open) => !open)}
              />
              {deadlineRemindersEnabled && timedOpen ? (
                <View style={{ paddingBottom: 18 }}>
                  <ValueRow label={t.reminderUi.defaultReminder} value={leadText(lead, t)} />
                  <View style={{ marginTop: 4 }}>
                    <LeadSlider value={lead} onChange={setReminderLead} />
                  </View>
                </View>
              ) : null}
              <View style={{ height: 1, backgroundColor: P.rule }} />
              <SubSwitchRow
                title={t.reminderUi.overdueAlert}
                hint={t.reminderUi.overdueHint}
                value={overdueAlertsEnabled}
                onChange={switchWith(setOverdueAlertsEnabled)}
              />
            </View>
          ) : (
            <Text style={[{ marginTop: 8, paddingHorizontal: 6, paddingBottom: 4, fontFamily: "SpaceGrotesk-Regular", fontSize: 12.5, lineHeight: 17, color: P.inkMuted }, TIGHT, rtl]}>
              {t.reminderUi.keptNote}
            </Text>
          )}
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
              // Dark mode (2026-11-17): follows the phone until it is switched here.
              { key: "dark", label: t.redesign.darkMode, toggle: dark, onPress: () => setTheme(dark ? "light" : "dark") },
              { key: "tour", label: t.redesign.appTour, onPress: () => setTourSeen(false) },
              {
                key: "analytics",
                label: t.privacyPrefs.analytics,
                value: analyticsEnabled ? t.privacyPrefs.on : t.privacyPrefs.off,
                onPress: () => setAnalyticsEnabled(!analyticsEnabled),
              },
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
