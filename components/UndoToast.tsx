import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, { FadeInDown, FadeOut, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import { UNDO_TOAST_MS, useUndoStore } from "@/store/useUndoStore";

/** Clear of the tab bar (58dp) where there is one, with a little air. */
const ABOVE_TAB_BAR = 70;
const TOAST_SHADOW = { boxShadow: "0 12px 28px -10px rgba(30, 16, 6, 0.55)" };

/**
 * "Done · Undo" at the foot of the screen, over whatever page is showing —
 * mounted once in the root layout. Goes by itself after a few seconds.
 */
export function UndoToast() {
  const t = useTranslation();
  const rtl = useRtlText();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const toast = useUndoStore((state) => state.toast);
  const undo = useUndoStore((state) => state.undo);
  const dismiss = useUndoStore((state) => state.dismiss);

  const toastId = toast?.id;
  useEffect(() => {
    if (toastId === undefined) return;
    const timer = setTimeout(() => {
      // Only this toast: a newer one keeps its own time.
      if (useUndoStore.getState().toast?.id === toastId) dismiss();
    }, UNDO_TOAST_MS);
    return () => clearTimeout(timer);
  }, [toastId, dismiss]);

  if (!toast) return null;

  return (
    <View pointerEvents="box-none" className="absolute left-0 right-0 items-center px-4" style={{ bottom: insets.bottom + ABOVE_TAB_BAR }}>
      <Animated.View
        key={toast.id}
        entering={reduceMotion ? undefined : FadeInDown.duration(220)}
        exiting={reduceMotion ? undefined : FadeOut.duration(160)}
        accessibilityLiveRegion="polite"
        className="w-full max-w-[440px] flex-row items-center gap-3 rounded-[18px] bg-charcoal-900 py-2 pl-4 pr-2"
        style={TOAST_SHADOW}
      >
        <Text numberOfLines={2} className="flex-1 font-grotesk-semibold text-sm text-ink-charcoal" style={rtl}>
          {toast.message}
        </Text>
        <AnimatedPressable
          onPress={undo}
          hitSlop={8}
          accessibilityRole="button"
          className="min-h-[40px] justify-center rounded-[12px] px-3"
        >
          <Text className="font-grotesk-bold text-sm text-orange-400">{t.undoToast.undo}</Text>
        </AnimatedPressable>
      </Animated.View>
    </View>
  );
}
