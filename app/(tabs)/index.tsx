import { Feather, Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { GemLogo } from "@/components/GemLogo";
import { NextTaskCardStack } from "@/components/NextTaskCardStack";
import { colors } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDuration } from "@/lib/formatDuration";
import { posthog } from "@/lib/posthog";
import { useSessionStore } from "@/store/useSessionStore";
import { useTaskStore } from "@/store/useTaskStore";
import type { Task } from "@/types/task";

export default function Next() {
  const t = useTranslation();
  const rtl = useRtlText();
  const router = useRouter();
  const tasks = useTaskStore((state) => state.tasks);
  // A session runs inside its own task's card (see NextTaskCard), so the
  // stack stays swipeable while the clock ticks.
  const activeSession = useSessionStore((state) => state.session);
  const startSession = useSessionStore((state) => state.start);
  const leaveSession = useSessionStore((state) => state.leave);

  const [activeIndex, setActiveIndex] = useState(0);

  // "I've only got 20 minutes" in the AI chat routes here carrying that budget
  // (see REDIRECT_NEXT in lib/ai/classifyIntent.ts). Without reading it back
  // out the redirect was just an ordinary tab switch.
  const { minutes } = useLocalSearchParams<{ minutes?: string }>();
  const parsedMinutes = minutes ? Number.parseInt(minutes, 10) : Number.NaN;
  const activeBudget = Number.isFinite(parsedMinutes) && parsedMinutes > 0 ? parsedMinutes : undefined;

  // Highest priority first.
  const allPendingTasks = useMemo(
    () => tasks.filter((task) => task.status === "pending").sort((a, b) => b.priorityScore - a.priorityScore),
    [tasks],
  );
  // Narrowed to what actually fits the stated window — but never down to an
  // empty screen: if nothing fits, the whole queue is better than nothing,
  // and the banner says so.
  const fittingTasks = useMemo(
    () =>
      activeBudget === undefined
        ? allPendingTasks
        : allPendingTasks.filter(
            (task) =>
              // A task with a session running on it is never filtered away:
              // the clock, and the only way to stop it, live in that card.
              activeSession?.taskIds.includes(task.id) ||
              (task.estimatedMinutes > 0 && task.estimatedMinutes <= activeBudget),
          ),
    [allPendingTasks, activeBudget, activeSession],
  );
  const budgetHasMatches =
    activeBudget === undefined || allPendingTasks.some(
      (task) => task.estimatedMinutes > 0 && task.estimatedMinutes <= activeBudget,
    );
  const pendingTasks = budgetHasMatches ? fittingTasks : allPendingTasks;
  const total = pendingTasks.length;
  const currentIndex = total === 0 ? 0 : Math.min(activeIndex, total - 1);
  const currentTask = pendingTasks[currentIndex];

  // The session's card is gone once its task is finished or deleted — nothing
  // is left to show the clock, so the session ends with it. Checked against
  // every pending task, not the ones the time filter is showing: a running
  // task that simply doesn't fit the stated window is still running.
  useEffect(() => {
    if (!activeSession) return;
    const stillRunning = allPendingTasks.some((task) => activeSession.taskIds.includes(task.id));
    if (!stillRunning) leaveSession();
  }, [activeSession, allPendingTasks, leaveSession]);

  const handleStartSession = (task: Task, plannedMinutes: number) => {
    posthog.capture("session_started", {
      available_minutes: plannedMinutes,
      task_count: 1,
    });
    startSession({ taskIds: [task.id], plannedMinutes, energy: "ready" });
  };

  const handleDetails = (taskId: string) => {
    router.push({ pathname: "/task/[id]", params: { id: taskId } });
  };

  if (!currentTask) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.charcoal[900] }} edges={["top"]}>
        <View className="flex-1 items-center justify-center gap-3 bg-cream-100 px-6">
          <Ionicons name="checkmark-done-circle" size={40} color={colors.orange[500]} />
          <Text className="text-card-title text-ink-cream">{t.next.allCaughtUp}</Text>
          <Text className="text-body text-center text-ink-cream-muted">{t.next.allCaughtUpBody}</Text>
          <AnimatedPressable onPress={() => router.push("/add")} className="btn btn--primary mt-2 flex-row gap-2 px-6">
            <Feather name="plus" size={16} color={colors.cream[50]} />
            <Text className="font-grotesk-bold text-base text-cream-50">{t.next.addATask}</Text>
          </AnimatedPressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.charcoal[900] }} edges={["top"]}>
      <View className="gap-2.5 bg-charcoal-900 px-6 pb-4 pt-2">
        <View className="flex-row items-center gap-2">
          <Feather name="zap" size={12} color={colors.orange[500]} />
          <Text className="font-grotesk-bold text-xs tracking-[0.11em] text-orange-500">{t.next.eyebrow}</Text>
        </View>
        <View className="flex-row items-center gap-2.5">
          <GemLogo size={26} onDark />
          <Text className="flex-1 font-grotesk-bold text-lg leading-[1.2] tracking-tight text-ink-charcoal" style={rtl}>
            {t.next.heading}
          </Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1, backgroundColor: colors.cream[100] }}
        contentContainerStyle={{ paddingTop: 20, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {activeBudget !== undefined ? (
          <View className="mx-6 mb-4 flex-row items-center gap-2 rounded-2xl border border-orange-500/40 bg-orange-100 px-4 py-2.5">
            <Feather name="clock" size={14} color={colors.orange[600]} />
            <Text className="flex-1 font-grotesk-semibold text-sm text-orange-600" style={rtl}>
              {budgetHasMatches
                ? t.next.timeFilter(formatDuration(activeBudget))
                : t.next.timeFilterEmpty(formatDuration(activeBudget))}
            </Text>
            <AnimatedPressable
              // Cleared on the route rather than in local state, so coming
              // back later with the same budget still shows the banner.
              onPress={() => {
                router.setParams({ minutes: "" });
                setActiveIndex(0);
              }}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Text className="font-grotesk-bold text-sm text-orange-600">{t.next.timeFilterClear}</Text>
            </AnimatedPressable>
          </View>
        ) : null}

        <View className="flex-row items-center gap-2.5 px-6">
          <View className="h-3 w-3 rounded-full bg-orange-500" />
          <Text className="font-grotesk-bold text-[17px] text-ink-cream">{t.next.rankOf(currentIndex + 1, total)}</Text>
        </View>

        <NextTaskCardStack
          tasks={pendingTasks}
          currentIndex={currentIndex}
          onIndexChange={setActiveIndex}
          onStart={handleStartSession}
          onDetails={handleDetails}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
