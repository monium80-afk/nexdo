import * as Haptics from "expo-haptics";
import { useEffect, useRef, type ReactNode } from "react";
import { Platform, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/useTranslation";
import { shadow } from "@/constants/shadow";

const P = colors.palette;

// The mockups' line icons (addtask-design/*.html), on a 24 × 24 grid.
const ICONS = {
  calendar: [
    { rect: { x: 3.5, y: 5, width: 17, height: 15, rx: 3.5 } },
    { d: "M3.5 10h17M8 3v4M16 3v4" },
  ],
  clock: [{ circle: { cx: 12, cy: 12, r: 8.5 } }, { d: "M12 7.5V12l3 2" }],
  repeat: [{ d: "M17 2.5l3 3-3 3" }, { d: "M4 11.5v-1a5 5 0 0 1 5-5h11" }, { d: "M7 21.5l-3-3 3-3" }, { d: "M20 12.5v1a5 5 0 0 1-5 5H4" }],
  flag: [{ d: "M5 21V4h11l-2 4 2 4H5" }],
  chevronRight: [{ d: "M9 5l7 7-7 7" }],
  chevronLeft: [{ d: "M15 5l-7 7 7 7" }],
  chevronDown: [{ d: "M6 9l6 6 6-6" }],
  plus: [{ d: "M12 5v14M5 12h14" }],
  close: [{ d: "M6 6l12 12M18 6L6 18" }],
  arrowUp: [{ d: "M12 19V5M6 11l6-6 6 6" }],
  check: [{ d: "M5 12.5l4.5 4.5L19 7.5" }],
  camera: [{ d: "M4 8h3l2-3h6l2 3h3v11H4z" }, { circle: { cx: 12, cy: 13, r: 3.5 } }],
  image: [
    { rect: { x: 3.5, y: 4.5, width: 17, height: 15, rx: 3 } },
    { circle: { cx: 9, cy: 10, r: 1.8 } },
    { d: "M20.5 16l-5-5L6 19.5" },
  ],
  file: [{ d: "M6 3h8l4 4v14H6z" }, { d: "M14 3v4h4M9 13h6M9 17h6" }],
  lock: [{ rect: { x: 5, y: 11, width: 14, height: 10, rx: 2.5 } }, { d: "M8 11V8a4 4 0 0 1 8 0v3" }],
} as const;

export type SheetIconName = keyof typeof ICONS;

export function SheetIcon({ name, size, color, strokeWidth = 2 }: { name: SheetIconName; size: number; color: string; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name].map((part, index) =>
        "d" in part ? (
          <Path key={index} d={part.d} />
        ) : "rect" in part ? (
          <Rect key={index} {...part.rect} />
        ) : (
          <Circle key={index} {...part.circle} />
        ),
      )}
    </Svg>
  );
}

/** The orange on/off switch (48 × 28). */
export function Toggle({ value, onChange, accessibilityLabel }: { value: boolean; onChange: (next: boolean) => void; accessibilityLabel: string }) {
  const reduceMotion = useReducedMotion();
  const on = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    on.set(withTiming(value ? 1 : 0, { duration: reduceMotion ? 0 : 160 }));
  }, [on, reduceMotion, value]);
  const knobStyle = useAnimatedStyle(() => ({ transform: [{ translateX: 20 * on.value }] }));
  const trackStyle = useAnimatedStyle(() => ({ opacity: on.value }));
  return (
    <AnimatedPressable
      onPress={() => onChange(!value)}
      scaleTo={0.95}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={accessibilityLabel}
      style={{ width: 48, height: 28, borderRadius: 14, padding: 3, backgroundColor: P.line }}
    >
      <Animated.View style={[{ position: "absolute", left: 0, top: 0, width: 48, height: 28, borderRadius: 14, backgroundColor: P.accent }, trackStyle]} />
      <Animated.View
        style={[{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#FFFFFF" }, shadow("0 1px 3px rgba(0, 0, 0, 0.18)", 2, "#000000"), knobStyle]}
      />
    </AnimatedPressable>
  );
}

/** A row of options in a chip-coloured track; the picked one is dark. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  width,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (next: T) => void;
  width?: number;
}) {
  return (
    <View style={{ flexDirection: "row", padding: 3, borderRadius: 18, backgroundColor: P.chip, width }} accessibilityRole="radiogroup">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <AnimatedPressable
            key={option.value}
            onPress={() => onChange(option.value)}
            scaleTo={0.96}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={{
              flex: 1,
              height: 30,
              paddingHorizontal: 6,
              borderRadius: 15,
              backgroundColor: selected ? P.ink : "transparent",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              style={{ fontFamily: "SpaceGrotesk-SemiBold", fontSize: 13.5, color: selected ? "#FFFFFF" : P.ink }}
            >
              {option.label}
            </Text>
          </AnimatedPressable>
        );
      })}
    </View>
  );
}

/** A detail's own screen: "‹ Details" back, its name in the middle, a dark Done. */
export function DetailHeader({ title, onBack, onDone }: { title: string; onBack: () => void; onDone: () => void }) {
  const t = useTranslation();
  return (
    <View style={{ height: 32, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <AnimatedPressable
        onPress={onBack}
        scaleTo={0.96}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t.addSheet.details}
        style={{ flexDirection: "row", alignItems: "center", gap: 2, zIndex: 1 }}
      >
        <SheetIcon name="chevronLeft" size={18} color={P.inkMuted} strokeWidth={2.2} />
        <Text style={{ fontFamily: "SpaceGrotesk-SemiBold", fontSize: 14.5, color: P.inkMuted }}>{t.addSheet.details}</Text>
      </AnimatedPressable>
      <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, alignItems: "center" }}>
        <Text accessibilityRole="header" style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 16, color: P.ink }}>
          {title}
        </Text>
      </View>
      <AnimatedPressable
        onPress={onDone}
        scaleTo={0.95}
        accessibilityRole="button"
        style={{ height: 32, paddingHorizontal: 14, borderRadius: 16, backgroundColor: P.ink, justifyContent: "center", zIndex: 1 }}
      >
        <Text style={{ fontFamily: "SpaceGrotesk-SemiBold", fontSize: 13.5, color: "#FFFFFF" }}>{t.common.done}</Text>
      </AnimatedPressable>
    </View>
  );
}

/** Priority as diamonds: `filled` of three orange, the rest light. */
export function Diamonds({ filled, size = 10, gap = 6 }: { filled: number; size?: number; gap?: number }) {
  return (
    <View style={{ flexDirection: "row", gap }}>
      {[0, 1, 2].map((index) => (
        <View
          key={index}
          style={{ width: size, height: size, borderRadius: 2, transform: [{ rotate: "45deg" }], backgroundColor: index < filled ? P.accent : P.line }}
        />
      ))}
    </View>
  );
}

// The scrolling wheels (date and repeat time, duration): rows 42 tall, five
// showing, the middle one picked — big and bold, the others smaller and fainter.
export const WHEEL_ROW = 42;
export const WHEEL_HEIGHT = WHEEL_ROW * 5;

function WheelRow({ label, index, offset, onPress }: { label: string; index: number; offset: SharedValue<number>; onPress: () => void }) {
  // How many rows from the middle: 0 picked, 1 next to it, 2 at the edge.
  const boldStyle = useAnimatedStyle(() => {
    const away = Math.abs(offset.value / WHEEL_ROW - index);
    return {
      opacity: interpolate(away, [0, 0.6], [1, 0], Extrapolation.CLAMP),
      transform: [{ scale: interpolate(away, [0, 1, 2], [1, 22 / 30, 18 / 30], Extrapolation.CLAMP) }],
    };
  });
  const lightStyle = useAnimatedStyle(() => {
    const away = Math.abs(offset.value / WHEEL_ROW - index);
    return {
      opacity: interpolate(away, [0, 0.6, 1, 2], [0, 0.42, 0.42, 0.16], Extrapolation.CLAMP),
      transform: [{ scale: interpolate(away, [0, 1, 2], [1, 22 / 30, 18 / 30], Extrapolation.CLAMP) }],
    };
  });
  const text = { fontSize: 30, color: P.ink, includeFontPadding: false } as const;
  return (
    <AnimatedPressable onPress={onPress} scaleTo={1} accessible={false} style={{ height: WHEEL_ROW, alignItems: "center", justifyContent: "center" }}>
      <Animated.Text style={[text, { fontFamily: "SpaceGrotesk-Medium", position: "absolute" }, lightStyle]}>{label}</Animated.Text>
      <Animated.Text style={[text, { fontFamily: "SpaceGrotesk-Bold" }, boldStyle]}>{label}</Animated.Text>
    </AnimatedPressable>
  );
}

/**
 * One column of a wheel. Scrolls and snaps a row at a time; tapping a row
 * scrolls it to the middle. `index` can change from outside (a shortcut), and
 * the wheel follows it.
 */
export function Wheel({
  items,
  index,
  onChange,
  width,
  accessibilityLabel,
}: {
  items: string[];
  index: number;
  onChange: (index: number) => void;
  width: number;
  accessibilityLabel: string;
}) {
  const reduceMotion = useReducedMotion();
  const ref = useAnimatedRef<Animated.ScrollView>();
  const offset = useSharedValue(index * WHEEL_ROW);
  const reported = useRef(index);
  const placed = useRef(false);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      offset.set(event.contentOffset.y);
    },
  });

  useEffect(() => {
    if (index === reported.current) return;
    reported.current = index;
    ref.current?.scrollTo({ y: index * WHEEL_ROW, animated: !reduceMotion });
  }, [index, reduceMotion, ref]);

  const settle = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.min(items.length - 1, Math.max(0, Math.round(event.nativeEvent.contentOffset.y / WHEEL_ROW)));
    if (next === reported.current) return;
    reported.current = next;
    Haptics.selectionAsync().catch(() => {});
    onChange(next);
  };

  const step = (by: 1 | -1) => {
    const next = Math.min(items.length - 1, Math.max(0, index + by));
    if (next !== index) onChange(next);
  };

  return (
    <View
      style={{ width, height: WHEEL_HEIGHT }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ text: items[index] }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) => step(event.nativeEvent.actionName === "increment" ? 1 : -1)}
    >
      <Animated.ScrollView
        ref={ref}
        onScroll={onScroll}
        scrollEventThrottle={16}
        snapToInterval={WHEEL_ROW}
        decelerationRate="fast"
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingVertical: WHEEL_ROW * 2 }}
        onLayout={() => {
          // Android ignores contentOffset: put the picked row in the middle once laid out.
          if (placed.current) return;
          placed.current = true;
          ref.current?.scrollTo({ y: index * WHEEL_ROW, animated: false });
        }}
        contentOffset={Platform.OS === "ios" ? { x: 0, y: index * WHEEL_ROW } : undefined}
        onMomentumScrollEnd={settle}
        onScrollEndDrag={settle}
      >
        {items.map((label, row) => (
          <WheelRow
            key={`${label}-${row}`}
            label={label}
            index={row}
            offset={offset}
            onPress={() => ref.current?.scrollTo({ y: row * WHEEL_ROW, animated: !reduceMotion })}
          />
        ))}
      </Animated.ScrollView>
    </View>
  );
}

/** The light band behind a wheel's middle row, across the whole card. */
export function WheelFrame({ children }: { children: ReactNode }) {
  return (
    <View style={{ height: WHEEL_HEIGHT, justifyContent: "center", overflow: "hidden" }}>
      <View
        pointerEvents="none"
        style={{ position: "absolute", left: 0, right: 0, top: WHEEL_ROW * 2, height: WHEEL_ROW, borderRadius: 14, backgroundColor: P.chip }}
      />
      <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center" }}>{children}</View>
    </View>
  );
}

/** A unit after a wheel ("h", "min"), centred on its height. */
export function WheelUnit({ label }: { label: string }) {
  return <Text style={{ fontFamily: "SpaceGrotesk-SemiBold", fontSize: 15, color: P.inkMuted, marginRight: 10 }}>{label}</Text>;
}
