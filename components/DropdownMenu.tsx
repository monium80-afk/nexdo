import { Feather } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";

/** The button a menu hangs from, in window coordinates (what measureInWindow gives). */
export type DropdownAnchor = { x: number; y: number; width: number; height: number };

type DropdownOption<T extends string> = { label: string; value: T; count?: number };

// The menu's gap below its button, and the least room it keeps from the screen's edges.
const GAP = 6;
const EDGE = 16;
const MIN_WIDTH = 216;
const OPEN_MS = 180;
const CLOSE_MS = 130;

/**
 * A short list of choices dropping out of the button that opened it — the
 * Tasks page's status filter and sort. Open while `anchor` is set; a tap
 * outside, the back button or picking an option closes it.
 */
export function DropdownMenu<T extends string>({
  anchor,
  align = "left",
  options,
  selected,
  onSelect,
  onClose,
}: {
  anchor: DropdownAnchor | null;
  /** Which edge of the button the menu lines up with. */
  align?: "left" | "right";
  options: DropdownOption<T>[];
  selected: T;
  onSelect: (value: T) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const t = useTranslation();
  const { width: windowWidth } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  // Kept while it animates out, after the parent has already let go of it.
  const [shown, setShown] = useState<DropdownAnchor | null>(anchor);

  if (anchor && anchor !== shown) setShown(anchor);

  useEffect(() => {
    if (anchor) {
      progress.set(withTiming(1, { duration: reduceMotion ? 0 : OPEN_MS, easing: Easing.out(Easing.cubic) }));
      return;
    }
    progress.set(
      withTiming(0, { duration: reduceMotion ? 0 : CLOSE_MS, easing: Easing.in(Easing.quad) }, (finished) => {
        if (finished) scheduleOnRN(setShown, null);
      }),
    );
  }, [anchor, progress, reduceMotion]);

  // It drops a few points out of the button and grows from its corner there.
  const menuStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * -6 }, { scale: 0.96 + 0.04 * progress.value }],
  }));

  if (!shown) return null;

  const position =
    align === "left"
      ? { left: Math.max(EDGE, shown.x) }
      : { right: Math.max(EDGE, windowWidth - (shown.x + shown.width)) };

  return (
    // Translucent bars, so the modal's coordinates are the window's own and
    // the menu lands exactly under its button.
    <Modal visible transparent statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t.common.close} />
      <Animated.View
        style={[
          {
            position: "absolute",
            top: shown.y + shown.height + GAP,
            minWidth: MIN_WIDTH,
            maxWidth: windowWidth - EDGE * 2,
            transformOrigin: align === "left" ? "top left" : "top right",
          },
          position,
          menuStyle,
        ]}
      >
        <View className="card card--cream-elevated gap-0.5 rounded-[18px] p-1.5">
          {options.map((option) => {
            const isSelected = option.value === selected;
            return (
              <AnimatedPressable
                key={option.value}
                onPress={() => {
                  onSelect(option.value);
                  onClose();
                }}
                scaleTo={0.98}
                accessibilityRole="menuitem"
                accessibilityState={{ selected: isSelected }}
                className={`flex-row items-center justify-between gap-4 rounded-[12px] px-3 py-2.5 ${isSelected ? "bg-orange-50" : ""}`}
              >
                <Text
                  className={
                    isSelected
                      ? "font-grotesk-bold text-[14.5px] text-orange-600"
                      : "font-grotesk-medium text-[14.5px] text-ink-cream"
                  }
                >
                  {option.label}
                </Text>
                <View className="flex-row items-center gap-2">
                  {option.count !== undefined ? (
                    <View className="rounded-full bg-cream-200 px-2 py-0.5">
                      <Text className="font-grotesk-bold text-xs text-ink-cream-muted">{option.count}</Text>
                    </View>
                  ) : null}
                  {/* Always holds its place, so the labels don't shift as the pick moves. */}
                  <View className="w-[16px] items-center">
                    {isSelected ? <Feather name="check" size={16} color={colors.orange[500]} /> : null}
                  </View>
                </View>
              </AnimatedPressable>
            );
          })}
        </View>
      </Animated.View>
    </Modal>
  );
}
