import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { HighlightedText } from "@/components/HighlightedText";
import { SetupProgressBar } from "@/components/SetupProgressBar";
import { gradients } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";

/**
 * The frame every onboarding step shares: the setup bar up top, the headline
 * and its line of body copy, the step's own illustration in the middle, and
 * the continue button at the bottom. A step supplies only its copy and its
 * visual, so the chrome can never drift between screens.
 *
 * It also owns leaving the step: one path for a button press and for a step
 * that finishes on its own. There's no transition between steps — the next
 * one is simply there (the user's call, 2026-10-08).
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
  beforeNext,
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
   * Runs when the labelled button is pressed, before the step leaves — for a
   * question the step asks on the way out (notification permission), so the
   * system prompt shows over this step rather than over a blank screen.
   */
  beforeNext?: () => Promise<unknown>;
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
   * compete with it. With `onPress` (the first step's "I already have an
   * account") it leaves straight away, without the step's exit animation;
   * without, it's a second way on ("Not now"): the same exit and `onNext` as
   * the main button, minus `beforeNext`.
   */
  secondaryAction?: { label: string; onPress?: () => void };
  children: ReactNode;
}) {
  const colors = useColors();
  useStatusBarStyle("dark");
  const t = useTranslation();
  const rtl = useRtlText();
  const insets = useSafeAreaInsets();

  // Set once next has been pressed. Also the double-tap guard: a second tap is
  // a no-op set.
  const [pressed, setPressed] = useState(false);
  // Derived rather than mirrored, so a step that finishes on its own and a
  // step someone pressed drive the exit through exactly the same path.
  const phase: "entering" | "leaving" = pressed || leaving ? "leaving" : "entering";
  // While beforeNext runs: the button is taken, but the step hasn't left yet.
  const [preparing, setPreparing] = useState(false);

  const handleNextPress = async () => {
    if (preparing) return;
    if (beforeNext) {
      setPreparing(true);
      try {
        await beforeNext();
      } finally {
        setPreparing(false);
      }
    }
    setPressed(true);
  };

  // Held in a ref so that it is not a dependency of the effect below: a step
  // re-rendering for its own reasons (onboarding-sort measures its
  // illustration on layout) would otherwise leave it again.
  const onNextRef = useRef(onNext);
  useEffect(() => {
    onNextRef.current = onNext;
  }, [onNext]);

  useEffect(() => {
    if (phase === "leaving") onNextRef.current();
  }, [phase]);

  // On focus rather than on mount: this screen stays in the stack underneath
  // the next one, so coming back to it (Android back, iOS swipe) has to make
  // its button work again.
  useFocusEffect(
    useCallback(() => {
      setPressed(false);
    }, []),
  );

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
        <SetupProgressBar percent={percent} />

        <View className="flex-1">
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
            <OnboardingButton label={nextLabel} onPress={() => void handleNextPress()} className="mt-4" />
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
              onPress={secondaryAction.onPress ?? (() => setPressed(true))}
              disabled={preparing}
              scaleTo={0.98}
              hitSlop={8}
              accessibilityRole="button"
              className="mt-3 items-center py-1.5"
            >
              <Text className="font-grotesk-medium text-sm text-ink-cream-muted">{secondaryAction.label}</Text>
            </AnimatedPressable>
          ) : null}
        </View>
      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * The full-width, glowing button an onboarding step ends in. Exported for a
 * step that draws its own footer (the plans step) but keeps the same action.
 */
export function OnboardingButton({
  label,
  onPress,
  disabled = false,
  className = "",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Layout from the caller, e.g. a top margin. */
  className?: string;
}) {
  const colors = useColors();
  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      scaleTo={0.97}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={gradients.accent}
      className={`btn btn--primary gap-3 rounded-full ${disabled ? "opacity-60" : ""} ${className}`}
    >
      <Text className="font-grotesk-bold text-xl text-on-accent">{label}</Text>
      <Feather name="arrow-right" size={20} color={colors.onAccent} />
    </AnimatedPressable>
  );
}
