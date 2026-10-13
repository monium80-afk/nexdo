import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { OnboardingLayout } from "@/components/OnboardingLayout";
import { gradients } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useColors, useThemeScheme } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { pad } from "@/lib/localDate";
import { requestNotificationPermission } from "@/lib/notifications";
import { posthog } from "@/lib/posthog";
import { isPurchasesEnabled, loadOnboardingPlans, trialPlanOf, type ProPlans } from "@/lib/purchases";
import { useSettingsStore } from "@/store/useSettingsStore";

/** When the morning plan comes, unless the user picks another time. */
const DEFAULT_PLAN_TIME = "08:30";

/**
 * Onboarding step 8: asking for notifications, with a sample of the kind of
 * reminder Nexdo sends and the time of the morning plan — the daily note
 * that's switched on once they're allowed. The system prompt shows over this
 * step, before it leaves (OnboardingLayout's beforeNext).
 */
export default function OnboardingNotifications() {
  const colors = useColors();
  const scheme = useThemeScheme();
  const t = useTranslation();
  const rtl = useRtlText();
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();

  // The plans for the next two steps, loading while this one is read — so by
  // the time someone moves on, it's usually known whether the store has a
  // free trial to walk them through.
  const [plans, setPlans] = useState<ProPlans | "failed" | null>(null);
  // When the morning plan arrives, if notifications are allowed.
  const [planTime, setPlanTime] = useState(DEFAULT_PLAN_TIME);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    if (!isPurchasesEnabled) return;
    let active = true;
    loadOnboardingPlans().then(
      (loaded) => {
        if (active) setPlans(loaded);
      },
      (error) => {
        console.warn("[onboarding-notifications] couldn't load the plans", error);
        if (active) setPlans("failed");
      },
    );
    return () => {
      active = false;
    };
  }, []);

  if (!isLoaded) return null;
  if (isSignedIn) return <Redirect href="/" />;

  const askPermission = async () => {
    // Asked here, so the reminders hook doesn't ask again once there's a deadline.
    const settings = useSettingsStore.getState();
    settings.setNotificationPromptShown(true);
    const granted = await requestNotificationPermission();
    // The "one nudge" this screen promises: the morning plan, at the time
    // picked above. (Off otherwise — Settings → Daily planning turns it on.)
    if (granted) {
      settings.setDailyNudgeTime(planTime);
      settings.setDailyNudgeEnabled(true);
    }
    posthog.capture("onboarding_notifications_answered", { granted, morning_plan: granted ? planTime : null });
  };

  const handleTimeChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === "android") setShowPicker(false);
    if (event.type === "dismissed" || !selected) return;
    setPlanTime(`${pad(selected.getHours())}:${pad(selected.getMinutes())}`);
  };

  const [hours, minutes] = planTime.split(":").map(Number);
  const planDate = new Date();
  planDate.setHours(hours, minutes, 0, 0);
  const planTimeLabel = planDate.toLocaleTimeString(t.locale, { hour: "numeric", minute: "2-digit" });

  // Without Nexdo Pro in this build: straight on to the account. With it: the
  // trial, day by day — or the plans themselves when the store has no trial
  // for this phone. Still loading, the trial step waits for the answer and
  // steps aside if there's no trial after all.
  const handleNext = () => {
    if (!isPurchasesEnabled) router.push("/(auth)/sign-up");
    else if (plans === "failed" || (plans && !trialPlanOf(plans))) router.push("/onboarding-paywall");
    else router.push("/onboarding-trial");
  };

  return (
    <OnboardingLayout
      percent={88}
      centered
      mark={
        <View
          className="btn--charcoal-solid h-16 w-16 items-center justify-center rounded-[18px]"
          style={[{ borderCurve: "continuous" }, gradients.charcoalCard]}
        >
          <Feather name="bell" size={26} color={colors.orange[400]} />
        </View>
      }
      headline={t.onboardingNotify.headline}
      body={t.onboardingNotify.body}
      nextLabel={t.onboardingNotify.allow}
      beforeNext={askPermission}
      onNext={handleNext}
      secondaryAction={{ label: t.onboardingNotify.notNow }}
    >
      {/* A sample of what arrives: the phone's own banner, drawn as one of the app's cards. */}
      <View className="mt-3 px-1">
        <View className="card card--cream flex-row gap-3 p-[14px]" style={gradients.card}>
          <View className="h-9 w-9 items-center justify-center rounded-[10px] bg-orange-500" style={gradients.accent}>
            <Feather name="arrow-right" size={17} color={colors.onAccent} />
          </View>
          <View className="flex-1 gap-0.5">
            <View className="flex-row items-baseline gap-2">
              <Text className="font-grotesk-bold text-sm text-ink-cream">Nexdo</Text>
              <Text className="font-grotesk-medium text-xs text-ink-cream-subtle">{t.onboardingNotify.sampleTime}</Text>
            </View>
            <Text className="font-grotesk-regular text-sm leading-[19px] text-ink-cream" style={rtl}>
              {t.onboardingNotify.sampleBody}
            </Text>
          </View>
        </View>

        {/* The morning plan's time, shown like a filled field (as in Settings). */}
        <AnimatedPressable
          onPress={() => setShowPicker((open) => !open)}
          accessibilityRole="button"
          className="card card--cream-inset mt-3 min-h-[48px] flex-row items-center gap-2 px-4"
        >
          <Feather name="sun" size={16} color={colors.orange[600]} />
          <Text className="flex-1 font-grotesk-medium text-sm text-ink-cream" style={rtl}>
            {t.onboardingNotify.morningPlan}
          </Text>
          <Text className="font-grotesk-bold text-sm text-orange-600">{planTimeLabel}</Text>
        </AnimatedPressable>
        {showPicker ? (
          <DateTimePicker
            value={planDate}
            mode="time"
            display={Platform.OS === "ios" ? "spinner" : "default"}
            themeVariant={scheme}
            textColor={colors.ink.cream}
            accentColor={colors.orange[500]}
            onChange={handleTimeChange}
          />
        ) : null}
      </View>
    </OnboardingLayout>
  );
}
