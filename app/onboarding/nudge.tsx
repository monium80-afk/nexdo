import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Modal, Platform, Pressable, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from "react-native-svg";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import {
  draftScore,
  FadeUp,
  FitBox,
  MAX_FONT_SCALE,
  ONB,
  ONB_PROGRESS,
  OnboardingScreen,
  PaperFade,
  PlainGem,
  PrimaryButton,
  rowDirection,
  TextButton,
  useIsRtl,
  useSvgId,
} from "@/components/onboarding/OnboardingKit";
import { kf, useLoopClock } from "@/components/onboarding/timeline";
import { useTranslation } from "@/hooks/useTranslation";
import { addDaysToKey, toLocalDateKey } from "@/lib/localDate";
import { requestNotificationPermission } from "@/lib/notifications";
import { posthog } from "@/lib/posthog";
import { useOnboardingStore } from "@/store/useOnboardingStore";
import { useSettingsStore } from "@/store/useSettingsStore";

// 10 · Morning nudge (screens/10-morning-nudge.html). The time in the
// headline is a pill that opens a time picker; the lock screen below shows
// that time and the notification Nexdo will really send — "Start with:" the
// top task from the brain dump. "Turn on reminders" asks the phone and turns
// the morning nudge on (lib/reminders.ts planDailyNotes). The notification
// keeps dropping in, as in the mock (one of the few loops kept, paused when
// the screen is out of sight).

const DEFAULT_TIME = "08:30";
/** How much of the phone shows: down to just under the notification, then the fade. */
const LOCK_H = 400;
const NOTE_LOOP = 6;
const NOTE_EASE = Easing.bezierFn(0.2, 0.8, 0.2, 1);

const pad = (value: number) => String(value).padStart(2, "0");

function timeToDate(time: string): Date {
  const [hours, minutes] = time.split(":").map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
}

/** Whether the language writes times on a 24-hour clock (French, German…). */
function uses24Hour(locale: string): boolean {
  try {
    const cycle = new Intl.DateTimeFormat(locale, {
      hour: "numeric",
    }).resolvedOptions().hourCycle;
    return cycle === "h23" || cycle === "h24";
  } catch {
    return false;
  }
}

/** The lock screen's big clock: the time without AM/PM ("8:30", "08:30"). */
function lockClock(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" })
    .formatToParts(date)
    .filter((part) => part.type !== "dayPeriod")
    .map((part) => part.value)
    .join("")
    .trim();
}

function Notification({ title, body }: { title: string; body: string }) {
  const t = useTranslation();
  const rtl = useIsRtl();
  const reduceMotion = useReducedMotion();
  const clock = useLoopClock(NOTE_LOOP);
  // nt1: drops in from 10 % to 24 %, stays until 92 %, gone by 98 %. The
  // loop is read 30 % in, so its resting point (time 0 — before it starts,
  // when the screen is out of sight, if it never runs) is the notification
  // shown, not the gap before it drops in. Reduce Motion: simply there.
  const style = useAnimatedStyle(() => {
    if (reduceMotion) return { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] };
    const p = (clock.value / NOTE_LOOP + 0.3) % 1;
    return {
      opacity: kf(
        p,
        [
          [0.1, 0],
          [0.2, 1],
          [0.92, 1],
          [0.98, 0],
        ],
        NOTE_EASE,
      ),
      transform: [
        {
          translateY: kf(
            p,
            [
              [0.1, -26],
              [0.2, 3],
              [0.24, 0],
            ],
            NOTE_EASE,
          ),
        },
        {
          scale: kf(
            p,
            [
              [0.1, 0.94],
              [0.2, 1],
            ],
            NOTE_EASE,
          ),
        },
      ],
    };
  });
  return (
    <Animated.View
      style={[
        {
          borderRadius: 22,
          backgroundColor: "rgba(250,241,228,0.94)",
          padding: 12,
          gap: 11,
          alignItems: "center",
        },
        rowDirection(rtl),
        style,
      ]}
    >
      <View style={{ width: 40, alignItems: "center", marginTop: -8 }}>
        <PlainGem width={36} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={[{ justifyContent: "space-between" }, rowDirection(rtl)]}>
          <Text maxFontSizeMultiplier={1} className="font-grotesk-bold text-[12.5px] text-[#221C17]">
            {t.onboardingFlow.nudge.app}
          </Text>
          <Text maxFontSizeMultiplier={1} className="font-grotesk-regular text-[12.5px] text-[#7A6E64]">
            {t.onboardingFlow.nudge.now}
          </Text>
        </View>
        <Text numberOfLines={1} maxFontSizeMultiplier={1} className="font-grotesk-bold text-[14px] text-[#221C17]" style={{ textAlign: rtl ? "right" : "left" }}>
          {title}
        </Text>
        <Text numberOfLines={2} maxFontSizeMultiplier={1} className="font-grotesk-regular text-[13.5px] leading-[18px] text-[#4A433D]" style={{ textAlign: rtl ? "right" : "left" }}>
          {body}
        </Text>
      </View>
    </Animated.View>
  );
}

function LockScreen({ time, title, body }: { time: string; title: string; body: string }) {
  const t = useTranslation();
  const screenId = useSvgId("lock");
  const date = timeToDate(time);
  const day = new Date().toLocaleDateString(t.locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return (
    // The mock's 470 px phone, cut at 400 so the notification always shows,
    // fading out below it.
    <View
      style={{
        alignSelf: "center",
        width: 282,
        height: LOCK_H,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          height: 470,
          borderTopLeftRadius: 46,
          borderTopRightRadius: 46,
          backgroundColor: "#1A1410",
          paddingTop: 10,
          paddingHorizontal: 10,
        }}
      >
        <View
          style={{
            flex: 1,
            borderTopLeftRadius: 37,
            borderTopRightRadius: 37,
            overflow: "hidden",
          }}
        >
          <Svg width="100%" height="100%" style={{ position: "absolute" }}>
            <Defs>
              <RadialGradient id={screenId} cx="50%" cy="25%" rx="110%" ry="70%">
                <Stop offset="0" stopColor="#4A2C1B" />
                <Stop offset="0.55" stopColor="#241812" />
                <Stop offset="1" stopColor="#17110D" />
              </RadialGradient>
            </Defs>
            <Rect width="100%" height="100%" fill={`url(#${screenId})`} />
          </Svg>
          <View
            style={{
              position: "absolute",
              left: "50%",
              top: 12,
              width: 92,
              height: 26,
              marginLeft: -46,
              borderRadius: 13,
              backgroundColor: "#0B0807",
            }}
          />
          <View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 62,
              alignItems: "center",
            }}
          >
            {/* The phone is a drawing: its text keeps its drawn size. */}
            <Text maxFontSizeMultiplier={1} numberOfLines={1} className="font-grotesk-semibold text-[14px] text-[#FAF1E4]" style={{ opacity: 0.8 }}>
              {day}
            </Text>
            <Text maxFontSizeMultiplier={1} className="mt-0.5 font-grotesk-bold text-[72px] leading-[72px] tracking-[-2.9px] text-[#FAF1E4]">
              {lockClock(date, t.locale)}
            </Text>
          </View>
          <View style={{ position: "absolute", left: 10, right: 10, top: 196 }}>
            <Notification title={title} body={body} />
          </View>
        </View>
      </View>
      {/* The phone fades out at the bottom (the mock's mask). */}
      <PaperFade bottom={120} />
    </View>
  );
}

export default function OnboardingNudge() {
  const t = useTranslation();
  const copy = t.onboardingFlow.nudge;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const rtl = useIsRtl();
  const drafts = useOnboardingStore((state) => state.drafts);
  const [time, setTime] = useState(DEFAULT_TIME);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const is24Hour = uses24Hour(t.locale);
  const timeLabel = timeToDate(time).toLocaleTimeString(t.locale, {
    hour: "numeric",
    minute: "2-digit",
  });

  // The notification as it will arrive: the top task from the brain dump, and
  // how many others are due that morning's day.
  const preview = useMemo(() => {
    const now = new Date();
    const top = [...drafts].sort((a, b) => draftScore(b, now) - draftScore(a, now))[0];
    if (!top)
      return {
        title: t.notifications.dailyTitle(copy.sampleTask),
        body: t.notifications.dailyDueBody(2),
      };
    const [hours, minutes] = time.split(":").map(Number);
    const firesToday = now.getHours() * 60 + now.getMinutes() < hours * 60 + minutes;
    const day = firesToday ? toLocalDateKey(now) : addDaysToKey(toLocalDateKey(now), 1);
    const moreDue = drafts.filter((draft) => draft !== top && draft.dueDate && toLocalDateKey(new Date(draft.dueDate)) === day).length;
    return {
      title: t.notifications.dailyTitle(top.title),
      body: moreDue > 0 ? t.notifications.dailyDueBody(moreDue) : t.notifications.dailyOpenBody,
    };
  }, [copy.sampleTask, drafts, t.notifications, time]);

  const handlePick = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === "android") setPicking(false);
    if (event.type === "dismissed" || !selected) return;
    setTime(`${pad(selected.getHours())}:${pad(selected.getMinutes())}`);
  };

  const handleTurnOn = async () => {
    if (busy) return;
    setBusy(true);
    const settings = useSettingsStore.getState();
    settings.setNotificationPromptShown(true);
    const granted = await requestNotificationPermission();
    if (granted) {
      settings.setDailyNudgeTime(time);
      settings.setDailyNudgeEnabled(true);
    }
    posthog.capture("onboarding_nudge_answered", { granted, time });
    setBusy(false);
    router.push("/onboarding/promise");
  };

  // The headline wraps word by word around the pill, as inline text would.
  const words = (text: string) => text.split(/(?<=\s)/).filter(Boolean);
  // Punctuation right after the pill (", every day.") stays on its line, as
  // inline text would — it never wraps to the next line on its own.
  const afterWords = words(copy.after);
  const glued = afterWords.length > 0 && !/^\s/.test(copy.after) ? afterWords[0] : null;
  const rest = glued === null ? afterWords : afterWords.slice(1);

  return (
    <OnboardingScreen
      percent={ONB_PROGRESS.nudge}
      onBack={() => router.back()}
      footer={
        <>
          <PrimaryButton label={copy.turnOn} onPress={() => void handleTurnOn()} disabled={busy} />
          <TextButton
            label={copy.notNow}
            disabled={busy}
            onPress={() => {
              posthog.capture("onboarding_nudge_skipped");
              router.push("/onboarding/promise");
            }}
          />
        </>
      }
    >
      <View style={{ flex: 1, gap: 28 }}>
        <FadeUp style={{ gap: 10, paddingHorizontal: 4 }}>
          <View style={[{ flexWrap: "wrap", alignItems: "center", rowGap: 0 }, rowDirection(rtl)]}>
            {words(copy.before).map((word, index) => (
              <Text key={`b${index}`} maxFontSizeMultiplier={MAX_FONT_SCALE} className="font-grotesk-bold text-[28px] leading-[39px] tracking-[-0.7px] text-[#221C17]">
                {word}
              </Text>
            ))}
            <View style={[{ alignItems: "center" }, rowDirection(rtl)]}>
              <AnimatedPressable
                onPress={() => setPicking(true)}
                scaleTo={0.96}
                accessibilityRole="button"
                accessibilityLabel={copy.changeTime(timeLabel)}
                // Smaller than the headline, so "A nudge at 8:30 AM," fits on
                // the first line, even on a 360-wide phone with larger text.
                style={[
                  {
                    height: 34,
                    marginLeft: rtl ? 0 : 2,
                    marginRight: rtl ? 2 : 0,
                    paddingLeft: rtl ? 8 : 11,
                    paddingRight: rtl ? 11 : 8,
                    borderRadius: 17,
                    backgroundColor: ONB.softOrange,
                    borderWidth: 1.5,
                    borderColor: "rgba(242,106,46,0.35)",
                    alignItems: "center",
                    gap: 3,
                  },
                  rowDirection(rtl),
                ]}
              >
                <Text maxFontSizeMultiplier={1.1} className="font-grotesk-bold text-[20px] leading-[27px] tracking-[-0.5px] text-[#C4461A]">
                  {timeLabel}
                </Text>
                <Svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={ONB.deepOrange} strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round">
                  <Path d="M6 9l6 6 6-6" />
                </Svg>
              </AnimatedPressable>
              {glued ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="font-grotesk-bold text-[28px] leading-[39px] tracking-[-0.7px] text-[#221C17]">
                  {glued}
                </Text>
              ) : null}
            </View>
            {rest.map((word, index) => (
              <Text key={`a${index}`} maxFontSizeMultiplier={MAX_FONT_SCALE} className="font-grotesk-bold text-[28px] leading-[39px] tracking-[-0.7px] text-[#221C17]">
                {word}
              </Text>
            ))}
          </View>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="font-grotesk-regular text-[16px] leading-[23px] text-[#7A6E64]" style={{ textAlign: rtl ? "right" : "left" }}>
            {copy.body}
          </Text>
        </FadeUp>
        {/* Shrinks on a short phone rather than cutting the notification off. */}
        <FadeUp delay={120} style={{ flex: 1, minHeight: 0 }}>
          <FitBox width={282} height={LOCK_H} natural align="top">
            <LockScreen time={time} title={preview.title} body={preview.body} />
          </FitBox>
        </FadeUp>
      </View>

      {picking && Platform.OS === "android" ? <DateTimePicker value={timeToDate(time)} mode="time" is24Hour={is24Hour} onChange={handlePick} /> : null}
      {Platform.OS === "ios" ? (
        <Modal visible={picking} transparent animationType="slide" onRequestClose={() => setPicking(false)}>
          <Pressable style={{ flex: 1, backgroundColor: "rgba(34,28,23,0.35)" }} onPress={() => setPicking(false)} />
          <View
            style={{
              backgroundColor: ONB.paper,
              borderTopLeftRadius: 30,
              borderTopRightRadius: 30,
              paddingTop: 12,
              paddingHorizontal: 20,
              paddingBottom: Math.max(insets.bottom, 20),
            }}
          >
            <DateTimePicker value={timeToDate(time)} mode="time" display="spinner" locale={t.locale} onChange={handlePick} textColor={ONB.ink} themeVariant="light" />
            <PrimaryButton label={t.onboardingFlow.continue} arrow={false} onPress={() => setPicking(false)} />
          </View>
        </Modal>
      ) : null}
    </OnboardingScreen>
  );
}
