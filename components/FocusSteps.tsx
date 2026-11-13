import { Fragment, useEffect, useRef, useState, type ComponentRef, type ReactNode, type RefObject } from "react";
import { ScrollView, Text, View } from "react-native";
import Animated, { FadeIn, useReducedMotion } from "react-native-reanimated";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { AppIcon } from "@/components/icons/AppIcons";
import { colors } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import type { Subtask, Task } from "@/types/task";

const P = colors.palette;
// How long a tap shows on its own before it's handed to the store (saving
// re-renders the whole Today page, so it waits until the tick has drawn).
const HAND_OVER_MS = 160;

/** The dots' sizes, largest first, with the space either side of each line. */
const DOT_SIZES = [
  { dot: 28, gap: 6 },
  { dot: 22, gap: 5 },
  { dot: 16, gap: 3 },
] as const;
/** The shortest a line between two dots gets. */
const LINE_MIN = 6;
/** The row's own side padding. */
const ROW_PADDING = 8;

/** The dots in one centred row — or, when they can't all fit, a row that scrolls sideways. */
function DotsRow({
  scrolls,
  scrollRef,
  children,
}: {
  scrolls: boolean;
  scrollRef: RefObject<ComponentRef<typeof ScrollView> | null>;
  children: ReactNode;
}) {
  if (scrolls) {
    return (
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ alignSelf: "stretch" }}
        contentContainerStyle={{ flexDirection: "row", alignItems: "center", paddingHorizontal: ROW_PADDING }}
      >
        {children}
      </ScrollView>
    );
  }
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", alignSelf: "stretch", paddingHorizontal: ROW_PADDING }}>
      {children}
    </View>
  );
}

/** How wide a row of `count` dots at this size is, at its tightest. */
function rowNeeds(count: number, size: { dot: number; gap: number }): number {
  return count * (size.dot + 8) + Math.max(0, count - 1) * (LINE_MIN + size.gap * 2) + ROW_PADDING * 2;
}

/**
 * A focus session on a task with steps (the user's screenshot, 2026-11-10):
 * a row of numbered dots — done ones ticked, the current one ringed — the
 * current step written out under it, and "Step done" to tick it off. The
 * last step done finishes the task. A done dot can be tapped to take it back.
 */
export function FocusSteps({
  task,
  onToggleStep,
  locked,
}: {
  task: Task;
  onToggleStep: (stepId: string) => void;
  /** The task is being finished: a tap now would be drawn but never saved. */
  locked: boolean;
}) {
  const t = useTranslation();
  const rtl = useRtlText();
  const reduceMotion = useReducedMotion();
  const steps = (task.subtasks ?? []).slice().sort((a, b) => a.order - b.order);

  // A tap shows here at once; each step goes back to the store's word once
  // the store agrees with it (as the old checklist did).
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const caughtUp = Object.keys(ticked).filter((id) => {
    const step = steps.find((entry) => entry.id === id);
    return !step || (step.status === "completed") === ticked[id];
  });
  if (caughtUp.length > 0) {
    setTicked((current) => {
      const next = { ...current };
      caughtUp.forEach((id) => delete next[id]);
      return next;
    });
  }
  const isDone = (step: Subtask) => ticked[step.id] ?? step.status === "completed";

  // A second tap before the first is handed over cancels it out.
  const waiting = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const toggle = (step: Subtask) => {
    if (locked) return;
    setTicked((current) => ({ ...current, [step.id]: !(current[step.id] ?? step.status === "completed") }));
    const earlier = waiting.current.get(step.id);
    if (earlier !== undefined) {
      clearTimeout(earlier);
      waiting.current.delete(step.id);
      return;
    }
    waiting.current.set(
      step.id,
      setTimeout(() => {
        waiting.current.delete(step.id);
        onToggleStep(step.id);
      }, HAND_OVER_MS),
    );
  };

  const currentIndex = steps.findIndex((step) => !isDone(step));
  const current = currentIndex >= 0 ? steps[currentIndex] : null;
  // Smaller dots once there are many, so the row still fits.
  // The dots shrink to fit the row (a phone 360 dp wide can't take 7 at full
  // size); with more than even the smallest fit, the row scrolls sideways
  // and keeps the current step in view.
  const [rowWidth, setRowWidth] = useState(0);
  const fit = DOT_SIZES.find((size) => rowNeeds(steps.length, size) <= rowWidth) ?? null;
  // Before the row is measured: full size.
  const { dot, gap } = rowWidth === 0 ? DOT_SIZES[0] : (fit ?? DOT_SIZES[DOT_SIZES.length - 1]);
  const scrolls = rowWidth > 0 && fit === null;
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  useEffect(() => {
    if (!scrolls || currentIndex < 0) return;
    const step = dot + 8 + LINE_MIN + gap * 2;
    scrollRef.current?.scrollTo({ x: Math.max(0, currentIndex * step - rowWidth / 2 + (dot + 8) / 2), animated: !reduceMotion });
  }, [currentIndex, dot, gap, reduceMotion, rowWidth, scrolls]);

  return (
    <View
      style={{ alignSelf: "stretch", alignItems: "center" }}
      onLayout={(event) => {
        const width = Math.round(event.nativeEvent.layout.width);
        setRowWidth((current) => (current === width ? current : width));
      }}
    >
      <DotsRow scrolls={scrolls} scrollRef={scrollRef}>
        {steps.map((step, index) => {
          const done = isDone(step);
          const isCurrent = index === currentIndex;
          // The line into this dot: orange once the dot before it is done.
          const lineDone = index > 0 && isDone(steps[index - 1]);
          return (
            <Fragment key={step.id}>
              {index > 0 ? (
                <View
                  style={{
                    flex: scrolls ? 0 : 1,
                    width: scrolls ? LINE_MIN : undefined,
                    maxWidth: 34,
                    minWidth: LINE_MIN,
                    height: 3,
                    borderRadius: 2,
                    marginHorizontal: gap,
                    backgroundColor: lineDone ? P.accent : P.lineWarm,
                  }}
                />
              ) : null}
              <AnimatedPressable
                onPress={done ? () => toggle(step) : undefined}
                disabled={!done}
                scaleTo={0.9}
                accessibilityRole="button"
                accessibilityState={{ checked: done, selected: isCurrent }}
                accessibilityLabel={t.focusPage.stepOf(index + 1, steps.length, step.label)}
                style={{
                  width: dot + 8,
                  height: dot + 8,
                  borderRadius: (dot + 8) / 2,
                  alignItems: "center",
                  justifyContent: "center",
                  // The current step's soft ring.
                  backgroundColor: isCurrent ? "rgba(242, 106, 46, 0.18)" : "transparent",
                }}
              >
                <View
                  style={{
                    width: dot,
                    height: dot,
                    borderRadius: dot / 2,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: done || isCurrent ? P.accent : "transparent",
                    borderWidth: done || isCurrent ? 0 : 2,
                    borderColor: P.ring,
                  }}
                >
                  {done ? (
                    <AppIcon name="check" size={dot * 0.5} strokeWidth={3} color="#FFFFFF" />
                  ) : (
                    <Text
                      style={{
                        fontFamily: isCurrent ? "SpaceGrotesk-Bold" : "SpaceGrotesk-SemiBold",
                        fontSize: dot > 24 ? 14 : 12,
                        color: isCurrent ? "#FFFFFF" : P.paperFaint,
                        includeFontPadding: false,
                      }}
                    >
                      {index + 1}
                    </Text>
                  )}
                </View>
              </AnimatedPressable>
            </Fragment>
          );
        })}
      </DotsRow>

      {current ? (
        <>
          <Animated.Text
            key={current.id}
            entering={reduceMotion ? undefined : FadeIn.duration(220)}
            numberOfLines={4}
            style={[
              {
                marginTop: 14,
                paddingHorizontal: 12,
                fontFamily: "SpaceGrotesk-Medium",
                fontSize: 17,
                lineHeight: 24,
                color: P.ink,
                textAlign: "center",
              },
              rtl,
              { textAlign: "center" },
            ]}
          >
            {current.label}
          </Animated.Text>

          <AnimatedPressable
            onPress={() => toggle(current)}
            disabled={locked}
            scaleTo={0.95}
            accessibilityRole="button"
            accessibilityLabel={`${t.focusPage.stepDone}: ${current.label}`}
            style={{
              marginTop: 14,
              height: 36,
              borderRadius: 18,
              paddingHorizontal: 16,
              flexDirection: "row",
              alignItems: "center",
              gap: 7,
              backgroundColor: P.peach,
            }}
          >
            <AppIcon name="check" size={14} strokeWidth={2.8} color={P.accentInk} />
            <Text style={{ fontFamily: "SpaceGrotesk-SemiBold", fontSize: 15, color: P.accentInk, includeFontPadding: false }}>
              {t.focusPage.stepDone}
            </Text>
          </AnimatedPressable>
        </>
      ) : null}
    </View>
  );
}
