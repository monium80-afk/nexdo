import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { OnboardingLayout } from "@/components/OnboardingLayout";
import { gradients } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { requestNotificationPermission } from "@/lib/notifications";
import { posthog } from "@/lib/posthog";
import { isPurchasesEnabled, loadOnboardingPlans, trialPlanOf, type ProPlans } from "@/lib/purchases";
import { useSettingsStore } from "@/store/useSettingsStore";

/**
 * Onboarding step 8: asking for notifications, with a sample of the kind of
 * reminder Nexdo sends. The system prompt shows over this step, before it
 * leaves (OnboardingLayout's beforeNext).
 */
export default function OnboardingNotifications() {
  const colors = useColors();
  const t = useTranslation();
  const rtl = useRtlText();
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();

  // The plans for the next two steps, loading while this one is read — so by
  // the time someone moves on, it's usually known whether the store has a
  // free trial to walk them through.
  const [plans, setPlans] = useState<ProPlans | "failed" | null>(null);

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
    useSettingsStore.getState().setNotificationPromptShown(true);
    const granted = await requestNotificationPermission();
    posthog.capture("onboarding_notifications_answered", { granted });
  };

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
      </View>
    </OnboardingLayout>
  );
}
