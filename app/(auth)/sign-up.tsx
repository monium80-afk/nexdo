import { useSignUp } from "@clerk/expo";
import { useSSO } from "@clerk/expo/experimental";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    View,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
} from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { AuthTextField } from "@/components/AuthTextField";
import { SetupProgressBar } from "@/components/SetupProgressBar";
import { SocialAuthButton } from "@/components/SocialAuthButton";
import { VerificationModal } from "@/components/VerificationModal";
import { useScreenEnterAnimation } from "@/hooks/useScreenEnterAnimation";
import { useRtlText } from "@/hooks/useRtlText";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import type { ExtractedTaskDraft } from "@/lib/ai/types";
import { posthog } from "@/lib/posthog";
import { computePriorityScore, PRIORITY_LEVEL_IMPORTANCE } from "@/lib/scoring";
import { previewDueLabel } from "@/lib/taskMeta";
import { useOnboardingStore } from "@/store/useOnboardingStore";

const REVEAL_LAYOUT = LinearTransition.duration(250);

// Most pressing first: the dots fade down the list, and every row past the
// third keeps the faintest.
const PLAN_DOTS = ["bg-orange-500", "bg-orange-500/70", "bg-orange-500/45"] as const;

// The plan card is always exactly three rows tall, whatever the dump turned
// into. Any taller and a long dump would push the sign-up buttons off the
// screen; any rows past three scroll inside the card instead.
const PLAN_VISIBLE_ROWS = 3;
/** Pinned on the title with leading-[21px] — text-base's own line height. */
const PLAN_ROW_HEIGHT = 21;
/** The card's padding and the gap between rows: p-5 / gap-5 at NativeWind's 14px rem. */
const PLAN_SPACE = 17.5;
/** The `card` utility's 1px border, top and bottom. */
const PLAN_BORDER = 2;
/** The scrolling area inside the border. */
const PLAN_VIEWPORT = PLAN_VISIBLE_ROWS * PLAN_ROW_HEIGHT + (PLAN_VISIBLE_ROWS + 1) * PLAN_SPACE;
const PLAN_CARD_HEIGHT = PLAN_VIEWPORT + PLAN_BORDER;
const PLAN_FADE_HEIGHT = 28;

/** Most pressing first, by the same score the Plan step showed on each card. */
function sortByPriority(drafts: ExtractedTaskDraft[], now: Date): ExtractedTaskDraft[] {
  const score = (draft: ExtractedTaskDraft) =>
    computePriorityScore(
      {
        dueDate: draft.dueDate,
        estimatedMinutes: draft.estimatedMinutes,
        importance: PRIORITY_LEVEL_IMPORTANCE[draft.priorityLevel],
      },
      now,
    );
  return [...drafts].sort((a, b) => score(b) - score(a));
}

export default function SignUp() {
  const colors = useColors();
  const t = useTranslation();
  const rtl = useRtlText();
  const router = useRouter();
  const enterStyle = useScreenEnterAnimation();
  // Fixed for the life of the screen, like the Plan step: the order and the
  // due labels both read "now".
  const [now] = useState(() => new Date());
  // What the brain dump turned into, taken once on arrival rather than read
  // live: signing up claims the drafts out of the store (hooks/useAuthSync.ts),
  // and a live read would flash the no-plan copy just before the app moves on.
  // Empty when there was nothing to find, or when sign-up was reached from log in.
  const [plan] = useState(() => sortByPriority(useOnboardingStore.getState().drafts, now));
  const hasPlan = plan.length > 0;
  // Whether rows are hidden under the bottom edge of the plan card. Set from
  // the list's own measurements, so it holds however tall the rows turn out.
  const [moreBelow, setMoreBelow] = useState(false);
  const { signUp, errors, fetchStatus } = useSignUp();
  const { startSSOFlow } = useSSO();
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [modalVisible, setModalVisible] = useState(false);
  const [sendCodeError, setSendCodeError] = useState<string | null>(null);

  const handleSocialAuth = async (provider: "google" | "apple") => {
    posthog.capture('sign_up_social_tapped', { provider })
    try {
      const { createdSessionId } = await startSSOFlow({
        strategy: provider === "google" ? "oauth_google" : "oauth_apple",
      });
      if (createdSessionId) {
        posthog.capture('sign_up_completed', { method: 'social', provider })
        router.replace("/");
      }
    } catch (err) {
      console.error("Social sign-up error:", JSON.stringify(err, null, 2));
      posthog.captureException(err instanceof Error ? err : new Error(String(err)), {
        context: 'sign_up_social',
        provider,
      })
    }
  };

  const handleSignUp = async () => {
    if (!email || !password) return;
    setSendCodeError(null);
    const { error } = await signUp.password({ emailAddress: email, password });
    if (error) return;

    const { error: verificationError } = await signUp.verifications.sendEmailCode();
    if (verificationError) {
      setSendCodeError(
        verificationError.longMessage ?? t.auth.sendCodeError,
      );
      return;
    }
    setModalVisible(true);
  };

  const handlePlanScroll = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
    setMoreBelow(contentOffset.y + layoutMeasurement.height < contentSize.height - 1);
  };

  const handleVerifyCode = async (code: string) => {
    const { error } = await signUp.verifications.verifyEmailCode({ code });
    if (error) return error.longMessage ?? t.auth.invalidCode;

    if (signUp.status === "complete") {
      const { error: finalizeError } = await signUp.finalize({
        navigate: () => {
          posthog.capture('sign_up_completed', { method: 'email' })
          router.replace("/")
        },
      });
      if (finalizeError) {
        return finalizeError.longMessage ?? t.auth.invalidCode;
      }
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream[100] }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Outside the entrance animation, as on the onboarding steps: the
              setup bar is the one piece of chrome that holds still all the way
              through the flow. */}
          <SetupProgressBar percent={94} />

          <Animated.View style={enterStyle}>
            <View className="mt-8 gap-3">
              <Text className="text-title text-ink-cream" style={rtl}>
                {hasPlan ? t.auth.signUpTitle : t.auth.signUpTitleNoPlan}
              </Text>
              <Text className="text-base font-grotesk-regular leading-relaxed text-ink-cream-muted" style={rtl}>
                {hasPlan ? t.auth.signUpSubtitle(plan.length) : t.auth.signUpSubtitleNoPlan}
              </Text>
            </View>

            {hasPlan ? (
              <View className="card card--cream mt-6" style={{ height: PLAN_CARD_HEIGHT }}>
                {/* Fewer than three rows sit centred in the card; more than
                    three scroll inside it. nestedScrollEnabled so Android hands
                    the drag to this list rather than to the page around it. */}
                <ScrollView
                  nestedScrollEnabled
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.planRows}
                  scrollEventThrottle={32}
                  onContentSizeChange={(_, height) => setMoreBelow(height > PLAN_VIEWPORT + 1)}
                  onScroll={handlePlanScroll}
                >
                  {plan.map((draft, index) => (
                    <View key={`${draft.title}-${index}`} className="flex-row items-center gap-3">
                      <View
                        className={`h-2.5 w-2.5 rounded-full ${PLAN_DOTS[Math.min(index, PLAN_DOTS.length - 1)]}`}
                      />
                      <Text
                        className="flex-1 font-grotesk-bold text-base leading-[21px] text-ink-cream"
                        numberOfLines={1}
                        style={rtl}
                      >
                        {draft.title}
                      </Text>
                      <Text className="font-grotesk-regular text-sm text-ink-cream-muted">
                        {previewDueLabel(draft.dueDate, draft.dueHasTime, now, t)}
                      </Text>
                    </View>
                  ))}
                </ScrollView>

                {/* The last visible row fades into the card with a chevron under
                    it, so the list reads as going on. Gone once you reach the end. */}
                {moreBelow ? (
                  <Animated.View
                    entering={FadeIn.duration(180)}
                    exiting={FadeOut.duration(180)}
                    style={styles.planFade}
                  >
                    <Svg style={StyleSheet.absoluteFill}>
                      <Defs>
                        <LinearGradient id="planFade" x1="0" y1="0" x2="0" y2="1">
                          <Stop offset="0" stopColor={colors.cream[50]} stopOpacity="0" />
                          <Stop offset="1" stopColor={colors.cream[50]} stopOpacity="1" />
                        </LinearGradient>
                      </Defs>
                      <Rect x="0" y="0" width="100%" height="100%" fill="url(#planFade)" />
                    </Svg>
                    <Feather name="chevron-down" size={14} color={colors.ink.creamMuted} />
                  </Animated.View>
                ) : null}
              </View>
            ) : null}

            <View className="mt-8 gap-3">
              <SocialAuthButton
                provider="google"
                onPress={() => handleSocialAuth("google")}
              />
              <SocialAuthButton
                provider="apple"
                onPress={() => handleSocialAuth("apple")}
              />
            </View>

            <Animated.View layout={REVEAL_LAYOUT} className="mt-5 gap-3">
              {showEmailForm ? (
                <Animated.View
                  entering={FadeIn.duration(220)}
                  exiting={FadeOut.duration(150)}
                  className="gap-3"
                >
                  <AuthTextField
                    label={t.auth.email}
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoComplete="email"
                  />
                  {errors.fields.emailAddress ? (
                    <Text className="text-sm font-grotesk-medium text-overdue-500">
                      {errors.fields.emailAddress.message}
                    </Text>
                  ) : null}
                  <AuthTextField
                    label={t.auth.password}
                    value={password}
                    onChangeText={setPassword}
                    secureEntry
                    autoComplete="new-password"
                  />
                  {errors.fields.password ? (
                    <Text className="text-sm font-grotesk-medium text-overdue-500">
                      {errors.fields.password.message}
                    </Text>
                  ) : null}
                  <View nativeID="clerk-captcha" />
                  {sendCodeError ? (
                    <Text className="text-sm font-grotesk-medium text-overdue-500">
                      {sendCodeError}
                    </Text>
                  ) : null}
                  <AnimatedPressable
                    onPress={handleSignUp}
                    disabled={fetchStatus === "fetching"}
                    scaleTo={0.98}
                    className="btn btn--primary mt-1"
                    style={fetchStatus === "fetching" ? { opacity: 0.6 } : undefined}
                  >
                    <Text className="font-grotesk-bold text-lg text-on-accent">
                      {t.auth.signUpButton}
                    </Text>
                  </AnimatedPressable>
                </Animated.View>
              ) : (
                <Animated.View
                  entering={FadeIn.duration(220)}
                  exiting={FadeOut.duration(150)}
                >
                  <AnimatedPressable
                    onPress={() => setShowEmailForm(true)}
                    className="items-center"
                  >
                    <Text className="font-grotesk-semibold text-sm text-ink-cream-muted underline">
                      {t.auth.continueWithEmail}
                    </Text>
                  </AnimatedPressable>
                </Animated.View>
              )}
            </Animated.View>

            <Animated.View
              layout={REVEAL_LAYOUT}
              className="mt-5 flex-row justify-center gap-1"
            >
              <Text className="font-grotesk-regular text-sm text-ink-cream-muted">
                {t.auth.haveAccount}
              </Text>
              <AnimatedPressable onPress={() => router.push("/(auth)/sign-in")}>
                <Text className="font-grotesk-bold text-sm text-orange-500">
                  {t.auth.logIn}
                </Text>
              </AnimatedPressable>
            </Animated.View>
          </Animated.View>

          <Animated.View layout={REVEAL_LAYOUT} className="mt-10">
            <Text className="px-4 text-center font-grotesk-regular text-xs text-ink-cream-muted">
              {t.auth.terms}
            </Text>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>

      <VerificationModal
        visible={modalVisible}
        email={email}
        onClose={() => setModalVisible(false)}
        onVerify={handleVerifyCode}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  planRows: {
    flexGrow: 1,
    justifyContent: "center",
    gap: PLAN_SPACE,
    padding: PLAN_SPACE,
  },
  // Inset by the card's padding, which also keeps its square corners clear of
  // the card's rounded ones.
  planFade: {
    position: "absolute",
    left: PLAN_SPACE,
    right: PLAN_SPACE,
    bottom: 0,
    height: PLAN_FADE_HEIGHT,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 1,
    pointerEvents: "none",
  },
});
