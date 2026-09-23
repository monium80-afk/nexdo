import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Text, TextInput, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { OnboardingLayout } from "@/components/OnboardingLayout";
import { colors } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import { extractAttachmentText } from "@/lib/ai/media";
import { getLanguage } from "@/lib/i18n";
import { posthog } from "@/lib/posthog";
import { useOnboardingStore } from "@/store/useOnboardingStore";

// The control is a big circle to talk into, and stretches into a button the
// width of the screen and the height of an ordinary call to action. Both ends
// are fully rounded, so only the two measurements have to travel.
const CIRCLE = 96;
const PILL_HEIGHT = 60;
const MORPH_DURATION = 420;

/** How tall the box is. Deliberately not flex-1 — a dump is a few lines, and
 *  the room is better spent on the thing you press to make one. */
const BOX_HEIGHT = 208;

// Metering arrives in dBFS: roughly -60 in a quiet room, 0 at the loudest the
// mic can take. Anything below the floor is silence as far as the bars care.
const DB_FLOOR = -60;
/** How often the recorder is polled — often enough for the bars to keep up. */
const METER_INTERVAL = 100;

// Five bars, each reacting a little differently to the same level so the group
// moves like a waveform rather than one block going up and down.
const BAR_GAINS = [0.55, 0.85, 1, 0.8, 0.5];

/** One bar of the live waveform, its height following how loud you are. */
function WaveBar({ level, gain }: { level: SharedValue<number>; gain: number }) {
  const barStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: 0.18 + level.value * gain }],
  }));

  return <Animated.View className="h-11 w-1 rounded-full bg-cream-50" style={barStyle} />;
}

type DumpMode = "idle" | "recording" | "transcribing" | "ready";

/**
 * The step's one action, in four states. It is a single element throughout:
 * the circle you speak into stretches into the button that carries you on, so
 * the two never read as separate controls.
 */
function DumpControl({
  mode,
  level,
  onMicPress,
  onOrganize,
}: {
  mode: DumpMode;
  level: SharedValue<number>;
  onMicPress: () => void;
  onOrganize: () => void;
}) {
  const t = useTranslation();
  // The width to stretch to, measured rather than assumed: the morph animates
  // a real number of pixels, and "100%" is not something it can animate to.
  const [fullWidth, setFullWidth] = useState(0);
  const expanded = useSharedValue(0);
  const isReady = mode === "ready";

  useEffect(() => {
    expanded.value = withTiming(isReady ? 1 : 0, {
      duration: MORPH_DURATION,
      easing: Easing.inOut(Easing.cubic),
    });
  }, [isReady, expanded]);

  // Both shapes are fully rounded, so nothing but the two measurements has to
  // travel: a square this size with a 9999 radius is the circle, and the same
  // radius on a wide, shorter box is the button.
  const shellStyle = useAnimatedStyle(() => ({
    width: CIRCLE + Math.max(fullWidth - CIRCLE, 0) * expanded.value,
    height: CIRCLE + (PILL_HEIGHT - CIRCLE) * expanded.value,
  }));
  const circleStyle = useAnimatedStyle(() => ({ opacity: 1 - expanded.value }));
  const buttonStyle = useAnimatedStyle(() => ({ opacity: expanded.value }));

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    if (width === fullWidth) return;
    setFullWidth(width);
  };

  return (
    <View className="items-center" onLayout={handleLayout}>
      {/* The stretch lives on the shell, not on the pressable: AnimatedPressable
          takes plain styles only, and overflow-hidden keeps the wider face
          clipped to the circle while it is still a circle. */}
      <Animated.View className="overflow-hidden rounded-full bg-orange-500" style={shellStyle}>
        <AnimatedPressable
          onPress={isReady ? onOrganize : onMicPress}
          disabled={mode === "transcribing"}
          scaleTo={0.97}
          accessibilityRole="button"
          accessibilityLabel={
            isReady
              ? t.onboardingDump.organize
              : mode === "recording"
                ? t.onboardingDump.stopRecording
                : t.onboardingDump.startRecording
          }
          className="h-full w-full items-center justify-center"
        >
          {/* Both faces sit on top of each other so neither pushes the other
              around as the shell stretches. */}
          <Animated.View className="absolute flex-row items-center gap-2" style={circleStyle}>
            {mode === "recording" ? (
              BAR_GAINS.map((gain, index) => <WaveBar key={index} level={level} gain={gain} />)
            ) : mode === "transcribing" ? (
              <ActivityIndicator size="large" color={colors.onAccent} />
            ) : (
              <Feather name="mic" size={36} color={colors.onAccent} />
            )}
          </Animated.View>

          <Animated.View className="absolute flex-row items-center gap-3" style={buttonStyle}>
            <Text className="font-grotesk-bold text-xl text-cream-50">{t.onboardingDump.organize}</Text>
            <Feather name="arrow-right" size={20} color={colors.onAccent} />
          </Animated.View>
        </AnimatedPressable>
      </Animated.View>
    </View>
  );
}

export default function OnboardingDump() {
  const t = useTranslation();
  const rtl = useRtlText();
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();

  const [dump, setDump] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const rememberDump = useOnboardingStore((state) => state.setDump);

  // Metering has to be asked for; the preset does not enable it on its own.
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, METER_INTERVAL);
  const isRecording = recorderState.isRecording;

  // 0 silent, 1 as loud as the mic takes. The bars read this rather than React
  // state, so how loud you are never costs a render.
  const level = useSharedValue(0);
  const metering = recorderState.metering;

  useEffect(() => {
    if (!isRecording) {
      level.value = withTiming(0, { duration: 180 });
      return;
    }
    const loudness = (Math.max(metering ?? DB_FLOOR, DB_FLOOR) - DB_FLOOR) / -DB_FLOOR;
    // Eased towards rather than snapped to, so a spike does not make the bars
    // jump — the poll interval is coarser than the frame rate.
    level.value = withTiming(loudness, { duration: METER_INTERVAL + 40, easing: Easing.out(Easing.quad) });
  }, [metering, isRecording, level]);

  if (!isLoaded) return null;
  if (isSignedIn) return <Redirect href="/" />;

  const startRecording = async () => {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t.chat.micPermissionTitle, t.chat.micPermissionBody);
      return;
    }
    await setAudioModeAsync({ allowsRecording: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  };

  const stopAndTranscribe = async () => {
    const seconds = Math.max(1, Math.round(recorderState.durationMillis / 1000));
    await recorder.stop();
    const uri = recorder.uri;
    // Same as components/InboxInput.tsx: leave record mode behind, without
    // letting a failure here cost us the recording.
    setAudioModeAsync({ allowsRecording: false }).catch((error) =>
      console.warn("[onboarding-dump] couldn't leave recording mode", error),
    );
    if (!uri) return;

    const durationLabel = `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;
    setIsTranscribing(true);
    try {
      const transcript = await extractAttachmentText(
        {
          kind: "voice",
          label: t.chat.voiceNoteLabel(durationLabel),
          uri,
          durationSeconds: seconds,
          mimeType: "audio/aac",
        },
        { language: getLanguage() },
      );
      if (transcript) {
        setDump((current) => (current.trim() ? `${current.trimEnd()} ${transcript}` : transcript));
      } else {
        Alert.alert(t.chat.couldntCatch, t.chat.attachmentReplies.voice);
      }
    } catch (error) {
      console.warn("[onboarding-dump] transcription failed", error);
      Alert.alert(t.chat.couldntTranscribe, t.chat.attachmentReplies.voice);
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleMicPress = () => {
    if (isRecording) {
      stopAndTranscribe();
      return;
    }
    startRecording();
  };

  const handleNext = () => {
    posthog.capture("onboarding_dump_organized", { word_count: dump.trim().split(/\s+/).length });
    // Handed over through the store rather than a route param: it is free
    // text, and a brain dump is far too long to travel in a URL.
    rememberDump(dump.trim());
    router.push("/onboarding-analyzing");
  };

  // The button only exists once there is something to organize — until then
  // the control is the circle you talk into.
  const mode: DumpMode = isRecording
    ? "recording"
    : isTranscribing
      ? "transcribing"
      : dump.trim()
        ? "ready"
        : "idle";

  return (
    <OnboardingLayout
      percent={50}
      eyebrow={t.onboardingDump.eyebrow}
      headline={t.onboardingDump.headline}
      body={t.onboardingDump.body}
      onNext={handleNext}
      footer={(next) => (
        <DumpControl
          mode={mode}
          level={level}
          onMicPress={handleMicPress}
          // Just `next`: the layout runs the exit and then calls onNext itself,
          // so navigating here as well would push the same screen twice.
          onOrganize={next}
        />
      )}
    >
      <View
        className="rounded-[20px] border border-orange-500 bg-cream-50 p-5"
        style={{ height: BOX_HEIGHT }}
      >
        <TextInput
          value={dump}
          onChangeText={setDump}
          placeholder={t.onboardingDump.placeholder}
          placeholderTextColor={colors.ink.creamMuted}
          multiline
          textAlignVertical="top"
          editable={!isRecording && !isTranscribing}
          style={rtl}
          className="flex-1 font-grotesk-regular text-base leading-relaxed text-ink-cream"
        />
        {isTranscribing ? (
          <Text className="font-grotesk-medium text-sm text-ink-cream-muted">{t.onboardingDump.transcribing}</Text>
        ) : null}
      </View>
    </OnboardingLayout>
  );
}
