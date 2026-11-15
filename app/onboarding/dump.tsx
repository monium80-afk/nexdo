import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from "expo-audio";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, TextInput, useWindowDimensions, View } from "react-native";
import Animated, {
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import {
  ABOVE_SHADOW,
  CARD_SHADOW,
  draftLine,
  draftScore,
  Eyebrow,
  FadeUp,
  ONB,
  ONB_PROGRESS,
  OnboardingScreen,
  OnboardingTitle,
  PaperFade,
  PrimaryButton,
  rowDirection,
  ScorePill,
  TextButton,
  useIsRtl,
} from "@/components/onboarding/OnboardingKit";
import { CSS_EASE, CSS_OUT, useLoopClock } from "@/components/onboarding/timeline";
import { useOnboardingLiveVoice } from "@/hooks/useOnboardingLiveVoice";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import { classifyIntent } from "@/lib/ai/classifyIntent";
import { extractTasks } from "@/lib/ai/extractTasks";
import type { ExtractedTaskDraft } from "@/lib/ai/types";
import { hasAiConsent } from "@/lib/aiConsent";
import { requestAiConsent } from "@/lib/aiConsentPrompt";
import { isTrialUsed, markTrialUsed } from "@/lib/aiTrial";
import { formatClock } from "@/lib/formatDuration";
import { getLanguage } from "@/lib/i18n";
import { posthog } from "@/lib/posthog";
import { useOnboardingStore } from "@/store/useOnboardingStore";

// 07 · Brain dump (screens/07-brain-dump.html). No transcript: while the user
// talks, each task appears in the list as soon as Gemini Live has heard it —
// with an orange outline flash — and the counter goes up, under a
// "Listening · 0:12" pill. One 60-second session (the server's limit for a
// signed-out install); it doesn't stop for pauses, since there's no mic button
// to start it again (removed, as asked 2026-11-12). "I'm done" and "Type
// instead" are the controls; "Type instead" swaps the list for a text box,
// read by the same one free AI run, or on the phone without AI consent.

const ROW_HEIGHT = 56;
const FILL = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } as const;
/** How tall the soft fades at the list's edges are. */
const FADE_TOP = 18;
const FADE_BOTTOM = 28;
/** A new row's entrance (0.6 s) and outline flash (gone by 1.4 s). */
const ROW_SETTLE_MS = 1500;

/**
 * A task that has just been heard: slides into place, then its orange
 * outline flashes and fades. Once that's over, React draws the row plainly,
 * so it can't stay invisible if the animation didn't run.
 */
function FoundRow({ draft, now, fresh }: { draft: ExtractedTaskDraft; now: Date; fresh: boolean }) {
  const t = useTranslation();
  const rtl = useIsRtl();
  const rtlText = useRtlText();
  const reduceMotion = useReducedMotion();
  const animate = fresh && !reduceMotion;
  const enter = useSharedValue(animate ? 0 : 1);
  const flash = useSharedValue(0);
  const [settled, setSettled] = useState(!animate);
  useEffect(() => {
    if (!animate) return;
    // bf: in over ~0.6 s; bh: the outline on at 0.2 s, gone by 1.1 s.
    enter.value = withTiming(1, { duration: 600, easing: CSS_OUT });
    flash.value = withDelay(200, withSequence(withTiming(1, { duration: 300, easing: CSS_EASE }), withTiming(0, { duration: 900, easing: CSS_EASE })));
    const timer = setTimeout(() => setSettled(true), ROW_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [animate, enter, flash]);
  const rowAnimated = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * -10 }, { scale: 0.95 + 0.05 * enter.value }],
  }));
  const flashAnimated = useAnimatedStyle(() => ({ opacity: flash.value }));

  return (
    <Animated.View style={[{ height: ROW_HEIGHT, borderRadius: 18 }, settled ? ROW_SHOWN : rowAnimated]}>
      <View style={[{ flex: 1, borderRadius: 18, backgroundColor: ONB.card, paddingLeft: rtl ? 14 : 16, paddingRight: rtl ? 16 : 14, alignItems: "center", gap: 12 }, CARD_SHADOW, rowDirection(rtl)]}>
        <View className="h-6 w-6 rounded-full border-2 border-[#CFC4B9]" />
        {/* The "when · how long" line sits close under the title (lifted a little, asked 2026-11-12). */}
        <View style={{ flex: 1, transform: [{ translateY: -1 }] }}>
          <Text numberOfLines={1} maxFontSizeMultiplier={1.2} className="font-grotesk-semibold text-[16px] leading-[20px] text-[#221C17]" style={rtlText}>
            {draft.title}
          </Text>
          <Text numberOfLines={1} maxFontSizeMultiplier={1.2} className="font-grotesk-regular text-[13px] leading-[16px] text-[#7A6E64]" style={rtlText}>
            {draftLine(draft, now, t)}
          </Text>
        </View>
        <ScorePill score={draftScore(draft, now)} />
      </View>
      {/* Above the card's shadow (Android draws a shadowed sibling on top otherwise). */}
      {settled ? null : (
        <Animated.View pointerEvents="none" style={[{ position: "absolute", top: -2, right: -2, bottom: -2, left: -2, borderRadius: 20, borderWidth: 2, borderColor: ONB.orange }, ABOVE_SHADOW, flashAnimated]} />
      )}
    </Animated.View>
  );
}

const ROW_SHOWN = { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] };

/**
 * The dark pill above the buttons: "Listening · 0:12" with a breathing dot,
 * or what happened. When listening couldn't start it can be tapped to try
 * again (its message says so).
 */
function StatusPill({ text, live, onRetry }: { text: string; live: boolean; onRetry?: () => void }) {
  const clock = useLoopClock(1.2);
  const dot = useAnimatedStyle(() => ({ opacity: live ? 0.65 + 0.35 * Math.cos((clock.value / 1.2) * Math.PI * 2) : 1 }));
  const pill = (
    // Grows to two lines for a longer message (an error, time's up) instead of spilling out.
    <View style={{ minHeight: 30, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 15, backgroundColor: ONB.ink, flexDirection: "row", alignItems: "center", gap: 8 }}>
      {live ? <Animated.View style={[{ width: 7, height: 7, borderRadius: 4, backgroundColor: ONB.orange }, dot]} /> : null}
      <Text maxFontSizeMultiplier={1.2} className="font-grotesk-semibold text-[13px] leading-[17px] text-[#FAF1E4]" style={{ flexShrink: 1, textAlign: "center" }}>
        {text}
      </Text>
    </View>
  );
  if (!onRetry) return <View style={{ maxWidth: "92%" }}>{pill}</View>;
  return (
    <AnimatedPressable onPress={onRetry} scaleTo={0.96} accessibilityRole="button" accessibilityLabel={text} style={{ maxWidth: "92%" }}>
      {pill}
    </AnimatedPressable>
  );
}

export default function OnboardingDump() {
  const t = useTranslation();
  const copy = t.onboardingFlow.dump;
  const router = useRouter();
  const rtl = useIsRtl();
  const rtlText = useRtlText();
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<"voice" | "type">(params.mode === "type" ? "type" : "voice");
  const [now] = useState(() => new Date());
  const compact = useWindowDimensions().height < 780;

  const drafts = useOnboardingStore((state) => state.drafts);
  const setDrafts = useOnboardingStore((state) => state.setDrafts);
  // Rows already on screen when it opened don't replay their entrance.
  const [initialCount] = useState(() => useOnboardingStore.getState().drafts.length);

  const voice = useOnboardingLiveVoice();
  const listening = voice.status === "listening";
  const busy = voice.status === "connecting" || voice.status === "finishing";
  const [elapsed, setElapsed] = useState(0);
  const [leaving, setLeaving] = useState(false);

  const [typed, setTyped] = useState("");
  const [organizing, setOrganizing] = useState(false);

  const scroll = useAnimatedRef<Animated.ScrollView>();
  // The fades at the list's edges show only where there's more to scroll to.
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

  // Voice: start listening as soon as the screen opens (06 already asked),
  // also on a second pass through onboarding. The server decides whether this
  // install has a free session left (lib/anonymousTrial.ts); only when it says
  // no does the screen switch to typing, and then for good.
  const startVoice = voice.start;
  const started = useRef(false);
  useEffect(() => {
    if (mode !== "voice" || started.current) return;
    started.current = true;
    void startVoice();
  }, [mode, startVoice]);
  // Refused by the server: typing, with the reason under the headline.
  const voiceRefused = voice.status === "error" && voice.problem === "planLimit";
  const shownMode = voiceRefused ? "type" : mode;

  // The clock in the pill.
  useEffect(() => {
    if (!listening || !voice.startedAt) return;
    const startedAt = voice.startedAt;
    const tick = () => setElapsed(Date.now() - startedAt);
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [listening, voice.startedAt]);

  // What stopped the session, said in the pill.
  const voiceNotice =
    voice.status === "stopped" && (voice.problem === "timeLimit" || voice.problem === "planLimit")
      ? copy.timeUp
      : voice.status === "error"
        ? voice.problem === "planLimit"
          ? copy.trialUsed
          : copy.couldntStart
        : null;

  // New rows scroll into view (not the ones already there when the screen opened).
  useEffect(() => {
    if (drafts.length > initialCount) scroll.current?.scrollToEnd({ animated: true });
  }, [drafts.length, initialCount, scroll]);

  // "I'm done": the last sentence may still be on its way — leave once the
  // session has closed, once. Coming back to this screen makes it work again.
  const left = useRef(false);
  useEffect(() => {
    if (!leaving || listening || busy || left.current) return;
    left.current = true;
    posthog.capture("onboarding_dump_done", { mode, task_count: useOnboardingStore.getState().drafts.length });
    router.push("/onboarding/founder");
  }, [busy, leaving, listening, mode, router]);
  const stopVoice = voice.stop;
  useFocusEffect(
    useCallback(() => {
      left.current = false;
      setLeaving(false);
      // Leaving this screen (on to 08, or back) ends any session, so the
      // microphone is never left running behind another screen.
      return () => stopVoice();
    }, [stopVoice]),
  );

  const handleDone = () => {
    if (listening || busy) void voice.stop();
    setLeaving(true);
  };

  // Listening couldn't start (a connection problem): the pill says "try again" and is the way to.
  const canRetry = voice.status === "error" && voice.problem !== "planLimit";
  const handleRetry = () => {
    void startVoice();
  };

  const switchToType = () => {
    if (listening || busy) void voice.stop();
    setMode("type");
  };

  const switchToVoice = async () => {
    if (!(await requestAiConsent())) return;
    const granted = (await getRecordingPermissionsAsync()).granted || (await requestRecordingPermissionsAsync()).granted;
    if (!granted) return;
    setMode("voice");
    started.current = true;
    void startVoice();
  };

  // Typed: the same one free AI run reads it (as the old analyzing step did);
  // without AI consent, or once the run is used, the phone finds the tasks.
  const handleOrganize = async () => {
    const text = typed.trim();
    if (!text || organizing) return;
    setOrganizing(true);
    const useAi = hasAiConsent() && !(await isTrialUsed());
    let found: ExtractedTaskDraft[];
    try {
      if (useAi) void markTrialUsed();
      found = useAi
        ? (await classifyIntent({ text, now: new Date(), recentTaskIds: [], tasks: [] })).actions.flatMap((action) => (action.type === "CREATE_TASK" ? action.drafts : []))
        : extractTasks(text, new Date(), getLanguage());
    } catch (error) {
      console.warn("[onboarding/dump] extraction failed", error);
      found = extractTasks(text, new Date(), getLanguage());
    }
    const stamped = found.map((draft, index) => ({ ...draft, candidateId: draft.candidateId ?? `typed-${Date.now().toString(36)}-${index}` }));
    setDrafts([...useOnboardingStore.getState().drafts, ...stamped]);
    setTyped("");
    setOrganizing(false);
    posthog.capture("onboarding_dump_typed", { task_count: stamped.length, ai: useAi });
  };

  const shownNotice = listening || busy ? null : voiceNotice;
  const pillText = shownNotice
    ? shownNotice
    : listening || voice.status === "finishing"
      ? copy.listening(formatClock(elapsed).replace(/^0(\d:)/, "$1"))
      : copy.connecting;

  const list = (
    <View style={{ flex: 1, gap: 8 }}>
      <View style={{ paddingHorizontal: 4, alignItems: "center", justifyContent: "space-between", ...rowDirection(rtl) }}>
        <Eyebrow color={ONB.faint}>{copy.heard}</Eyebrow>
        <Text maxFontSizeMultiplier={1.2} className="font-grotesk-bold text-[13px] text-[#C4461A]">
          {copy.count(drafts.length)}
        </Text>
      </View>
      {/* The rows scroll in their own room, with a little space at the top and soft edges, so none is cut off flat. */}
      <View style={{ flex: 1, minHeight: 0, marginHorizontal: -6 }}>
        <Animated.ScrollView
          ref={scroll}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onLayout={(event) => {
            boxHeight.value = event.nativeEvent.layout.height;
          }}
          onContentSizeChange={(_, height) => {
            contentHeight.value = height;
          }}
          contentContainerStyle={{ paddingHorizontal: 6, paddingTop: 6, paddingBottom: 14, gap: 8 }}
          showsVerticalScrollIndicator={false}
        >
          {drafts.map((draft, index) => (
            <FoundRow key={draft.candidateId ?? `${draft.title}-${index}`} draft={draft} now={now} fresh={index >= initialCount} />
          ))}
        </Animated.ScrollView>
        <Animated.View pointerEvents="none" style={[FILL, topFade]}>
          <PaperFade top={FADE_TOP} />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[FILL, bottomFade]}>
          <PaperFade bottom={FADE_BOTTOM} />
        </Animated.View>
      </View>
    </View>
  );

  if (shownMode === "type") {
    return (
      <OnboardingScreen
        percent={ONB_PROGRESS.dump}
        onBack={() => router.back()}
        footer={
          <>
            {typed.trim() || drafts.length === 0 ? (
              <PrimaryButton label={organizing ? copy.organizing : copy.organize} disabled={!typed.trim() || organizing} onPress={() => void handleOrganize()} />
            ) : (
              <PrimaryButton label={copy.done} onPress={handleDone} />
            )}
            {drafts.length === 0 && !typed.trim() ? (
              <TextButton label={copy.skip} onPress={handleDone} />
            ) : voiceRefused ? null : (
              <TextButton label={copy.talkInstead} onPress={() => void switchToVoice()} />
            )}
          </>
        }
      >
        <View style={{ flex: 1, gap: 20 }}>
          <OnboardingTitle title={copy.typeHeadline} body={voiceRefused ? copy.trialUsed : copy.typeBody} />
          <FadeUp delay={120}>
            <TextInput
              value={typed}
              onChangeText={setTyped}
              placeholder={copy.placeholder}
              placeholderTextColor={ONB.faint}
              multiline
              textAlignVertical="top"
              style={[
                { minHeight: compact ? 90 : 120, maxHeight: compact ? 130 : 180, borderRadius: 18, backgroundColor: ONB.card, padding: 16, fontSize: 16, lineHeight: 22, fontFamily: "SpaceGrotesk-Regular", color: ONB.ink },
                CARD_SHADOW,
                rtlText,
              ]}
            />
          </FadeUp>
          {/* With nothing typed the footer's link is "Skip", so the way back to the mic sits here. */}
          {drafts.length === 0 && !typed.trim() && !voiceRefused ? (
            <View style={{ alignItems: "center", marginTop: -8 }}>
              <TextButton label={copy.talkInstead} onPress={() => void switchToVoice()} />
            </View>
          ) : null}
          {drafts.length > 0 ? list : null}
        </View>
      </OnboardingScreen>
    );
  }

  return (
    <OnboardingScreen
      percent={ONB_PROGRESS.dump}
      onBack={() => {
        if (listening || busy) void voice.stop();
        router.back();
      }}
      footer={
        <>
          <PrimaryButton label={copy.done} onPress={handleDone} disabled={leaving} />
          <TextButton label={copy.typeInstead} onPress={switchToType} />
        </>
      }
    >
      <View style={{ flex: 1, gap: compact ? 16 : 24 }}>
        <OnboardingTitle title={copy.headline} body={copy.body} />
        {list}
        {/* The pill, right above "I'm done" (the mock's mic under it was removed). */}
        <View style={{ alignItems: "center", paddingBottom: 2 }}>
          <StatusPill text={pillText} live={listening && !shownNotice} onRetry={canRetry ? handleRetry : undefined} />
        </View>
      </View>
    </OnboardingScreen>
  );
}
