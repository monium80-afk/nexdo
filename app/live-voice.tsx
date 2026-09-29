import { useAuth } from "@clerk/expo";
import * as Haptics from "expo-haptics";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import Animated, { Easing, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { IconButton, PrimaryButton, SecondaryButton, TextButton } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ScreenHeader } from "@/components/ScreenHeader";
import { SOUND_WAVES_WIDTH, SoundWaves } from "@/components/SoundWaves";
import { TaskCard } from "@/components/TaskCard";
import { listItemEntering, listItemLayout } from "@/constants/theme";
import { useLiveVoice } from "@/hooks/useLiveVoice";
import { useRtlText } from "@/hooks/useRtlText";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { formatClock } from "@/lib/formatDuration";
import { useTaskStore } from "@/store/useTaskStore";
import type { Task } from "@/types/task";

type LiveMark = "added" | "updated" | "completed";
type Baseline = Map<string, { updatedAt: string; status: Task["status"] }>;

/** What happened to a task since the screen opened, going by what it looked like then. */
function markFor(task: Task, baseline: Baseline): LiveMark | null {
  const before = baseline.get(task.id);
  if (!before) return "added";
  if (task.updatedAt === before.updatedAt) return null;
  if (task.status === "completed" && before.status !== "completed") return "completed";
  return "updated";
}

/**
 * Tasks changed while talking come first, the latest change on top — that's
 * where the eye is while speaking. Then the rest of the open tasks, newest
 * first, so "delete the gym task" has something to point at. A deleted task
 * simply drops out of the list.
 */
function liveTaskList(tasks: Task[], baseline: Baseline): { task: Task; mark: LiveMark | null }[] {
  const marked = tasks.map((task) => ({ task, mark: markFor(task, baseline) }));
  const changed = marked
    .filter((entry) => entry.mark !== null)
    .sort((a, b) => b.task.updatedAt.localeCompare(a.task.updatedAt));
  const rest = marked
    .filter((entry) => entry.mark === null && entry.task.status === "pending")
    .sort((a, b) => b.task.createdAt.localeCompare(a.task.createdAt));
  return [...changed, ...rest];
}

const STOP_BUTTON_SIZE = 64;
// While listening, the round stop button widens by this much into a pill:
// room for the sound waves beside the stop square.
const WAVES_GAP = 10;
const WAVES_ROOM = WAVES_GAP + SOUND_WAVES_WIDTH;

/**
 * Live voice: talk, and the list changes as you go. No transcript — Gemini
 * Live acts on each sentence itself (lib/liveVoice.ts), so the list is the
 * only feedback, with a tap of haptics for every change.
 *
 * Checks the account before anything else mounts: the screen below opens
 * the microphone as soon as it appears, and a direct link skips the tabs'
 * own sign-in check.
 */
export default function LiveVoiceScreen() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/onboarding" />;
  return <LiveVoice />;
}

function LiveVoice() {
  const colors = useColors();
  const t = useTranslation();
  const rtl = useRtlText();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tasks = useTaskStore((state) => state.tasks);
  const toggleTaskStatus = useTaskStore((state) => state.toggleTaskStatus);
  const { status, problem, startedAt, changes, undoable, level, start, stop, undo } = useLiveVoice();

  // The list as it was when the screen opened: the yardstick for "Just
  // added" / "Updated" / "Done", across every Talk again on this screen.
  const [baseline] = useState<Baseline>(
    () => new Map(useTaskStore.getState().tasks.map((task) => [task.id, { updatedAt: task.updatedAt, status: task.status }])),
  );

  // Tapping the mic was the request to listen — start straight away.
  useEffect(() => {
    void start();
  }, [start]);

  // Felt, not just seen: the eyes may not be on the screen while talking.
  useEffect(() => {
    if (changes > 0) Haptics.selectionAsync().catch(() => {});
  }, [changes]);

  // Once a second while listening, for the clock — same approach as
  // useSessionCountdown.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  const isActive = status === "connecting" || status === "listening" || status === "finishing";
  const statusLabel =
    status === "connecting"
      ? t.live.connecting
      : status === "listening"
        ? t.live.listening(formatClock(startedAt === null ? 0 : Math.max(0, now - startedAt)))
        : status === "finishing"
          ? t.live.finishing
          : t.live.stopped;

  const list = liveTaskList(tasks, baseline);

  // 0 → 1 as the mic opens: the stop button widens and the waves slide in
  // beside the square, which stays centred throughout.
  const open = useSharedValue(0);
  useEffect(() => {
    open.value = withTiming(status === "listening" ? 1 : 0, { duration: 240, easing: Easing.out(Easing.quad) });
  }, [status, open]);
  const stopButtonStyle = useAnimatedStyle(() => ({ width: STOP_BUTTON_SIZE + WAVES_ROOM * open.value }));
  const wavesStyle = useAnimatedStyle(() => ({ width: WAVES_ROOM * open.value, opacity: open.value }));

  const handleClose = () => {
    stop();
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/tasks");
    }
  };

  const undoButton =
    undoable > 0 ? <TextButton icon="rotate-ccw" label={t.live.undo} onPress={undo} className="py-2" /> : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.charcoal[900] }} edges={["top"]}>
      <ScreenHeader
        title={t.live.title}
        actions={<IconButton icon="x" variant="header" onPress={handleClose} accessibilityLabel={t.common.close} />}
      >
        <View className="flex-row items-center gap-2">
          {status === "listening" ? <View className="h-2 w-2 rounded-full bg-overdue-300" /> : null}
          <Text className="font-grotesk-medium text-sm text-ink-charcoal-muted">{statusLabel}</Text>
        </View>
      </ScreenHeader>

      <View className="screen-body">
        <ScrollView
          contentContainerStyle={{ paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
        >
          <Text className="eyebrow px-6 pt-4 text-ink-cream-muted" style={rtl}>
            {t.live.yourTasks}
          </Text>
          <View className="gap-[11px] px-6 pt-3">
            {list.length === 0 ? (
              <EmptyState icon="mic" title={t.live.emptyTitle} body={t.live.emptyBody} />
            ) : (
              list.map(({ task, mark }, index) => (
                <Animated.View
                  key={task.id}
                  entering={listItemEntering(index)}
                  exiting={FadeOut.duration(200)}
                  layout={listItemLayout()}
                  style={{ gap: 6 }}
                >
                  {mark ? (
                    <Text className="eyebrow text-orange-600" style={rtl}>
                      {t.live.marks[mark]}
                    </Text>
                  ) : null}
                  {/* Tapping through to details would leave the mic running
                      behind another screen; ticking a task off still works. */}
                  <TaskCard task={task} onPress={() => undefined} onToggle={() => toggleTaskStatus(task.id)} />
                </Animated.View>
              ))
            )}
          </View>
        </ScrollView>
      </View>

      <View className="gap-3 border-t border-cream-200 bg-cream-50 px-6 pt-4" style={{ paddingBottom: insets.bottom + 16 }}>
        {problem ? (
          <Text
            // Stopping on its own isn't an error — only real failures go red.
            className={`font-grotesk-medium text-sm ${problem === "timeLimit" || problem === "silence" ? "text-ink-cream-muted" : "text-overdue-500"}`}
            style={rtl}
          >
            {t.live.problems[problem]}
          </Text>
        ) : null}

        {isActive ? (
          // Undo on the left, balanced by an empty slot on the right, so the
          // stop button stays centred.
          <View className="flex-row items-center justify-between pt-1">
            <View className="w-[96px] items-start">{undoButton}</View>
            <Animated.View style={stopButtonStyle}>
              <AnimatedPressable
                onPress={stop}
                disabled={status === "finishing"}
                scaleTo={0.92}
                accessibilityRole="button"
                accessibilityLabel={t.live.stop}
                className="h-[64px] w-full flex-row items-center justify-center rounded-full bg-orange-500"
                style={[
                  Platform.select({
                    ios: {
                      shadowColor: colors.orange[600],
                      shadowOffset: { width: 0, height: 3 },
                      shadowOpacity: 0.3,
                      shadowRadius: 8,
                    },
                    android: { elevation: 3 },
                  }),
                  status === "finishing" ? { opacity: 0.5 } : null,
                ]}
              >
                <View className="h-[18px] w-[18px] rounded-[4px] bg-on-accent" />
                {/* Clipped while it grows, so the waves are revealed rather than squeezed. */}
                <Animated.View style={[{ overflow: "hidden", flexDirection: "row" }, wavesStyle]}>
                  <View style={{ paddingLeft: WAVES_GAP, flexShrink: 0 }}>
                    <SoundWaves level={level} color={colors.onAccent} />
                  </View>
                </Animated.View>
              </AnimatedPressable>
            </Animated.View>
            <View className="w-[96px]" />
          </View>
        ) : (
          <>
            {undoButton ? <View className="items-center">{undoButton}</View> : null}
            <View className="flex-row items-center gap-3">
              <SecondaryButton icon="mic" size="lg" label={t.live.talkAgain} onPress={() => void start()} />
              <PrimaryButton size="lg" label={t.live.done} onPress={handleClose} className="flex-1" />
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
