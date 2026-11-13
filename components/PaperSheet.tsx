import { useEffect, useState, type ReactNode } from "react";
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { useBlurBehind } from "@/components/BlurBackdropHost";
import { useKeyboardHeight } from "@/components/BottomSheet";
import { MOTION, colors } from "@/constants/theme";

const P = colors.palette;

/**
 * The 2026-11 redesign's sheet (Settings → Account, Language): a paper panel
 * rising over the dimmed page, with a grab handle. Sits on the keyboard while
 * it's open. Tapping the dimmed page closes it.
 */
export function PaperSheet({
  visible,
  onClose,
  blur = false,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  /** Blur the page behind as well as dimming it (BlurBackdropHost; tabs only). */
  blur?: boolean;
  children: ReactNode;
}) {
  useBlurBehind(blur && visible);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      const frame = requestAnimationFrame(() => {
        setMounted(true);
        progress.set(withTiming(1, { duration: reduceMotion ? 0 : MOTION.duration.screen, easing: MOTION.easing.standard }));
      });
      return () => cancelAnimationFrame(frame);
    }
    progress.set(
      withTiming(0, { duration: reduceMotion ? 0 : MOTION.duration.screen, easing: MOTION.easing.standard }, (finished) => {
        if (finished) scheduleOnRN(setMounted, false);
      }),
    );
  }, [progress, reduceMotion, visible]);

  const veilStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - progress.value) * height }] }));
  const keyboardHeight = useKeyboardHeight(mounted);
  const keyboardOpen = keyboardHeight > 0;

  return (
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: blur ? "rgba(34, 28, 23, 0.3)" : P.veil }, veilStyle]} />
      <View style={{ flex: 1, justifyContent: "flex-end", paddingBottom: keyboardHeight }}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View
          style={[
            {
              maxHeight: keyboardOpen ? height - keyboardHeight - insets.top - 12 : "90%",
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              backgroundColor: P.paper,
              paddingTop: 10,
              paddingHorizontal: 20,
              paddingBottom: keyboardOpen ? 16 : Math.max(24, insets.bottom + 16),
            },
            panelStyle,
          ]}
        >
          <View style={{ alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: P.handle, marginBottom: 14 }} />
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}
