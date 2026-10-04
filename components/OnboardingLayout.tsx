import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { HighlightedText } from "@/components/HighlightedText";
import { SetupProgressBar } from "@/components/SetupProgressBar";
import { gradients } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";

// One step sinks out of the way before the next rises into it, so the two are
// never on screen together. Easing *in* on the way down and *out* on the way
// up makes the pair read as a single continuous movement rather than two
// separate animations.
const EXIT_DURATION = 220;
const ENTER_DURATION = 320;
/** How far below its resting place the content sits when it is off screen. */
const TRAVEL = 24;

/**
 * The frame every onboarding step shares: the setup bar up top, the headline
 * and its line of body copy, the step's own illustration in the middle, and
 * the continue button at the bottom. A step supplies only its copy and its
 * visual, so the chrome can never drift between screens.
 *
 * It also owns the step-to-step transition. The bar holds still while
 * everything below it fades down and out, and the next step fades up into
 * place — so `onNext` runs only once this step is out of sight.
 */
export function OnboardingLayout({
  percent,
  eyebrow,
  headline,
  body,
  onNext,
  centered = false,
  mark,
  nextLabel,
  footer,
  inlineFooter = false,
  leaving = false,
  secondaryAction,
  children,
}: {
  percent: number;
  /**
   * A short label above the headline. A plain string gets the orange eyebrow
   * treatment; pass a node to draw it yourself.
   */
  eyebrow?: ReactNode;
  headline: string;
  body: string;
  onNext: () => void;
  /** Ranges the copy down the middle and sets it larger — the hero steps. */
  centered?: boolean;
  /** Drawn above the headline, centered: the app mark, a status animation. */
  mark?: ReactNode;
  /**
   * Given, the step ends in a full-width labelled button; left off, in the
   * quiet arrow disc that keeps a step's illustration the thing to look at.
   */
  nextLabel?: string;
  /**
   * Replaces the standard action with one the step draws itself — for a
   * control that has more than one state. It is handed the same "leave this
   * step" callback the standard button uses, so the exit still runs.
   */
  footer?: (next: () => void) => ReactNode;
  /**
   * Draws the footer straight under the step's content instead of pinned to
   * the bottom of the screen — for a control that belongs to the thing above
   * it, which on a tall phone would otherwise end up a long way from it.
   */
  inlineFooter?: boolean;
  /**
   * Flip to true for a step that finishes on its own: the exit runs and
   * `onNext` is called without anyone having pressed anything.
   */
  leaving?: boolean;
  /**
   * A quiet text link under the step's action — for a way out that shouldn't
   * compete with it (the first step's "I already have an account"). It leaves
   * straight away, without the step's exit animation.
   */
  secondaryAction?: { label: string; onPress: () => void };
  children: ReactNode;
}) {
  const colors = useColors();
  useStatusBarStyle("dark");
  const t = useTranslation();
  const rtl = useRtlText();
  const insets = useSafeAreaInsets();

  // 1 = settled in place, 0 = TRAVEL below it and fully transparent. Entering
  // and leaving are the same journey, run in opposite directions.
  const settled = useSharedValue(0);
  // Set once next has been pressed. Also the double-tap guard: a second tap is
  // a no-op set.
  const [pressed, setPressed] = useState(false);
  // Derived rather than mirrored, so a step that finishes on its own and a
  // step someone pressed drive the exit through exactly the same path.
  const phase: "entering" | "leaving" = pressed || leaving ? "leaving" : "entering";

  // Held in a ref so that it is not a dependency of the effect below: a step
  // re-rendering for its own reasons (onboarding-sort measures its
  // illustration on layout) would otherwise restart the animation mid-flight.
  const onNextRef = useRef(onNext);
  useEffect(() => {
    onNextRef.current = onNext;
  }, [onNext]);

  // Both directions live here, which is also the only place the compiler's
  // immutability rule lets a shared value be written — it is a dependency of
  // this effect rather than something captured by a returned callback.
  useEffect(() => {
    if (phase === "entering") {
      settled.value = withTiming(1, { duration: ENTER_DURATION, easing: Easing.out(Easing.cubic) });
      return;
    }
    settled.value = withTiming(0, { duration: EXIT_DURATION, easing: Easing.in(Easing.cubic) });
    // Hand over only once this step is out of sight.
    const handoff = setTimeout(() => onNextRef.current(), EXIT_DURATION);
    return () => clearTimeout(handoff);
  }, [phase, settled]);

  // On focus rather than on mount: this screen stays in the stack underneath
  // the next one, so coming back to it (Android back, iOS swipe) has to undo
  // the exit or it would sit there invisible.
  useFocusEffect(
    useCallback(() => {
      setPressed(false);
    }, []),
  );

  const contentStyle = useAnimatedStyle(() => ({
    opacity: settled.value,
    transform: [{ translateY: (1 - settled.value) * TRAVEL }],
  }));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream[100] }}>
      {/* Warm light from the top-right corner, running up under the status
          bar — the same light as the Next page and the paywall. */}
      <View
        pointerEvents="none"
        className="absolute left-0 right-0"
        style={[{ top: -insets.top, height: 420 + insets.top }, gradients.creamGlow]}
      />

      {/* Only the dump step has anything to type into; on every other step the
          keyboard never comes up and this adds nothing. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
      <View className="flex-1 px-6 pb-6">
        {/* Deliberately outside the animated wrapper: the bar is the one thing
            that holds still as steps come and go, so filling it reads as a
            single run through setup. */}
        <SetupProgressBar percent={percent} />

        <Animated.View className="flex-1" style={contentStyle}>
          {mark ? <View className="mt-8 items-center">{mark}</View> : null}

          <View className={centered ? "mt-7 gap-3" : "mt-7 gap-2.5"}>
            {typeof eyebrow === "string" ? (
              <Text className="eyebrow text-orange-500">{eyebrow}</Text>
            ) : (
              (eyebrow ?? null)
            )}
            <Text
              className={
                centered
                  ? "text-center font-grotesk-bold text-[30px] leading-[1.15] tracking-tight text-ink-cream"
                  : "font-grotesk-bold text-[23px] leading-[1.15] tracking-tight text-ink-cream"
              }
              style={rtl}
            >
              {headline}
            </Text>
            {/* Through HighlightedText so a step can put **weight** on the
                part of its sentence that matters. Copy without any markers
                renders exactly as a plain Text would. */}
            <HighlightedText
              text={body}
              className={
                centered
                  ? "text-center text-[17px] font-grotesk-regular leading-relaxed text-ink-cream-muted"
                  : "text-[15px] font-grotesk-regular leading-relaxed text-ink-cream-muted"
              }
              highlightClassName="font-grotesk-bold text-ink-cream"
            />
          </View>

          {/* Inline, the content only takes the room it needs, so the footer
              follows right after it and the spare height collects below. It
              can still shrink: with the keyboard up there may not be room for
              both, and the footer is the part that has to stay reachable. */}
          <View className={inlineFooter ? "mt-5 shrink" : "mt-5 flex-1"}>{children}</View>

          {footer ? (
            <View className={inlineFooter ? "pt-6" : "pt-4"}>{footer(() => setPressed(true))}</View>
          ) : nextLabel ? (
            <AnimatedPressable
              onPress={() => setPressed(true)}
              scaleTo={0.97}
              accessibilityRole="button"
              accessibilityLabel={nextLabel}
              style={gradients.accent}
              className="btn btn--primary mt-4 gap-3 rounded-full"
            >
              <Text className="font-grotesk-bold text-xl text-on-accent">{nextLabel}</Text>
              <Feather name="arrow-right" size={20} color={colors.onAccent} />
            </AnimatedPressable>
          ) : (
            /* Kept small and low-contrast on purpose: the step's illustration is
               what there is to look at, and 44px is still a full touch target. */
            <View className="flex-row items-center justify-end pt-4">
              <AnimatedPressable
                onPress={() => setPressed(true)}
                scaleTo={0.94}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t.onboarding.next}
                className="btn--charcoal-solid h-11 w-11 items-center justify-center rounded-full"
              >
                <Feather name="arrow-right" size={18} color={colors.onAccent} />
              </AnimatedPressable>
            </View>
          )}

          {secondaryAction ? (
            <AnimatedPressable
              onPress={secondaryAction.onPress}
              scaleTo={0.98}
              hitSlop={8}
              accessibilityRole="button"
              className="mt-3 items-center py-1.5"
            >
              <Text className="font-grotesk-medium text-sm text-ink-cream-muted">{secondaryAction.label}</Text>
            </AnimatedPressable>
          ) : null}
        </Animated.View>
      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
