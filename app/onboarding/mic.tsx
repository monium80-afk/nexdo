import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from "expo-audio";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { CTA_SHADOW, footerBottom, MAX_FONT_SCALE, ONB, ONB_PROGRESS, ProgressHeader, TextButton, useSvgId } from "@/components/onboarding/OnboardingKit";
import { CSS_OUT, kf, LINEAR, useTimeline, useTimelineStyle } from "@/components/onboarding/timeline";
import { useRtlText } from "@/hooks/useRtlText";
import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";
import { useTranslation } from "@/hooks/useTranslation";
import { requestAiConsent } from "@/lib/aiConsentPrompt";
import { showAlert } from "@/lib/alert";
import { posthog } from "@/lib/posthog";

// 06 · Mic primer (screens/06-mic-primer.html): before the phone's own
// question, a sheet says why the microphone is wanted. "Allow microphone"
// asks for Nexdo's AI consent (the audio goes to Google's AI to be
// understood), then the phone's permission; "I'd rather type" — or a no to
// either — goes on to the brain dump with the keyboard instead.

// The sheet slides up (0.45 s), then a shine crosses the button once
// (0.3 s later, for 1.1 s). Once that's over, React draws the sheet in place,
// so it can't stay off screen if the animation didn't run.
const SHEET_END = 0.45;
const SHINE_START = SHEET_END + 0.3;
const END = SHINE_START + 1.1;
/** The call to action, as on every other screen (50 high, 16 px). */
const BUTTON_HEIGHT = 50;

export default function OnboardingMic() {
  const t = useTranslation();
  const copy = t.onboardingFlow.mic;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const rtl = useRtlText();
  useStatusBarStyle("dark");
  const [busy, setBusy] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(420);

  const [buttonWidth, setButtonWidth] = useState(0);
  const timeline = useTimeline(END);
  const sheetStyle = useTimelineStyle(timeline, (t) => {
    "worklet";
    return { transform: [{ translateY: (1 - kf(t, [[0, 0], [SHEET_END, 1]], CSS_OUT)) * sheetHeight }] };
  });
  const dimStyle = useTimelineStyle(timeline, (t) => {
    "worklet";
    return { opacity: kf(t, [[0, 0], [SHEET_END, 1]], CSS_OUT) };
  });
  const shineStyle = useTimelineStyle(timeline, (t) => {
    "worklet";
    return { transform: [{ translateX: -80 + kf(t, [[SHINE_START, 0], [END, 1]], LINEAR) * (buttonWidth * 1.1 + 80) }] };
  });
  const shineId = useSvgId("shine");

  const goToDump = (mode: "voice" | "type") => router.push({ pathname: "/onboarding/dump", params: { mode } });

  const handleAllow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Nothing is sent to the AI without a yes (lib/aiConsent.ts).
      const consented = await requestAiConsent();
      if (!consented) {
        posthog.capture("onboarding_mic_answered", { consent: false, granted: false });
        goToDump("type");
        return;
      }
      const granted = (await getRecordingPermissionsAsync()).granted || (await requestRecordingPermissionsAsync()).granted;
      posthog.capture("onboarding_mic_answered", { consent: true, granted });
      if (!granted) {
        showAlert(copy.deniedTitle, copy.deniedBody);
        goToDump("type");
        return;
      }
      goToDump("voice");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: ONB.paper }}>
      <View style={{ marginTop: insets.top + 7, paddingHorizontal: 20, zIndex: 6 }}>
        <ProgressHeader percent={ONB_PROGRESS.mic} onBack={() => router.back()} />
      </View>
      {/* The brain dump's headline, waiting behind the sheet where 07 shows it. */}
      <View style={{ position: "absolute", left: 24, right: 24, top: insets.top + 71, opacity: 0.5 }}>
        <Text className="font-grotesk-bold text-[28px] leading-[31px] tracking-[-0.7px] text-[#221C17]" style={rtl}>
          {copy.headline}
        </Text>
      </View>
      <Animated.View pointerEvents="none" style={[{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(34,28,23,0.35)", zIndex: 3 }, dimStyle]} />

      <Animated.View
        accessibilityViewIsModal
        onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}
        style={[
          {
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 4,
            borderTopLeftRadius: 30,
            borderTopRightRadius: 30,
            backgroundColor: ONB.paper,
            paddingTop: 14,
            paddingHorizontal: 22,
            paddingBottom: footerBottom(insets.bottom),
            alignItems: "center",
            gap: 14,
          },
          sheetStyle,
        ]}
      >
        <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: "#DCCFBF" }} />
        <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: ONB.orange, alignItems: "center", justifyContent: "center", marginTop: 8 }}>
          {/* The 10 px ring around it (a spread shadow in the mock). */}
          <View style={{ position: "absolute", left: -10, top: -10, width: 104, height: 104, borderRadius: 52, borderWidth: 10, borderColor: "rgba(242,106,46,0.15)" }} />
          <Svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <Rect x={9} y={3} width={6} height={11} rx={3} />
            <Path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
          </Svg>
        </View>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="mt-1 text-center font-grotesk-bold text-[24px] tracking-[-0.48px] text-[#221C17]">
          {copy.title}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="text-center font-grotesk-regular text-[15.5px] leading-[22.5px] text-[#7A6E64]">
          {copy.body}
        </Text>

        <AnimatedPressable
          onPress={() => void handleAllow()}
          disabled={busy}
          scaleTo={0.97}
          accessibilityRole="button"
          accessibilityLabel={copy.allow}
          onLayout={(event) => setButtonWidth(event.nativeEvent.layout.width)}
          style={[
            { alignSelf: "stretch", marginTop: 6, height: BUTTON_HEIGHT, borderRadius: BUTTON_HEIGHT / 2, backgroundColor: ONB.orange, overflow: "hidden", alignItems: "center", justifyContent: "center" },
            CTA_SHADOW,
          ]}
        >
          <Animated.View pointerEvents="none" style={[{ position: "absolute", top: 0, bottom: 0, left: 0, width: 60 }, shineStyle]}>
            <Svg width={60} height={BUTTON_HEIGHT}>
              <Defs>
                <LinearGradient id={shineId} x1="0" y1="0.4" x2="1" y2="0.6">
                  <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0} />
                  <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity={0.4} />
                  <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
                </LinearGradient>
              </Defs>
              <Rect width={60} height={BUTTON_HEIGHT} fill={`url(#${shineId})`} />
            </Svg>
          </Animated.View>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1} className="font-grotesk-bold text-[16px] text-white">
            {copy.allow}
          </Text>
        </AnimatedPressable>
        <TextButton
          label={copy.type}
          color={ONB.ink}
          disabled={busy}
          onPress={() => {
            posthog.capture("onboarding_mic_skipped");
            goToDump("type");
          }}
        />
      </Animated.View>
    </View>
  );
}
