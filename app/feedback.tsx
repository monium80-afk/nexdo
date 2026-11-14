import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { SheetIcon } from "@/components/addSheet/SheetParts";
import { ImageViewerModal } from "@/components/ImageViewerModal";
import { colors } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";
import { useTranslation } from "@/hooks/useTranslation";
import {
  FEEDBACK_MESSAGE_MAX,
  sendFeedback,
  toFeedbackScreenshot,
  type FeedbackScreenshot,
  type FeedbackType,
} from "@/lib/feedback";
import { shadow, SOFT_SHADOW } from "@/constants/shadow";

const P = colors.palette;
// Idea · Bug · Other (the 2026-11 redesign; "general" is no longer offered).
const FEEDBACK_TYPES = ["suggestion", "bug", "other"] as const satisfies readonly FeedbackType[];

// The counter only shows once the message gets near the limit.
const COUNTER_FROM = FEEDBACK_MESSAGE_MAX - 500;

/**
 * Settings → Send feedback. The user is signed in, so nothing about who they
 * are is asked for: the database links the feedback to their account
 * (lib/feedback.ts).
 */
export default function Feedback() {
  const t = useTranslation();
  const rtl = useRtlText();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isLoaded, isSignedIn, userId } = useAuth();
  useStatusBarStyle("dark");
  // Opened from "Report" under something the AI wrote (components/ReportAiButton.tsx):
  // that text comes along, quoted, ready for the user to say what's wrong with it.
  const { report } = useLocalSearchParams<{ report?: string }>();

  const [type, setType] = useState<FeedbackType>(report ? "other" : "suggestion");
  const [message, setMessage] = useState(() => (report ? t.feedback.reportPrefill(report) : ""));
  const [messageTouched, setMessageTouched] = useState(false);
  const [screenshot, setScreenshot] = useState<FeedbackScreenshot | null>(null);
  const [screenshotNote, setScreenshotNote] = useState<string | null>(null);
  const [viewingScreenshot, setViewingScreenshot] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/onboarding" />;

  const handleClose = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/settings");
    }
  };

  const handlePickScreenshot = async () => {
    setScreenshotNote(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
      const asset = result.canceled ? undefined : result.assets[0];
      if (!asset) return;
      const picked = toFeedbackScreenshot(asset);
      if (picked) setScreenshot(picked);
      else setScreenshotNote(t.feedback.screenshotInvalid);
    } catch (pickError) {
      console.warn("[Feedback] couldn't pick a screenshot", pickError);
      setScreenshotNote(t.feedback.screenshotInvalid);
    }
  };

  const handleSubmit = async () => {
    if (!message.trim()) {
      setMessageTouched(true);
      return;
    }
    if (sending || !userId) return;
    setSending(true);
    setError(null);
    const result = await sendFeedback({ userId, type, message, screenshot });
    setSending(false);
    if (result === "sent") {
      setSent(true);
      return;
    }
    setError(
      result === "rate_limited" ? t.feedback.rateLimited : result === "screenshot_failed" ? t.feedback.screenshotError : t.feedback.error,
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: P.paper }} edges={["top"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Title and subtitle, the ✕ on the right. */}
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
            <View style={{ flex: 1, gap: 5 }}>
              <Text style={[{ fontFamily: "SpaceGrotesk-Bold", fontSize: 30, lineHeight: 36, letterSpacing: -0.6, color: P.ink }, rtl]}>
                {report ? t.feedback.reportTitle : t.feedback.title}
              </Text>
              <Text style={[{ fontFamily: "SpaceGrotesk-Regular", fontSize: 14, lineHeight: 18, color: P.inkMuted }, rtl]}>
                {report ? t.feedback.reportSubtitle : t.redesign.feedbackSubtitle}
              </Text>
            </View>
            <AnimatedPressable
              onPress={handleClose}
              scaleTo={0.92}
              accessibilityRole="button"
              accessibilityLabel={t.common.close}
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: P.chip, alignItems: "center", justifyContent: "center" }}
            >
              <SheetIcon name="close" size={18} color={P.ink} strokeWidth={2.2} />
            </AnimatedPressable>
          </View>

          {sent ? (
            <View style={{ marginTop: 40, alignItems: "center", gap: 10, paddingHorizontal: 16 }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: P.peach, alignItems: "center", justifyContent: "center" }}>
                <SheetIcon name="check" size={24} color={P.accentInk} strokeWidth={2.6} />
              </View>
              <Text style={{ textAlign: "center", fontFamily: "SpaceGrotesk-Bold", fontSize: 19, color: P.ink }}>{t.feedback.success}</Text>
              <Text style={{ textAlign: "center", fontFamily: "SpaceGrotesk-Regular", fontSize: 14, lineHeight: 20, color: P.inkMuted }}>{t.feedback.successBody}</Text>
            </View>
          ) : (
            <>
              {/* Idea · Bug · Other */}
              <View style={{ marginTop: 22, height: 44, borderRadius: 22, padding: 4, backgroundColor: P.chip, flexDirection: "row" }} accessibilityRole="radiogroup">
                {FEEDBACK_TYPES.map((value) => {
                  const picked = type === value;
                  return (
                    <AnimatedPressable
                      key={value}
                      onPress={() => setType(value)}
                      scaleTo={0.97}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: picked }}
                      style={{ flex: 1, borderRadius: 18, backgroundColor: picked ? P.ink : "transparent", alignItems: "center", justifyContent: "center" }}
                    >
                      <Text style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 14, color: picked ? "#FFFFFF" : P.ink }}>{t.redesign.feedbackTypes[value]}</Text>
                    </AnimatedPressable>
                  );
                })}
              </View>

              {/* The message, and a screenshot at its foot. */}
              <View
                style={{
                  marginTop: 14,
                  minHeight: 300,
                  borderRadius: 22,
                  backgroundColor: P.paperCard,
                  padding: 16,
                  borderWidth: messageTouched ? 1.5 : 0,
                  borderColor: P.alert,
                  ...SOFT_SHADOW,
                }}
              >
                <TextInput
                  value={message}
                  onChangeText={(text) => {
                    setMessage(text);
                    if (messageTouched) setMessageTouched(false);
                  }}
                  placeholder={t.redesign.feedbackPlaceholder}
                  placeholderTextColor={P.paperFaint}
                  multiline
                  maxLength={FEEDBACK_MESSAGE_MAX}
                  selectionColor={P.accent}
                  textAlignVertical="top"
                  style={[{ flex: 1, minHeight: 200, padding: 0, fontFamily: "SpaceGrotesk-Regular", fontSize: 17, lineHeight: 26, color: P.ink }, rtl]}
                />
                {message.length >= COUNTER_FROM ? (
                  <Text style={{ alignSelf: "flex-end", fontFamily: "SpaceGrotesk-Medium", fontSize: 12, color: P.inkMuted }}>
                    {message.length}/{FEEDBACK_MESSAGE_MAX}
                  </Text>
                ) : null}
                {screenshot ? (
                  <View style={{ marginTop: 12, flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <AnimatedPressable onPress={() => setViewingScreenshot(true)} scaleTo={0.94} accessibilityRole="imagebutton" accessibilityLabel={t.feedback.viewScreenshot}>
                      <Image source={{ uri: screenshot.uri }} resizeMode="cover" style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: P.chip }} />
                    </AnimatedPressable>
                    <Text style={{ flex: 1, fontFamily: "SpaceGrotesk-Regular", fontSize: 13.5, color: P.inkMuted }}>{t.feedback.screenshotAttached}</Text>
                    <AnimatedPressable onPress={() => setScreenshot(null)} scaleTo={0.9} hitSlop={8} accessibilityRole="button" accessibilityLabel={t.feedback.removeScreenshot}>
                      <SheetIcon name="close" size={16} color={P.inkMuted} />
                    </AnimatedPressable>
                  </View>
                ) : (
                  <AnimatedPressable onPress={handlePickScreenshot} scaleTo={0.98} accessibilityRole="button" style={{ marginTop: 12, flexDirection: "row", alignItems: "center", gap: 10, alignSelf: "flex-start" }}>
                    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: P.chip, alignItems: "center", justifyContent: "center" }}>
                      <Feather name="paperclip" size={17} color={P.ink} />
                    </View>
                    <Text style={{ fontFamily: "SpaceGrotesk-Regular", fontSize: 13.5, color: P.inkMuted }}>{t.redesign.addScreenshot}</Text>
                  </AnimatedPressable>
                )}
              </View>
              {messageTouched ? (
                <Text style={[{ marginTop: 8, fontFamily: "SpaceGrotesk-Medium", fontSize: 13, color: P.alert }, rtl]}>{t.feedback.messageRequired}</Text>
              ) : null}
              {screenshotNote ? (
                <Text style={[{ marginTop: 8, fontFamily: "SpaceGrotesk-Medium", fontSize: 13, color: P.alert }, rtl]}>{screenshotNote}</Text>
              ) : null}

              <Text style={[{ marginTop: 14, paddingHorizontal: 4, fontFamily: "SpaceGrotesk-Regular", fontSize: 13, lineHeight: 18.5, color: P.inkMuted }, rtl]}>
                {t.redesign.feedbackNote}
              </Text>
            </>
          )}
        </ScrollView>

        <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: insets.bottom + 16, gap: 10 }}>
          {error ? <Text style={[{ fontFamily: "SpaceGrotesk-Medium", fontSize: 13, color: P.alert }, rtl]}>{error}</Text> : null}
          <AnimatedPressable
            onPress={sent ? handleClose : handleSubmit}
            disabled={sending}
            scaleTo={0.97}
            accessibilityRole="button"
            style={{
              height: 54,
              borderRadius: 27,
              backgroundColor: P.accent,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              opacity: sending ? 0.7 : 1,
              ...shadow("0 10px 24px rgba(242, 106, 46, 0.3)", 6, "#F26A2E"),
            }}
          >
            {sent ? null : <Feather name="send" size={18} color="#FFFFFF" />}
            <Text style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 17, color: "#FFFFFF" }}>
              {sent ? t.common.done : sending ? t.feedback.sending : t.redesign.send}
            </Text>
          </AnimatedPressable>
        </View>
      </KeyboardAvoidingView>

      {viewingScreenshot && screenshot ? <ImageViewerModal uri={screenshot.uri} onClose={() => setViewingScreenshot(false)} /> : null}
    </SafeAreaView>
  );
}
