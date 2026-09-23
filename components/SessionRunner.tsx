import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import Animated, { FadeInUp } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { SessionDotConnector, SessionRunTaskCard } from "@/components/SessionRunTaskCard";
import { SessionTimerCard } from "@/components/SessionTimerCard";
import { StuckSheet } from "@/components/StuckSheet";
import { colors } from "@/constants/theme";
import { useSessionCountdown } from "@/hooks/useSessionCountdown";
import { useTranslation } from "@/hooks/useTranslation";
import { posthog } from "@/lib/posthog";
import { useSessionStore } from "@/store/useSessionStore";
import { useTaskStore } from "@/store/useTaskStore";

/**
 * NOT CURRENTLY RENDERED. Nothing imports this component, and the same is true
 * of the three it is built from — SessionRunTaskCard, SessionTimerCard and
 * StuckSheet. useSessionStore's resetTimer, focusTask and dropTask exist only
 * for this screen and are dead with it. Kept deliberately, not by accident.
 *
 * What replaced it: a session now runs *inside* the card of the task it is for
 * (SessionPanel in components/NextTaskCard.tsx), so the Next stack stays
 * swipeable while the clock ticks. That path only ever runs one task, which is
 * why the multi-task machinery here — the task list, "I'm stuck", moving the
 * focus between tasks — has nowhere to live at the moment.
 *
 * ---
 *
 * The running-session view of the Next tab. Everything on it is derived from
 * the snapshot the user set up before pressing "Start session" — the task
 * list, the countdown length and the ordering all come from that plan, so
 * this screen only has to render and advance it.
 */
export function SessionRunner() {
  const t = useTranslation();
  const router = useRouter();

  const session = useSessionStore((state) => state.session);
  const pause = useSessionStore((state) => state.pause);
  const resume = useSessionStore((state) => state.resume);
  const resetTimer = useSessionStore((state) => state.resetTimer);
  const focusTask = useSessionStore((state) => state.focusTask);
  const dropTask = useSessionStore((state) => state.dropTask);
  const leave = useSessionStore((state) => state.leave);

  const tasks = useTaskStore((state) => state.tasks);
  const completeTask = useTaskStore((state) => state.completeTask);
  const completeStep = useTaskStore((state) => state.completeStep);
  const skipTask = useTaskStore((state) => state.skipTask);

  const [stuckOpen, setStuckOpen] = useState(false);

  const countdown = useSessionCountdown(session);

  // Tasks deleted elsewhere (Tasks tab, AI chat) simply drop out of the run.
  const sessionTaskEntries = useMemo(() => {
    if (!session) return [];
    return session.taskIds.flatMap((taskId, sessionIndex) => {
      const task = tasks.find((candidate) => candidate.id === taskId);
      return task ? [{ task, sessionIndex }] : [];
    });
  }, [session, tasks]);
  const sessionTasks = sessionTaskEntries.map((entry) => entry.task);

  useEffect(() => {
    if (session && sessionTasks.length === 0) leave();
  }, [session, sessionTasks.length, leave]);

  if (!session || sessionTasks.length === 0) return null;

  const activeSessionIndex = Math.min(Math.max(session.activeIndex, 0), session.taskIds.length - 1);
  const projectedActiveIndex = sessionTaskEntries.findIndex((entry) => entry.sessionIndex >= activeSessionIndex);
  const activeIndex = projectedActiveIndex >= 0 ? projectedActiveIndex : sessionTaskEntries.length - 1;
  const activeTask = sessionTasks[activeIndex];
  const unfinishedCount = sessionTasks.filter((task) => task.status !== "completed").length;

  // Zustand applies its updates synchronously, so the handlers below can read
  // the store back for the *post-mutation* truth instead of the values this
  // render closed over.
  const isFinished = (taskId: string) =>
    useTaskStore.getState().tasks.find((task) => task.id === taskId)?.status === "completed";

  const endSession = (outcome: "finished" | "left") => {
    posthog.capture("session_ended", {
      outcome,
      task_count: sessionTasks.length,
      completed_count: sessionTasks.filter((task) => isFinished(task.id)).length,
      planned_minutes: session.plannedMinutes,
      energy_level: session.energy,
    });
    leave();
  };

  // Moves focus to the next unfinished task — forwards first, then wrapping
  // back for anything skipped over — and ends the run when none are left.
  const goPast = (index: number) => {
    const forward = sessionTasks.findIndex((task, i) => i > index && !isFinished(task.id));
    const next = forward >= 0 ? forward : sessionTasks.findIndex((task) => !isFinished(task.id));

    if (next >= 0) focusTask(sessionTaskEntries[next].sessionIndex);
    else endSession("finished");
  };

  const handleDone = (taskId: string, index: number) => {
    completeTask(taskId);
    goPast(index);
  };

  const handleToggleSubtask = (taskId: string, subtaskId: string, index: number) => {
    completeStep(taskId, subtaskId);
    // completeStep auto-completes the task once its last step is checked, so
    // checking off the final step advances the session in the same tap.
    if (index === activeIndex && isFinished(taskId)) goPast(index);
  };

  const handlePickStuckReason = (reason: string) => {
    setStuckOpen(false);
    skipTask(activeTask.id, reason);
    dropTask(activeTask.id);
  };

  // Being stuck is a conversation, so it opens AI Chat — quick advice and
  // breakdowns stay inline on the task card instead.
  const handleAskAiAboutStuck = () => {
    setStuckOpen(false);
    router.push({
      pathname: "/(tabs)/ai-chat",
      params: { taskId: activeTask.id, mode: "analyze", minutes: String(session.plannedMinutes) },
    });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.charcoal[900] }} edges={["top"]}>
      <View className="gap-4 border-b border-white/10 bg-charcoal-900 px-6 pb-4 pt-2">
        <View className="flex-row items-center justify-between gap-3">
          <AnimatedPressable
            onPress={() => endSession("left")}
            accessibilityRole="button"
            className="flex-row items-center gap-2 rounded-full bg-white/10 px-4 py-2"
          >
            <Feather name="arrow-left" size={15} color={colors.ink.charcoal} />
            <Text className="font-grotesk-semibold text-sm text-ink-charcoal">{t.session.leave}</Text>
          </AnimatedPressable>
          <Text className="font-grotesk-medium text-sm text-ink-charcoal-muted">
            {t.session.taskOf(activeIndex + 1, sessionTasks.length)}
          </Text>
        </View>

        <View className="flex-row gap-1.5">
          {sessionTasks.map((task, index) => (
            <View
              key={task.id}
              className={
                index <= activeIndex || task.status === "completed"
                  ? "h-1 flex-1 rounded-full bg-orange-500"
                  : "h-1 flex-1 rounded-full bg-white/10"
              }
            />
          ))}
        </View>
      </View>

      <ScrollView
        style={{ backgroundColor: colors.charcoal[900] }}
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-7 p-6 pt-6">
          <SessionTimerCard
            countdown={countdown}
            onToggleRunning={countdown.isRunning ? pause : resume}
            onReset={resetTimer}
          />

          <View className="gap-7">
            <Text className="eyebrow text-orange-500">{t.session.tasksHeading}</Text>

            <View>
              {sessionTasks.map((task, index) => (
                <Fragment key={task.id}>
                  {index > 0 ? <SessionDotConnector spacing="group" /> : null}
                  <Animated.View entering={FadeInUp.delay(index * 60).duration(280)}>
                    <SessionRunTaskCard
                      task={task}
                      index={index}
                      total={sessionTasks.length}
                      isActive={index === activeIndex}
                      isLastTask={unfinishedCount <= 1}
                      availableMinutes={session.plannedMinutes}
                      onDone={() => handleDone(task.id, index)}
                      onFocus={() => focusTask(sessionTaskEntries[index].sessionIndex)}
                      onStuck={() => setStuckOpen(true)}
                      onToggleSubtask={(subtaskId) => handleToggleSubtask(task.id, subtaskId, index)}
                    />
                  </Animated.View>
                </Fragment>
              ))}
            </View>
          </View>
        </View>
      </ScrollView>

      <StuckSheet
        visible={stuckOpen}
        taskTitle={activeTask.title}
        onPickReason={handlePickStuckReason}
        onAskAi={handleAskAiAboutStuck}
        onClose={() => setStuckOpen(false)}
      />
    </SafeAreaView>
  );
}
