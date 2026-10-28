import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import type { FeatherIconName } from "@/components/Button";
import { OnboardingLayout } from "@/components/OnboardingLayout";
import { gradients } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { getNotificationPermission } from "@/lib/notifications";
import { posthog } from "@/lib/posthog";
import { productPrice } from "@/lib/price";
import { billedYearly, loadOnboardingPlans, trialPlanOf, type ProPlans } from "@/lib/purchases";
import { trialLengthInDays, trialReminderDay } from "@/lib/trialReminder";

// Widened past the page margins and padded back, so the scroll's edges don't
// clip the step circles' shadows.
const SCROLL_BLEED = { marginHorizontal: -8 };
const SCROLL_CONTENT = { paddingHorizontal: 8, paddingTop: 4, paddingBottom: 8 };

type Step = {
  key: string;
  icon: FeatherIconName;
  label: string;
  title: string;
  body: string;
  /** Today's step: the lit orange circle and label. */
  current?: boolean;
};

/** One point on the timeline: its circle, the line down to the next one, and what happens then. */
function TimelineStep({ step, last }: { step: Step; last: boolean }) {
  const colors = useColors();
  const rtl = useRtlText();
  return (
    <View className="flex-row gap-3.5">
      <View className="items-center">
        <View
          className={
            step.current
              ? "glow-accent h-[30px] w-[30px] items-center justify-center rounded-full bg-orange-500"
              : "chip chip--idle h-[30px] w-[30px] items-center justify-center"
          }
          style={step.current ? gradients.accent : undefined}
        >
          <Feather name={step.icon} size={14} color={step.current ? colors.onAccent : colors.ink.cream} />
        </View>
        {last ? null : <View className="my-1.5 w-[2px] flex-1 rounded-full bg-cream-300" />}
      </View>
      <View className={`flex-1 gap-0.5 pt-[1px] ${last ? "" : "pb-5"}`}>
        <Text className={`eyebrow ${step.current ? "text-orange-500" : "text-ink-cream-subtle"}`}>{step.label}</Text>
        <Text className="font-grotesk-bold text-base text-ink-cream" style={rtl}>
          {step.title}
        </Text>
        <Text className="font-grotesk-regular text-[13px] leading-[19px] text-ink-cream-muted" style={rtl}>
          {step.body}
        </Text>
      </View>
    </View>
  );
}

/**
 * Onboarding step 9: the free trial, day by day — when it starts, when the
 * reminder comes, when the first charge would be, and that it can be
 * cancelled. Everything in it comes from the store's own offer: its length,
 * its price. Shown only when the store has a trial for this phone; if it turns
 * out not to, the step hands straight over to the plans.
 */
export default function OnboardingTrial() {
  const colors = useColors();
  const t = useTranslation();
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();

  const [plans, setPlans] = useState<ProPlans | null>(null);
  // The reminder is only promised if the phone will actually show it.
  const [notificationsOn, setNotificationsOn] = useState(false);
  // Fixed for the life of the screen, so a month-long trial's day count holds still.
  const [now] = useState(() => new Date());

  useEffect(() => {
    let active = true;
    loadOnboardingPlans().then(
      (loaded) => {
        if (!active) return;
        if (trialPlanOf(loaded)) setPlans(loaded);
        // No trial for this phone after all: the plans step says what's on offer instead.
        else router.replace("/onboarding-paywall");
      },
      () => {
        if (active) router.replace("/onboarding-paywall");
      },
    );
    getNotificationPermission().then((permission) => {
      if (active) setNotificationsOn(permission === "granted");
    });
    return () => {
      active = false;
    };
  }, [router]);

  if (!isLoaded) return null;
  if (isSignedIn) return <Redirect href="/" />;

  const plan = plans ? trialPlanOf(plans) : null;
  const steps: Step[] = [];
  if (plans && plan?.trial) {
    const trialDays = trialLengthInDays(plan.trial, now);
    const reminderDay = notificationsOn ? trialReminderDay(trialDays) : null;
    steps.push({
      key: "start",
      icon: "arrow-right",
      label: t.onboardingTrial.today,
      title: t.onboardingTrial.startTitle,
      body: t.onboardingTrial.startBody,
      current: true,
    });
    if (reminderDay !== null) {
      steps.push({
        key: "reminder",
        icon: "bell",
        label: t.onboardingTrial.day(reminderDay),
        title: t.onboardingTrial.remindTitle,
        body: t.onboardingTrial.remindBody,
      });
    }
    steps.push(
      {
        key: "end",
        icon: "credit-card",
        label: t.onboardingTrial.day(trialDays),
        title: t.onboardingTrial.endTitle,
        body: t.onboardingTrial.endBody(productPrice(plan.package.product, t.locale), billedYearly(plan, plans)),
      },
      {
        key: "cancel",
        icon: "check",
        label: t.onboardingTrial.anytime,
        title: t.onboardingTrial.cancelTitle,
        body: t.onboardingTrial.cancelBody,
      },
    );
  }

  const handleNext = () => {
    posthog.capture("onboarding_trial_continued", { trial_days: plan?.trial ? trialLengthInDays(plan.trial, now) : 0 });
    router.push("/onboarding-paywall");
  };

  return (
    <OnboardingLayout
      percent={91}
      headline={t.onboardingTrial.headline}
      body={t.onboardingTrial.body}
      nextLabel={t.onboardingTrial.next}
      onNext={handleNext}
    >
      {steps.length === 0 ? (
        // Only while the plans are still on their way (they usually aren't by now).
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.orange[500]} />
        </View>
      ) : (
        <ScrollView className="flex-1" style={SCROLL_BLEED} contentContainerStyle={SCROLL_CONTENT} showsVerticalScrollIndicator={false}>
          {steps.map((step, index) => (
            <TimelineStep key={step.key} step={step} last={index === steps.length - 1} />
          ))}
        </ScrollView>
      )}
    </OnboardingLayout>
  );
}
