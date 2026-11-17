import * as Font from "expo-font";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Platform, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FadeUp, footerBottom, MAX_FONT_SCALE, ONB, PrimaryButton, rowDirection, useIsRtl } from "@/components/onboarding/OnboardingKit";
import { useRtlText } from "@/hooks/useRtlText";
import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";
import { useTranslation } from "@/hooks/useTranslation";

// 08 · A note from the founder (screens/08-founder-note.html). Static: the
// note on lined paper, slightly tilted, taped at the top, signed in Caveat.
// If the note is ever taller than the room (a long translation, large system
// text) it scrolls, rather than running under Continue.

/**
 * The note's line height; the ruled lines are spaced to it. The paper and its
 * writing are a size smaller than the mock's (16 px on 28 px lines instead of
 * 18 on 32 — asked 2026-11-12).
 */
const LINE = 28;
/** The paper's top padding; each rule sits 5 px above the bottom of its text line. */
const PAPER_TOP = 28;

export default function OnboardingFounder() {
  const t = useTranslation();
  const copy = t.onboardingFlow.founder;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const rtl = useIsRtl();
  const rtlText = useRtlText();
  useStatusBarStyle("dark");
  const [paperHeight, setPaperHeight] = useState(0);
  // Larger system text makes the lines taller too (up to MAX_FONT_SCALE): the
  // rules follow, so the writing stays on them.
  const { fontScale } = useWindowDimensions();
  const line = LINE * Math.min(Math.max(fontScale, 1), MAX_FONT_SCALE);
  const ruleTop = (index: number) => PAPER_TOP + (index + 1) * line - 4;
  const rules = Math.max(0, Math.floor((paperHeight - PAPER_TOP) / line));

  return (
    <View style={{ flex: 1, backgroundColor: ONB.paper }}>
      <ScrollView
        style={{ flex: 1, marginTop: insets.top + 13 }}
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 }}
        showsVerticalScrollIndicator={false}
      >
        <FadeUp delay={120} style={{ gap: 22 }}>
          <View style={[{ alignItems: "center", gap: 12, paddingHorizontal: 6 }, rowDirection(rtl)]}>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: ONB.ink, alignItems: "center", justifyContent: "center" }}>
              <Text maxFontSizeMultiplier={1} className="font-grotesk-bold text-[17px] text-[#FAF1E4]">
                {copy.initials}
              </Text>
            </View>
            <View style={{ gap: 2 }}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="font-grotesk-bold text-[17px] text-[#221C17]" style={rtlText}>
                {copy.title}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="font-grotesk-regular text-[14px] text-[#7A6E64]" style={rtlText}>
                {copy.place}
              </Text>
            </View>
          </View>

          <View style={{ marginHorizontal: 22, transform: [{ rotate: rtl ? "1.6deg" : "-1.6deg" }] }}>
            {Platform.OS === "android" ? (
              <View style={{ position: "absolute", left: 2, right: 2, top: 8, bottom: -8, borderRadius: 4, backgroundColor: "rgba(60,35,15,0.08)" }} />
            ) : null}
            <View
              onLayout={(event) => setPaperHeight(event.nativeEvent.layout.height)}
              style={[
                {
                  backgroundColor: "#FFFDF7",
                  paddingTop: PAPER_TOP,
                  paddingBottom: 20,
                  paddingLeft: rtl ? 18 : 30,
                  paddingRight: rtl ? 30 : 18,
                  overflow: "hidden",
                },
                // iOS draws the mock's shadow. Android gets none here: an elevation
                // shadow on a rotated view is drawn as a square and misbehaves —
                // the soft layer behind the paper (below) stands in for it.
                Platform.OS === "ios" ? { boxShadow: "0 1px 1px rgba(60,35,15,0.06), 0 14px 30px rgba(60,35,15,0.13)" } : null,
              ]}
            >
              {/* Ruled lines, and the red margin line. */}
              {Array.from({ length: rules }, (_, index) => (
                <View key={index} style={{ position: "absolute", left: 0, right: 0, top: ruleTop(index), height: 1, backgroundColor: "#EBDDCB" }} />
              ))}
              <View style={{ position: "absolute", top: 0, bottom: 0, width: 1.5, backgroundColor: "rgba(242,106,46,0.35)", ...(rtl ? { right: 17 } : { left: 17 }) }} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[{ fontSize: 16, lineHeight: LINE, fontFamily: "SpaceGrotesk-Regular", color: ONB.ink }, rtlText]}>
                {copy.quote}
              </Text>
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={[
                  { marginTop: 4, fontSize: 26, lineHeight: LINE, color: ONB.deepOrange },
                  // The handwriting only once its font has loaded (it's new to the app).
                  Font.isLoaded("Caveat-SemiBold") ? { fontFamily: "Caveat-SemiBold" } : { fontFamily: "SpaceGrotesk-Medium", fontStyle: "italic", fontSize: 21 },
                  rtlText,
                ]}
              >
                {copy.signature}
              </Text>
            </View>
            {/* The tape holding it up. */}
            <View
              style={[
                { position: "absolute", left: "50%", top: -12, width: 92, height: 24, marginLeft: -46, backgroundColor: "rgba(252,226,210,0.85)", transform: [{ rotate: "2deg" }] },
                Platform.OS === "ios" ? { boxShadow: "0 1px 3px rgba(60,35,15,0.1)" } : null,
              ]}
            />
          </View>
        </FadeUp>
      </ScrollView>
      <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: footerBottom(insets.bottom) }}>
        <PrimaryButton label={t.onboardingFlow.continue} onPress={() => router.push("/onboarding/expect")} />
      </View>
    </View>
  );
}
