import { Feather, Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import Animated, { FadeIn, FadeInUp, FadeOut, useReducedMotion } from "react-native-reanimated";

import { AllowanceNote } from "@/components/AllowanceNote";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { MOTION } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { suggestNextMove, type NextMove } from "@/lib/ai/suggestNextMove";
import { AiConsentError } from "@/lib/aiConsent";
import { showPlanLimit } from "@/lib/paywall";
import { PlanLimitError } from "@/lib/plan";
import { posthog } from "@/lib/posthog";
import { useTaskStore } from "@/store/useTaskStore";
import type { Task } from "@/types/task";

type State = { status: "loading" } | { status: "ready"; idea: NextMove } | { status: "error" };

/**
 * "I'm stuck", in a focus session: Nexdo reads the task — its steps, what the
 * user told it — and gives ONE small action to start this minute (Pro;
 * app/api/stuck+api.ts). It can go in as the task's next step, or be swapped
 * for another idea. Asks as soon as it opens.
 */
export function StuckCard({
  task,
  minutesInSession,
  onAddStep,
  onClose,
}: {
  task: Task;
  minutesInSession: number;
  /** Not given for a task with no duration: a step would give it one. */
  onAddStep?: (idea: NextMove) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const t = useTranslation();
  const rtl = useRtlText();
  const reduceMotion = useReducedMotion();
  const [state, setState] = useState<State>({ status: "loading" });
  const previousIdeas = useRef<string[]>([]);
  // Bumped by every request and on close, so a late answer is dropped.
  const requestId = useRef(0);

  // One request; its answer lands in the state once it's back. The card opens
  // already "loading", so the first one doesn't need to say so.
  const request = async () => {
    const id = ++requestId.current;
    // Read fresh: a step may have been ticked since the card opened.
    const current = useTaskStore.getState().tasks.find((entry) => entry.id === task.id) ?? task;
    try {
      const idea = await suggestNextMove(current, { minutesInSession, previousIdeas: previousIdeas.current });
      if (id !== requestId.current) return;
      if (!idea) {
        setState({ status: "error" });
        return;
      }
      previousIdeas.current = [...previousIdeas.current, idea.action];
      setState({ status: "ready", idea });
    } catch (error) {
      if (id !== requestId.current) return;
      // Said no to AI: nothing failed, there's just nothing to show.
      if (error instanceof AiConsentError) {
        onClose();
        return;
      }
      if (error instanceof PlanLimitError) {
        onClose();
        showPlanLimit(error.meter);
        return;
      }
      console.warn("[StuckCard] couldn't get an idea", error);
      setState({ status: "error" });
    }
  };

  // "Another idea" and "Try again".
  const ask = () => {
    setState({ status: "loading" });
    void request();
  };

  // Once, on opening — from a timer, so the request starts after this render.
  useEffect(() => {
    posthog.capture("session_stuck_opened");
    const timer = setTimeout(() => void request(), 0);
    return () => {
      clearTimeout(timer);
      requestId.current += 1;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdd = (idea: NextMove) => {
    posthog.capture("session_stuck_step_added");
    onAddStep?.(idea);
    onClose();
  };

  return (
    <Animated.View
      entering={reduceMotion ? FadeIn.duration(0) : FadeInUp.duration(MOTION.duration.standard)}
      exiting={reduceMotion ? FadeOut.duration(0) : FadeOut.duration(MOTION.duration.short)}
      className="glass gap-3 rounded-[20px] p-4"
    >
      <View className="flex-row items-center gap-2">
        <Ionicons name="footsteps-outline" size={15} color={colors.orange[300]} />
        <Text className="eyebrow flex-1 text-orange-300" style={rtl}>
          {state.status === "ready" ? t.stuck.eyebrow(state.idea.minutes) : t.stuck.title}
        </Text>
        <AnimatedPressable
          onPress={onClose}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t.stuck.close}
          className="h-7 w-7 items-center justify-center rounded-full bg-white/10"
        >
          <Feather name="x" size={14} color={colors.ink.charcoalMuted} />
        </AnimatedPressable>
      </View>

      {state.status === "loading" ? (
        <View className="flex-row items-center gap-2.5 py-1">
          <ActivityIndicator size="small" color={colors.orange[400]} />
          <Text className="flex-1 font-grotesk-medium text-sm text-ink-charcoal-muted" style={rtl}>
            {t.stuck.thinking}
          </Text>
        </View>
      ) : null}

      {state.status === "error" ? (
        <View className="gap-3">
          <Text className="font-grotesk-medium text-sm text-ink-charcoal-muted" style={rtl}>
            {t.stuck.failed}
          </Text>
          <AnimatedPressable
            onPress={ask}
            accessibilityRole="button"
            className="glass min-h-[40px] flex-row items-center justify-center gap-2 rounded-[14px] px-3 py-2"
          >
            <Feather name="refresh-cw" size={14} color={colors.ink.charcoal} />
            <Text className="font-grotesk-semibold text-[14px] text-ink-charcoal">{t.stuck.retry}</Text>
          </AnimatedPressable>
        </View>
      ) : null}

      {state.status === "ready" ? (
        <View className="gap-3">
          <Text className="font-grotesk-bold text-[19px] leading-[25px] text-ink-charcoal" style={rtl}>
            {state.idea.action}
          </Text>
          <View className="flex-row gap-2.5">
            {onAddStep ? (
              <AnimatedPressable
                onPress={() => handleAdd(state.idea)}
                accessibilityRole="button"
                className="min-h-[40px] flex-1 flex-row items-center justify-center gap-2 rounded-[14px] bg-white/90 px-3 py-2"
              >
                <Feather name="plus" size={15} color={colors.charcoal[900]} />
                <Text numberOfLines={1} className="shrink font-grotesk-bold text-[14px] text-charcoal-900">
                  {t.stuck.addStep}
                </Text>
              </AnimatedPressable>
            ) : (
              <AnimatedPressable
                onPress={onClose}
                accessibilityRole="button"
                className="min-h-[40px] flex-1 flex-row items-center justify-center gap-2 rounded-[14px] bg-white/90 px-3 py-2"
              >
                <Feather name="check" size={15} color={colors.charcoal[900]} />
                <Text numberOfLines={1} className="shrink font-grotesk-bold text-[14px] text-charcoal-900">
                  {t.stuck.gotIt}
                </Text>
              </AnimatedPressable>
            )}
            <AnimatedPressable
              onPress={ask}
              accessibilityRole="button"
              className="glass min-h-[40px] flex-1 flex-row items-center justify-center gap-2 rounded-[14px] px-3 py-2"
            >
              <Feather name="refresh-cw" size={14} color={colors.ink.charcoal} />
              <Text numberOfLines={1} className="shrink font-grotesk-semibold text-[14px] text-ink-charcoal">
                {t.stuck.another}
              </Text>
            </AnimatedPressable>
          </View>
          <AllowanceNote meter="assist" onDark />
        </View>
      ) : null}
    </Animated.View>
  );
}
