import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";

import { GemLogo } from "@/components/GemLogo";
import { OnboardingLayout } from "@/components/OnboardingLayout";
import { colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/useTranslation";
import { classifyIntent } from "@/lib/ai/classifyIntent";
import { extractTasks } from "@/lib/ai/extractTasks";
import type { ExtractedTaskDraft } from "@/lib/ai/types";
import { posthog } from "@/lib/posthog";
import { useOnboardingStore } from "@/store/useOnboardingStore";

const TOTAL_STEPS = 4;
/** How long each line of the checklist holds before the next one lights up. */
const STEP_MS = 850;
/** A beat on the finished list, so the last tick is seen before we move on. */
const FINISH_MS = 650;

const RING_SIZE = 148;
const DISC_SIZE = 92;
/**
 * The mark's own footprint, deliberately smaller than the ring: the ring is a
 * faint pulse and is allowed to spill past it, so everything below sits close
 * to the disc rather than to the widest the ring ever gets.
 */
const MARK_HEIGHT = 116;

/** The mark for this step: the app thinking, with a ring breathing out of it. */
function AnalyzingMark() {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 1900, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [pulse]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.82 + pulse.value * 0.18 }],
    opacity: 0.5 - pulse.value * 0.34,
  }));

  return (
    <View className="items-center justify-center" style={{ height: MARK_HEIGHT, width: RING_SIZE }}>
      <Animated.View
        className="absolute rounded-full border border-orange-500"
        style={[{ height: RING_SIZE, width: RING_SIZE }, ringStyle]}
      />
      <View
        className="items-center justify-center rounded-full bg-orange-100"
        style={{ height: DISC_SIZE, width: DISC_SIZE }}
      >
        <GemLogo size={40} />
      </View>
    </View>
  );
}

/** One line of the checklist: done, being worked on, or still to come. */
function AnalyzingStep({ label, state }: { label: string; state: "done" | "active" | "waiting" }) {
  return (
    <View className="flex-row items-start gap-3">
      {state === "done" ? (
        <View className="h-7 w-7 items-center justify-center rounded-full bg-olive-500">
          <Feather name="check" size={16} color={colors.cream[50]} />
        </View>
      ) : state === "active" ? (
        <View className="h-7 w-7 items-center justify-center rounded-full border-2 border-orange-500">
          <View className="h-2 w-2 rounded-full bg-orange-500" />
        </View>
      ) : (
        <View className="h-7 w-7 rounded-full border-2 border-cream-300" />
      )}
      <Text
        className={
          state === "waiting"
            ? "flex-1 pt-1 font-grotesk-medium text-base text-ink-cream-muted"
            : state === "active"
              ? "flex-1 pt-1 font-grotesk-bold text-base text-orange-500"
              : "flex-1 pt-1 font-grotesk-bold text-base text-ink-cream"
        }
      >
        {label}
      </Text>
    </View>
  );
}

export default function OnboardingAnalyzing() {
  const t = useTranslation();
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();

  const dump = useOnboardingStore((state) => state.dump);
  const setDrafts = useOnboardingStore((state) => state.setDrafts);

  // How far the ticker has got, and what the AI came back with.
  const [ticked, setTicked] = useState(0);
  const [result, setResult] = useState<ExtractedTaskDraft[] | null>(null);
  const [finished, setFinished] = useState(false);

  // The list is only finished when the ticker has reached the last line *and*
  // the AI has answered — so a fast answer still gets the whole animation, and
  // a slow one holds on the last line rather than the screen jumping ahead.
  const allDone = result !== null && ticked >= TOTAL_STEPS - 1;
  const completed = allDone ? TOTAL_STEPS : ticked;

  // The same route the AI chat uses on a typed message: whatever the model
  // decides to create out of the dump is what this flow shows.
  useEffect(() => {
    let cancelled = false;
    classifyIntent({ text: dump, now: new Date(), recentTaskIds: [], tasks: [] })
      .then((turn) => {
        if (cancelled) return;
        // Every CREATE_TASK, not the first one: /api/inbox resolves a compound
        // message by looping one instruction at a time, so a dump listing four
        // things comes back as four separate actions carrying one draft each.
        // Finding a single action here is what dropped the other three.
        setResult(turn.actions.flatMap((action) => (action.type === "CREATE_TASK" ? action.drafts : [])));
      })
      .catch((error) => {
        // The heuristic splitter is what classifyIntent itself falls back to,
        // so an outright failure here still has something to show.
        console.warn("[onboarding-analyzing] extraction failed", error);
        if (!cancelled) setResult(extractTasks(dump));
      });
    return () => {
      cancelled = true;
    };
  }, [dump]);

  useEffect(() => {
    const ticker = setInterval(() => {
      // Stops one short: the last line stays lit until the answer arrives.
      setTicked((current) => Math.min(current + 1, TOTAL_STEPS - 1));
    }, STEP_MS);
    return () => clearInterval(ticker);
  }, []);

  useEffect(() => {
    if (!allDone || result === null) return;
    const handoff = setTimeout(() => {
      setDrafts(result);
      posthog.capture("onboarding_dump_extracted", { task_count: result.length });
      setFinished(true);
    }, FINISH_MS);
    return () => clearTimeout(handoff);
  }, [allDone, result, setDrafts]);

  if (!isLoaded) return null;
  if (isSignedIn) return <Redirect href="/" />;

  return (
    <OnboardingLayout
      percent={65}
      centered
      mark={<AnalyzingMark />}
      headline={t.onboardingAnalyzing.headline}
      body={t.onboardingAnalyzing.body}
      leaving={finished}
      // Replace, not push: this step has nothing to come back to, and leaving
      // it in the stack would bounce anyone pressing back straight forward
      // again, since it would still be in its finished state.
      onNext={() => router.replace("/onboarding-plan")}
      // Nothing to press: this step leaves on its own once the AI answers.
      footer={() => null}
    >
      <View className="gap-4 rounded-[20px] border border-cream-300 bg-cream-50 p-5">
        {t.onboardingAnalyzing.steps.map((label, index) => (
          <AnalyzingStep
            key={label}
            label={label}
            state={index < completed ? "done" : index === completed ? "active" : "waiting"}
          />
        ))}
      </View>
    </OnboardingLayout>
  );
}
