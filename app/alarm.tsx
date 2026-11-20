import { MaterialCommunityIcons } from "@expo/vector-icons";
import { setAudioModeAsync, useAudioPlayer, type AudioPlayer } from "expo-audio";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { GemGlow, GemStill } from "@/components/GemMascot";
import { sounds } from "@/constants/sounds";
import { shadow } from "@/constants/shadow";
import { useTranslation } from "@/hooks/useTranslation";
import { dismissAlarmNotifications, snoozeAlarm } from "@/lib/notifications";
import { isRecording } from "@/lib/recordingMode";

const BG = "#1C1511";
const PILL = "#4A2A1A";
const PILL_TEXT = "#F7A16C";
const CREAM = "#FAF1E4";
const MUTED = "#A99D92";
const SNOOZE = "#3A322C";
const ACCENT = "#F26A2E";
const RING = "rgba(242, 106, 46, 0.28)";

/** How long the alarm rings before it gives up on its own. */
const RING_LIMIT_MS = 2 * 60_000;

/** Plays the alarm from the top, over and over. */
async function ringOnLoop(player: AudioPlayer) {
  player.loop = true;
  await player.seekTo(0);
  player.play();
}

/**
 * A task's alarm (Pro, 2026-11-18): the clock, the gem, the task and when it
 * starts, then Stop and Snooze 5 min. Opened when an alarm goes off with
 * Nexdo open, or when its notification is tapped (hooks/useNotifications.ts).
 * Rings its sound on a loop — through the silent switch — and buzzes, until
 * stopped, snoozed, or two minutes have passed.
 */
export default function AlarmScreen() {
  const t = useTranslation();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ taskId?: string; title?: string; startsAt?: string }>();
  const player = useAudioPlayer(sounds.alarm);
  const [now, setNow] = useState(() => new Date());
  const startsAt = params.startsAt ? Number(params.startsAt) : undefined;
  const title = params.title ?? "";
  const alarm = { taskId: params.taskId || undefined, title, startsAt };

  // The clock on screen keeps time while the alarm is up.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Ring and buzz until stopped (or the limit passes).
  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        if (!isRecording()) await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        if (stopped) return;
        await ringOnLoop(player);
      } catch (error) {
        console.warn("[alarm] couldn't play the alarm sound", error);
      }
    })();
    const buzz = setInterval(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }, 1200);
    const limit = setTimeout(() => {
      clearInterval(buzz);
      player.pause();
    }, RING_LIMIT_MS);
    return () => {
      stopped = true;
      clearInterval(buzz);
      clearTimeout(limit);
      try {
        player.pause();
      } catch {
        // Already released with the screen.
      }
    };
  }, [player]);

  const close = () => {
    void dismissAlarmNotifications(alarm.taskId);
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const handleSnooze = () => {
    void snoozeAlarm(alarm, t.reminderUi.snoozedTitle(title), startsAt ? t.reminderUi.startedAt(timeOf(startsAt)) : "");
    close();
  };

  const timeOf = (ms: number) => new Date(ms).toLocaleTimeString(t.locale, { hour: "numeric", minute: "2-digit" });
  const clock = now.toLocaleTimeString(t.locale, { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/i, "");
  const date = now.toLocaleDateString(t.locale, { weekday: "long", month: "long", day: "numeric" });
  const minutesLeft = startsAt ? Math.round((startsAt - now.getTime()) / 60_000) : 0;
  const startsLine = !startsAt
    ? ""
    : minutesLeft > 0
      ? t.reminderUi.startsAtIn(timeOf(startsAt), t.notifications.offsetLabel(minutesLeft))
      : t.reminderUi.startedAt(timeOf(startsAt));

  return (
    <View style={{ flex: 1, backgroundColor: BG, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24, paddingHorizontal: 24 }}>
      <View style={{ alignItems: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 38, paddingHorizontal: 16, borderRadius: 19, backgroundColor: PILL }}>
          <MaterialCommunityIcons name="alarm" size={18} color={PILL_TEXT} />
          <Text style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 15, color: PILL_TEXT }}>{t.reminderUi.alarmLabel}</Text>
        </View>
        <Text style={{ marginTop: 18, fontFamily: "SpaceGrotesk-Bold", fontSize: 84, lineHeight: 92, letterSpacing: -2, color: CREAM }}>{clock}</Text>
        <Text style={{ fontFamily: "SpaceGrotesk-Regular", fontSize: 18, color: MUTED }}>{date}</Text>
      </View>

      {/* The gem, glowing inside a ring. */}
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: 250, height: 250, borderRadius: 125, borderWidth: 2, borderColor: RING, alignItems: "center", justifyContent: "center" }}>
          <View style={{ position: "absolute" }}>
            <GemGlow size={230} />
          </View>
          <GemStill level={5} width={130} />
        </View>
      </View>

      <View style={{ alignItems: "center", marginBottom: 36 }}>
        <Text numberOfLines={2} style={{ textAlign: "center", fontFamily: "SpaceGrotesk-Bold", fontSize: 30, lineHeight: 36, color: CREAM }}>
          {title}
        </Text>
        {startsLine ? <Text style={{ marginTop: 8, fontFamily: "SpaceGrotesk-Regular", fontSize: 16, color: MUTED }}>{startsLine}</Text> : null}
      </View>

      <AnimatedPressable
        onPress={close}
        scaleTo={0.97}
        accessibilityRole="button"
        style={{ height: 64, borderRadius: 32, backgroundColor: ACCENT, alignItems: "center", justifyContent: "center", ...shadow("0 10px 28px rgba(242, 106, 46, 0.4)", 8, ACCENT) }}
      >
        <Text style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 20, color: "#FFFFFF" }}>{t.reminderUi.stop}</Text>
      </AnimatedPressable>
      <AnimatedPressable
        onPress={handleSnooze}
        scaleTo={0.97}
        accessibilityRole="button"
        style={{ marginTop: 12, height: 56, borderRadius: 28, backgroundColor: SNOOZE, alignItems: "center", justifyContent: "center" }}
      >
        <Text style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 17, color: CREAM }}>{t.reminderUi.snooze}</Text>
      </AnimatedPressable>
    </View>
  );
}
