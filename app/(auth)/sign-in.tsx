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
import { SafeAreaView } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { AuthTextField } from "@/components/AuthTextField";
import { SocialAuthButton } from "@/components/SocialAuthButton";
import { VerificationModal } from "@/components/VerificationModal";
import { colors } from "@/constants/theme";
import { useScreenEnterAnimation } from "@/hooks/useScreenEnterAnimation";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import { posthog } from "@/lib/posthog";

const REVEAL_LAYOUT = LinearTransition.duration(250);

export default function SignIn() {
  const t = useTranslation();
  const rtl = useRtlText();
  const router = useRouter();
  const enterStyle = useScreenEnterAnimation();
  const { signIn, errors, fetchStatus } = useSignIn();
  const { startSSOFlow } = useSSO();
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState("");
  const [modalVisible, setModalVisible] = useState(false);

  const handleSocialAuth = async (provider: "google" | "apple") => {
    posthog.capture('sign_in_social_tapped', { provider })
    try {
      const { createdSessionId } = await startSSOFlow({
        strategy: provider === "google" ? "oauth_google" : "oauth_apple",
      });
      if (createdSessionId) {
        posthog.capture('sign_in_completed', { method: 'social', provider })
        router.replace("/");
      }
    } catch (err) {
      console.error("Social sign-in error:", JSON.stringify(err, null, 2));
      posthog.captureException(err instanceof Error ? err : new Error(String(err)), {
        context: 'sign_in_social',
        provider,
      })
    }
  };

  const handleLogIn = async () => {
    if (!email) return;
    const { error } = await signIn.emailCode.sendCode({ emailAddress: email });
    if (!error) setModalVisible(true);
  };

  const handleVerifyCode = async (code: string) => {
    const { error } = await signIn.emailCode.verifyCode({ code });
    if (error) return error.longMessage ?? t.auth.invalidCode;

    if (signIn.status === "complete") {
      const { error: finalizeError } = await signIn.finalize({
        navigate: () => {
          posthog.capture('sign_in_completed', { method: 'email' })
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
          <Animated.View style={enterStyle}>
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
                  {errors.fields.identifier ? (
                    <Text className="text-sm font-grotesk-medium text-overdue-500">
                      {errors.fields.identifier.message}
                    </Text>
                  ) : null}
                  <AnimatedPressable
                    onPress={handleLogIn}
                    disabled={fetchStatus === "fetching"}
                    scaleTo={0.98}
                    className="btn btn--primary mt-1"
                    style={fetchStatus === "fetching" ? { opacity: 0.6 } : undefined}
                  >
                    <Text className="font-grotesk-bold text-lg text-on-accent">
                      {t.auth.logIn}
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
