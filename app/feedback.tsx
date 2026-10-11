import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { IconButton, PrimaryButton, SecondaryButton } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { FormSection } from "@/components/FormSection";
import { IconTile } from "@/components/IconTile";
import { ImageViewerModal } from "@/components/ImageViewerModal";
import { ScreenHeader } from "@/components/ScreenHeader";
import { TextField } from "@/components/TextField";
import { useRtlText } from "@/hooks/useRtlText";
import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import {
  FEEDBACK_MESSAGE_MAX,
  sendFeedback,
  toFeedbackScreenshot,
  type FeedbackScreenshot,
  type FeedbackType,
} from "@/lib/feedback";

const FEEDBACK_TYPES: FeedbackType[] = ["suggestion", "bug", "general", "other"];

// The counter only shows once the message gets near the limit.
const COUNTER_FROM = FEEDBACK_MESSAGE_MAX - 500;

const THUMB = 56;

// Same raised tray as Add Task's footer.
const FOOTER_SHADOW = { boxShadow: "0 -8px 24px -12px rgba(92, 58, 26, 0.3)" };

/**
 * Settings → Send feedback. The user is signed in, so nothing about who they
 * are is asked for: the database links the feedback to their account
 * (lib/feedback.ts).
 */
export default function Feedback() {
  const colors = useColors();
  const t = useTranslation();
  const rtl = useRtlText();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isLoaded, isSignedIn, userId } = useAuth();
  useStatusBarStyle("light");

  const [type, setType] = useState<FeedbackType>("suggestion");
  const [message, setMessage] = useState("");
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
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.charcoal[900] }} edges={["top"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScreenHeader
          title={t.feedback.title}
          subtitle={t.feedback.subtitle}
          accent
          actions={<IconButton icon="x" variant="header" onPress={handleClose} accessibilityLabel={t.common.close} />}
        />

        <View className="screen-body">
          {sent ? (
            <View className="flex-1 justify-center px-8">
              <EmptyState icon="check" title={t.feedback.success} body={t.feedback.successBody} />
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={{ paddingBottom: 24 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View className="gap-2 px-3 pt-4">
                <FormSection icon="tag" label={t.feedback.typeLabel} plain>
                  <View className="flex-row flex-wrap gap-2">
                    {FEEDBACK_TYPES.map((value) => (
                      <Chip
                        key={value}
                        label={t.feedback.types[value]}
                        selected={type === value}
                        solid
                        accessibilityRole="radio"
                        onPress={() => setType(value)}
                      />
                    ))}
                  </View>
                </FormSection>

                <FormSection icon="message-square" label={t.feedback.messageLabel} required>
                  <TextField
                    value={message}
                    onChangeText={(text) => {
                      setMessage(text);
                      if (messageTouched) setMessageTouched(false);
                    }}
                    placeholder={t.feedback.messagePlaceholder}
                    multiline
                    maxLength={FEEDBACK_MESSAGE_MAX}
                    error={messageTouched}
                    inputStyle={{ minHeight: 120 }}
                  />
                  {messageTouched ? (
                    <Text className="font-grotesk-medium text-sm text-overdue-500" style={rtl}>
                      {t.feedback.messageRequired}
                    </Text>
                  ) : null}
                  {message.length >= COUNTER_FROM ? (
                    <Text className="self-end font-grotesk-medium text-xs text-ink-cream-muted">
                      {message.length}/{FEEDBACK_MESSAGE_MAX}
                    </Text>
                  ) : null}
                </FormSection>

                <FormSection icon="image" label={t.feedback.screenshotLabel} hint={t.feedback.optional}>
                  {screenshot ? (
                    <View className="card card--cream-inset flex-row items-center gap-3 py-[6px] pl-[6px] pr-1.5">
                      <AnimatedPressable
                        onPress={() => setViewingScreenshot(true)}
                        scaleTo={0.94}
                        accessibilityRole="imagebutton"
                        accessibilityLabel={t.feedback.viewScreenshot}
                      >
                        <Image
                          source={{ uri: screenshot.uri }}
                          resizeMode="cover"
                          style={{ width: THUMB, height: THUMB }}
                          className="rounded-xl bg-cream-200"
                        />
                      </AnimatedPressable>
                      <Text className="flex-1 font-grotesk-semibold text-sm text-ink-cream" style={rtl}>
                        {t.feedback.screenshotAttached}
                      </Text>
                      <IconButton
                        icon="x"
                        onPress={() => setScreenshot(null)}
                        accessibilityLabel={t.feedback.removeScreenshot}
                      />
                    </View>
                  ) : (
                    // Laid out like Add Task's "Open AI Chat instead" row.
                    <AnimatedPressable
                      onPress={handlePickScreenshot}
                      accessibilityRole="button"
                      scaleTo={0.98}
                      className="card card--cream-inset flex-row items-center gap-2.5 py-[5px] pl-[6px] pr-3"
                    >
                      <IconTile icon="paperclip" size="sm" tone="neutral" />
                      <Text className="flex-1 font-grotesk-semibold text-sm text-ink-cream" style={rtl}>
                        {t.feedback.addScreenshot}
                      </Text>
                      <Feather name="plus" size={16} color={colors.ink.creamSubtle} />
                    </AnimatedPressable>
                  )}
                  {screenshotNote ? (
                    <Text className="font-grotesk-medium text-sm text-overdue-500" style={rtl}>
                      {screenshotNote}
                    </Text>
                  ) : null}
                </FormSection>

                <Text className="px-3 pt-2 text-center font-grotesk-medium text-xs text-ink-cream-muted" style={rtl}>
                  {t.feedback.privacyNote}
                </Text>
              </View>
            </ScrollView>
          )}

          <View
            className="gap-3 rounded-t-[28px] border-t border-white/80 bg-cream-50 px-6 pt-3"
            style={[{ paddingBottom: insets.bottom + 21 }, FOOTER_SHADOW]}
          >
            {error ? (
              <Text className="font-grotesk-medium text-sm text-overdue-500" style={rtl}>
                {error}
              </Text>
            ) : null}
            {sent ? (
              <PrimaryButton size="lg" label={t.common.done} onPress={handleClose} />
            ) : (
              <View className="flex-row items-center gap-3">
                <SecondaryButton size="lg" label={t.common.cancel} onPress={handleClose} className="flex-1" />
                <PrimaryButton
                  icon="send"
                  size="lg"
                  label={sending ? t.feedback.sending : t.feedback.submit}
                  disabled={sending}
                  onPress={handleSubmit}
                  className="flex-[1.5]"
                />
              </View>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>

      {viewingScreenshot && screenshot ? (
        <ImageViewerModal uri={screenshot.uri} onClose={() => setViewingScreenshot(false)} />
      ) : null}
    </SafeAreaView>
  );
}
