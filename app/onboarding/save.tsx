import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import Animated, { useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path, Rect } from "react-native-svg";

import { AuthButtons, EmailSignUpForm } from "@/components/onboarding/AuthButtons";
import {
  draftLine,
  draftScore,
  FadeUp,
  footerBottom,
  MAX_FONT_SCALE,
  ONB,
  ONB_PROGRESS,
  OnboardingTitle,
  PaperFade,
  ProgressHeader,
  rowDirection,
  TaskRow,
  useIsRtl,
} from "@/components/onboarding/OnboardingKit";
import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";
import { useTranslation } from "@/hooks/useTranslation";
import { useOnboardingStore } from "@/store/useOnboardingStore";

// 13 · Save your tasks (screens/13-save-your-tasks.html). The tasks from the
// brain dump, most pressing first, "not saved yet" — and the account that
// saves them: Google, Apple (iOS), email. Signing up here turns the drafts
// into real tasks (hooks/useAuthSync.ts); "Log in" goes to 14. The list
// scrolls inside its space, fading at an edge only where there's more.

const FILL = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } as const;
const FADE_TOP = 22;
/** The mock's mask: solid to 72 %, then fading out. */
const FADE_BOTTOM = 56;

export default function OnboardingSave() {
  const t = useTranslation();
  const copy = t.onboardingFlow.save;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const rtl = useIsRtl();
  useStatusBarStyle("dark");
  const [emailOpen, setEmailOpen] = useState(false);
  const [now] = useState(() => new Date());
  const drafts = useOnboardingStore((state) => state.drafts);
  const sorted = useMemo(() => [...drafts].sort((a, b) => draftScore(b, now) - draftScore(a, now)), [drafts, now]);

  // The fades show only where there's more to scroll to.
  const offset = useSharedValue(0);
  const contentHeight = useSharedValue(0);
  const boxHeight = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    offset.value = event.contentOffset.y;
  });
  const topFade = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, offset.value / FADE_TOP)) }));
  const bottomFade = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, (contentHeight.value - boxHeight.value - offset.value) / FADE_BOTTOM)),
  }));

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: ONB.paper }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={{ marginTop: insets.top + 7, paddingHorizontal: 20 }}>
        <ProgressHeader percent={ONB_PROGRESS.save} onBack={() => router.back()} />
      </View>
      <View style={{ flex: 1, marginTop: 24, paddingHorizontal: 20, gap: 22 }}>
        <OnboardingTitle title={copy.headline} body={copy.body} />
        {/* Email: the form takes the list's place, high on the screen, so the keyboard never has to push the page up. */}
        {emailOpen ? (
          <FadeUp style={{ flex: 1 }}>
            <EmailSignUpForm onCancel={() => setEmailOpen(false)} />
          </FadeUp>
        ) : sorted.length > 0 ? (
          <FadeUp delay={120} style={{ flex: 1, minHeight: 0, gap: 10 }}>
            <View style={[{ justifyContent: "flex-end", alignItems: "center", paddingHorizontal: 4 }, rowDirection(rtl)]}>
              <View style={[{ alignItems: "center", gap: 5 }, rowDirection(rtl)]}>
                <Svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={ONB.deepOrange} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <Rect x={5} y={11} width={14} height={10} rx={2.5} />
                  <Path d="M8 11V8a4 4 0 0 1 8 0v3" />
                </Svg>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="font-grotesk-semibold text-[12.5px] text-[#C4461A]">
                  {copy.notSaved}
                </Text>
              </View>
            </View>
            <View style={{ flex: 1, minHeight: 0, marginHorizontal: -6 }}>
              <Animated.ScrollView
                onScroll={onScroll}
                scrollEventThrottle={16}
                onLayout={(event) => {
                  boxHeight.value = event.nativeEvent.layout.height;
                }}
                onContentSizeChange={(_, height) => {
                  contentHeight.value = height;
                }}
                contentContainerStyle={{ paddingHorizontal: 6, paddingTop: 2, paddingBottom: 24, gap: 8 }}
                showsVerticalScrollIndicator={false}
              >
                {sorted.map((draft, index) => (
                  <TaskRow
                    key={draft.candidateId ?? `${draft.title}-${index}`}
                    title={draft.title}
                    meta={draftLine(draft, now, t)}
                    score={draftScore(draft, now)}
                    metaColor={index === 0 ? ONB.deepOrange : ONB.muted}
                  />
                ))}
              </Animated.ScrollView>
              <Animated.View pointerEvents="none" style={[FILL, topFade]}>
                <PaperFade top={FADE_TOP} />
              </Animated.View>
              <Animated.View pointerEvents="none" style={[FILL, bottomFade]}>
                <PaperFade bottom={FADE_BOTTOM} />
              </Animated.View>
            </View>
          </FadeUp>
        ) : (
          <View style={{ flex: 1 }} />
        )}
      </View>

      {emailOpen ? null : (
        <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: footerBottom(insets.bottom), gap: 8 }}>
          <AuthButtons mode="signUp" onEmail={() => setEmailOpen(true)} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="text-center font-grotesk-regular text-[14.5px] text-[#7A6E64]">
            {copy.haveAccount}{" "}
            <Text onPress={() => router.push({ pathname: "/onboarding/log-in", params: { from: "save" } })} accessibilityRole="link" style={{ color: ONB.ink, fontFamily: "SpaceGrotesk-Bold" }}>
              {copy.logIn}
            </Text>
          </Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
