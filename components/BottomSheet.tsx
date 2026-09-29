import { Feather } from "@expo/vector-icons";
import { useEffect, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { MOTION } from "@/constants/theme";
import { useColors } from "@/hooks/useTheme";

/**
 * The Tasks page's filter sheet, as a shell every sheet shares: a cream panel
 * rising from the bottom over the charcoal scrim, titled with a muted eyebrow.
 * Tapping the scrim closes it. Pass `closeLabel` to also show an ✕ — worth
 * it on a sheet with a lot in it, where the scrim is a thin strip.
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  titleIcon,
  closeLabel,
  panelClassName = "",
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Beside the title, e.g. the AI's sparkle. Only shown with the ✕ row. */
  titleIcon?: ReactNode;
  closeLabel?: string;
  panelClassName?: string;
  children: ReactNode;
}) {
  const colors = useColors();
  const { height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      const frame = requestAnimationFrame(() => {
        setMounted(true);
        progress.set(withTiming(1, {
          duration: reduceMotion ? 0 : MOTION.duration.screen,
          easing: MOTION.easing.standard,
        }));
      });
      return () => cancelAnimationFrame(frame);
    }

    progress.set(withTiming(0, {
      duration: reduceMotion ? 0 : MOTION.duration.screen,
      easing: MOTION.easing.standard,
    }, (finished) => {
      if (finished) scheduleOnRN(setMounted, false);
    }));
  }, [progress, reduceMotion, visible]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * height }],
  }));

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      {/* Lets a sheet with a text field rise above the keyboard on iOS. */}
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }, scrimStyle]}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Pressable className="flex-1 justify-end" onPress={onClose}>
            <Animated.View style={[{ maxHeight: "88%" }, panelStyle]}>
              <Pressable onPress={() => {}} className={`card--cream-elevated rounded-t-2xl p-6 pb-10 ${panelClassName}`}>
                {closeLabel ? (
                  <View className="mb-3 flex-row items-center justify-between gap-3">
                    <View className="shrink flex-row items-center gap-2">
                      {titleIcon}
                      <Text className="eyebrow text-ink-cream-muted">{title}</Text>
                    </View>
                    <AnimatedPressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel={closeLabel}>
                      <Feather name="x" size={20} color={colors.ink.creamMuted} />
                    </AnimatedPressable>
                  </View>
                ) : (
                  <Text className="eyebrow mb-3 text-ink-cream-muted">{title}</Text>
                )}
                {children}
              </Pressable>
            </Animated.View>
          </Pressable>
        </KeyboardAvoidingView>
      </Animated.View>
    </Modal>
  );
}
