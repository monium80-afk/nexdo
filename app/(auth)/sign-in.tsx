import { useSignIn } from "@clerk/expo";
import { useSSO } from "@clerk/expo/experimental";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { AuthTextField } from "@/components/AuthTextField";
import { SocialAuthButton } from "@/components/SocialAuthButton";
import { VerificationModal } from "@/components/VerificationModal";
import { gradients } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { SSO_REDIRECT_URL } from "@/lib/clerk";
import { posthog } from "@/lib/posthog";

const REVEAL_LAYOUT = LinearTransition.duration(250);

export default function SignIn() {
  const colors = useColors();
  const t = useTranslation();
  const rtl = useRtlText();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signIn, errors, fetchStatus } = useSignIn();
  const { startSSOFlow } = useSSO();
  const [showEmailForm, setShowEmailForm] = useState(false);
  // Email first. An account with a password is then asked for it — which is
  // also how app store reviewers get in, since they can't read a code sent to
  // the demo account's inbox. Any other account is emailed a code, and "Use
  // email code instead" is there for anyone who forgot their password.
  const [step, setStep] = useState<"email" | "password">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [modalVisible, setModalVisible] = useState(false);
  // Which code the modal is checking: the sign-in itself, or the one Clerk
  // asks for after a password on a phone it hasn't seen before.
  const [codeStep, setCodeStep] = useState<"signIn" | "newDevice">("signIn");
  const [formError, setFormError] = useState<string | null>(null);
  const [socialError, setSocialError] = useState<string | null>(null);

  const handleSocialAuth = async (provider: "google" | "apple") => {
    posthog.capture('sign_in_social_tapped', { provider })
    setSocialError(null);
    try {
      const { createdSessionId } = await startSSOFlow({
        strategy: provider === "google" ? "oauth_google" : "oauth_apple",
        redirectUrl: SSO_REDIRECT_URL,
      });
      if (createdSessionId) {
        posthog.capture('sign_in_completed', { method: 'social', provider })
        router.replace("/");
      }
      // No session and no error: the browser was closed — nothing to say.
    } catch (err) {
      console.error("Social sign-in error:", JSON.stringify(err, null, 2));
      posthog.captureException(err instanceof Error ? err : new Error(String(err)), {
        context: 'sign_in_social',
        provider,
      })
      setSocialError(t.auth.somethingWrong);
    }
  };

  const finishSignIn = async (method: "email" | "password") => {
    const { error } = await signIn.finalize({
      navigate: () => {
        posthog.capture('sign_in_completed', { method })
        router.replace("/")
      },
    });
    return error ? (error.longMessage ?? t.auth.somethingWrong) : undefined;
  };

  // Both callers come after handleContinue, whose sign-in already holds the address.
  const handleSendCode = async () => {
    const { error } = await signIn.emailCode.sendCode();
    if (error) {
      setFormError(error.longMessage ?? t.auth.sendCodeError);
      return;
    }
    setCodeStep("signIn");
    setModalVisible(true);
  };

  const handleContinue = async () => {
    const { error } = await signIn.create({ identifier: email.trim() });
    if (error) {
      setFormError(error.longMessage ?? t.auth.somethingWrong);
      return;
    }
    // Clerk offers "password" as a way in only to accounts that have one.
    if (signIn.supportedFirstFactors.some((factor) => factor.strategy === "password")) {
      setStep("password");
      return;
    }
    await handleSendCode();
  };

  const handlePasswordLogIn = async () => {
    if (!password) return;
    const { error } = await signIn.password({ password });
    if (error) {
      setFormError(error.longMessage ?? t.auth.somethingWrong);
      return;
    }
    if (signIn.status === "complete") {
      const finalizeError = await finishSignIn("password");
      if (finalizeError) setFormError(finalizeError);
      return;
    }
    // A password from a phone Clerk hasn't seen this account on is confirmed
    // with a code sent to the account's email (Clerk's Client Trust).
    const emailCodeOffered = signIn.supportedSecondFactors.some((factor) => factor.strategy === "email_code");
    if ((signIn.status === "needs_client_trust" || signIn.status === "needs_second_factor") && emailCodeOffered) {
      const { error: sendError } = await signIn.mfa.sendEmailCode();
      if (sendError) {
        setFormError(sendError.longMessage ?? t.auth.sendCodeError);
        return;
      }
      setCodeStep("newDevice");
      setModalVisible(true);
      return;
    }
    setFormError(t.auth.somethingWrong);
  };

  const handleSubmit = async () => {
    if (!email.trim()) return;
    setFormError(null);
    if (step === "password") await handlePasswordLogIn();
    else await handleContinue();
  };

  const handleUseCode = async () => {
    setFormError(null);
    await handleSendCode();
  };

  // Another address may or may not have a password: back to the first step.
  const handleEmailChange = (text: string) => {
    setEmail(text);
    if (step === "password") {
      setStep("email");
      setPassword("");
      setFormError(null);
    }
  };

  // A problem with the address or password shows as that; anything else (no
  // connection, too many tries) as what the request ran into.
  const fieldError = errors.fields.identifier?.message ?? (step === "password" ? errors.fields.password?.message : undefined);
  const logInError = fieldError ?? formError;

  const handleVerifyCode = async (code: string) => {
    const { error } =
      codeStep === "newDevice" ? await signIn.mfa.verifyEmailCode({ code }) : await signIn.emailCode.verifyCode({ code });
    if (error) return error.longMessage ?? t.auth.invalidCode;

    if (signIn.status === "complete") {
      return finishSignIn(codeStep === "newDevice" ? "password" : "email");
    }
    return t.auth.somethingWrong;
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream[100] }}>
      {/* The onboarding steps' warm corner light (OnboardingLayout). */}
      <View
        pointerEvents="none"
        className="absolute left-0 right-0"
        style={[{ top: -insets.top, height: 420 + insets.top }, gradients.creamGlow]}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View>
            <View className="mt-16 gap-3">
              <Text className="text-title text-ink-cream" style={rtl}>
                {t.auth.welcomeBack}
              </Text>
              <Text className="text-base font-grotesk-regular leading-relaxed text-ink-cream-muted" style={rtl}>
                {t.auth.signInSubtitle}
              </Text>
            </View>

            <View className="mt-8 gap-3">
              <SocialAuthButton
                provider="google"
                onPress={() => handleSocialAuth("google")}
              />
              <SocialAuthButton
                provider="apple"
                onPress={() => handleSocialAuth("apple")}
              />
              {socialError ? (
                <Text className="text-sm font-grotesk-medium text-overdue-500" style={rtl}>
                  {socialError}
                </Text>
              ) : null}
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
                    onChangeText={handleEmailChange}
                    keyboardType="email-address"
                    autoComplete="email"
                  />
                  {step === "password" ? (
                    <AuthTextField
                      label={t.auth.password}
                      value={password}
                      onChangeText={setPassword}
                      secureEntry
                      autoComplete="current-password"
                      autoFocus
                    />
                  ) : null}
                  {logInError ? (
                    <Text className="text-sm font-grotesk-medium text-overdue-500">
                      {logInError}
                    </Text>
                  ) : null}
                  <AnimatedPressable
                    onPress={handleSubmit}
                    disabled={fetchStatus === "fetching"}
                    scaleTo={0.98}
                    className="btn btn--primary mt-1"
                    style={[gradients.accent, fetchStatus === "fetching" ? { opacity: 0.6 } : null]}
                  >
                    <Text className="font-grotesk-bold text-lg text-on-accent">
                      {step === "password" ? t.auth.logIn : t.auth.continue}
                    </Text>
                  </AnimatedPressable>
                  {step === "password" ? (
                    <AnimatedPressable
                      onPress={handleUseCode}
                      disabled={fetchStatus === "fetching"}
                      className="items-center"
                    >
                      <Text className="font-grotesk-semibold text-sm text-ink-cream-muted underline">
                        {t.auth.useCode}
                      </Text>
                    </AnimatedPressable>
                  ) : null}
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
                {t.auth.noAccount}
              </Text>
              <AnimatedPressable onPress={() => router.push("/(auth)/sign-up")}>
                <Text className="font-grotesk-bold text-sm text-orange-500">
                  {t.auth.signUp}
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
});
