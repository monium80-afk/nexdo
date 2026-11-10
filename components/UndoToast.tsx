import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, {
  Easing,
  FadeOut,
  Keyframe,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { GemMascot } from "@/components/GemMascot";
import { TAB_BAR_HEIGHT, tabBarBottom } from "@/components/TabBar";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import { UNDO_TOAST_MS, useUndoStore } from "@/store/useUndoStore";
import { shadow } from "@/constants/shadow";

/** Clear of the floating tab bar, with a little air (Anim-TaskDone.html: 14). */
const ABOVE_TAB_BAR = 14;
const TOAST_SHADOW = shadow("0 12px 26px rgba(34, 28, 23, 0.3)", 10);
// aToast: up from 24 below, from 96 %, with the redesign's entering ease.
const TOAST_IN = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 24 }, { scale: 0.96 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }], easing: Easing.bezier(0.2, 0.8, 0.2, 1) },
}).duration(320);

/** The gem gives a little hop as the toast lands (aGemHop). */
function HoppingGem() {
  const reduceMotion = useReducedMotion();
  const hop = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    hop.set(withDelay(320, withSequence(withTiming(1, { duration: 200 }), withTiming(0, { duration: 200 }))));
  }, [hop, reduceMotion]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: -6 * hop.value }, { scale: 1 + 0.15 * hop.value }] }));
  return (
    <Animated.View style={style}>
      <GemMascot level={4} width={32} animate={false} />
    </Animated.View>
  );
}

/**
 * "Done · Undo" at the foot of the screen, over whatever page is showing —
 * mounted once in the root layout. Goes by itself after a few seconds. The
 * 2026-11 redesign's dark pill; with the gem and a second line when a task
 * done feeds today's gem ("Nice! Gem glows brighter · 3 of 6 tasks done today").
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
    <View
      pointerEvents="box-none"
      className="absolute left-0 right-0 items-center px-[16px]"
      style={{ bottom: tabBarBottom(insets.bottom) + TAB_BAR_HEIGHT + ABOVE_TAB_BAR }}
    >
      <Animated.View
        key={toast.id}
        entering={reduceMotion ? undefined : TOAST_IN}
        exiting={reduceMotion ? undefined : FadeOut.duration(160)}
        accessibilityLiveRegion="polite"
        className="min-h-[52px] w-full max-w-[440px] flex-row items-center gap-[10px] rounded-full bg-ink py-[6px] pl-[12px] pr-[7px]"
        style={TOAST_SHADOW}
      >
        {toast.gem ? <HoppingGem /> : null}
        <View className="flex-1">
          <Text numberOfLines={2} className="font-grotesk-bold text-[13px] text-paper" style={rtl}>
            {toast.message}
          </Text>
          {toast.subtitle ? (
            <Text numberOfLines={1} className="font-grotesk-regular text-[11.5px] text-[#BFB2A7]" style={rtl}>
              {toast.subtitle}
            </Text>
          ) : null}
        </View>
        <AnimatedPressable
          onPress={undo}
          hitSlop={8}
          accessibilityRole="button"
          className="h-[38px] flex-row items-center gap-[6px] rounded-full bg-paper/12 px-[13px]"
        >
          <Svg width={13} height={13} viewBox="0 0 24 24">
            <Path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" stroke="#FAF1E4" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </Svg>
          <Text className="font-grotesk-bold text-[12.5px] text-paper">{t.undoToast.undo}</Text>
        </AnimatedPressable>
      </Animated.View>
    </View>
  );
}
