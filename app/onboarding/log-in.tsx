import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";

import { GemMascot } from "@/components/GemMascot";
import { AuthButtons, EmailLogInForm } from "@/components/onboarding/AuthButtons";
import { BackButton, FadeUp, footerBottom, MAX_FONT_SCALE, ONB, useSvgId } from "@/components/onboarding/OnboardingKit";
import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";
import { useTranslation } from "@/hooks/useTranslation";

// 14 · Log in (screens/14-log-in.html): the same buttons as 13, worded "Log
// in with…", under the gem. "Create an account" goes to 13; the back arrow
// returns to wherever this was opened from (13, or "I already have an
// account" on the hook).

export default function OnboardingLogIn() {
  const t = useTranslation();
  const copy = t.onboardingFlow.logIn;
  const router = useRouter();
  // The gem rests while another screen is in front of this one.
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ from?: string }>();
  useStatusBarStyle("dark");
  const [emailOpen, setEmailOpen] = useState(false);
  const glowId = useSvgId("loginGlow");

  const toSignUp = () => {
    if (params.from === "save" && router.canGoBack()) router.back();
    else router.push("/onboarding/save");
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: ONB.paper }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={{ marginTop: insets.top + 7, paddingHorizontal: 20, height: 40 }}>
        <BackButton onPress={() => (router.canGoBack() ? router.back() : router.replace("/onboarding"))} />
      </View>

      {emailOpen ? (
        // Email: the form sits high on the screen, so the keyboard never has to push the page up.
        <FadeUp style={{ flex: 1, paddingHorizontal: 20, paddingTop: 24, gap: 22 }}>
          <View style={{ alignItems: "center", gap: 8 }}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="text-center font-grotesk-bold text-[28px] leading-[31px] tracking-[-0.84px] text-[#221C17]">
              {copy.headline}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="text-center font-grotesk-regular text-[16px] leading-[23px] text-[#7A6E64]">
              {copy.body}
            </Text>
          </View>
          <EmailLogInForm onCancel={() => setEmailOpen(false)} />
        </FadeUp>
      ) : (
        <>
          <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 20 }}>
            <FadeUp style={{ alignItems: "center", marginTop: -40 }}>
              <View style={{ width: 120, height: 132, alignItems: "center" }}>
                <View style={{ position: "absolute", top: 10, left: 60 - 110, width: 220, height: 220 }}>
                  <Svg width={220} height={220}>
                    <Defs>
                      {/* CSS sizes the mock's radial-gradient to the box's corner (√2 × half the side). */}
                      <RadialGradient id={glowId} cx="50%" cy="50%" r="70.7%">
                        <Stop offset="0" stopColor="#FFAF50" stopOpacity={0.42} />
                        <Stop offset="0.64" stopColor={ONB.orange} stopOpacity={0} />
                      </RadialGradient>
                    </Defs>
                    <Rect width={220} height={220} fill={`url(#${glowId})`} />
                  </Svg>
                </View>
                <GemMascot level={4} width={120} animate={focused} />
              </View>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="mt-[18px] text-center font-grotesk-bold text-[28px] leading-[31px] tracking-[-0.84px] text-[#221C17]">
                {copy.headline}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="mt-2.5 text-center font-grotesk-regular text-[16px] leading-[23px] text-[#7A6E64]">
                {copy.body}
              </Text>
            </FadeUp>
          </View>

          <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: footerBottom(insets.bottom), gap: 8 }}>
            <AuthButtons mode="logIn" onEmail={() => setEmailOpen(true)} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="text-center font-grotesk-regular text-[14.5px] text-[#7A6E64]">
              {copy.newHere}{" "}
              <Text onPress={toSignUp} accessibilityRole="link" style={{ color: ONB.ink, fontFamily: "SpaceGrotesk-Bold" }}>
                {copy.createAccount}
              </Text>
            </Text>
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}
