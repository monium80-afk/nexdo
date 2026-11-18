import { useEffect, useId, useState, type ComponentProps, type ReactNode } from "react";
import { Platform, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, ClipPath, Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop } from "react-native-svg";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { shadow } from "@/constants/shadow";
import { useRtlText } from "@/hooks/useRtlText";
import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";
import { useTranslation } from "@/hooks/useTranslation";
import type { ExtractedTaskDraft } from "@/lib/ai/types";
import { formatTaskLength } from "@/lib/formatDuration";
import { isRtlLanguage, type Translations } from "@/lib/i18n";
import { addDaysToKey, toLocalDateKey } from "@/lib/localDate";
import { computePriorityScore, PRIORITY_LEVEL_IMPORTANCE } from "@/lib/scoring";
import { useSettingsStore } from "@/store/useSettingsStore";

// The pieces every onboarding screen shares (nexdo-onboarding-final, 390 × 844
// mocks): the back button and progress bar, the title block, the bottom
// buttons, the task row, and the fade-up every screen enters with.

/** The design tokens from the handoff's README. */
export const ONB = {
  paper: "#FAF1E4",
  card: "#FCF7EF",
  ink: "#221C17",
  muted: "#7A6E64",
  faint: "#A89B90",
  orange: "#F26A2E",
  deepOrange: "#C4461A",
  softOrange: "#FCE2D2",
  line: "#E2D6C8",
  track: "#EADCCB",
  ring: "#CFC4B9",
  overdue: "#D4402A",
} as const;

/** Where each screen's progress bar stands, in flow order. */
export const ONB_PROGRESS = {
  problem: 8,
  picks: 15,
  pains: 23,
  load: 31,
  mic: 38,
  dump: 46,
  expect: 62,
  nudge: 69,
  promise: 77,
  save: 92,
} as const;

/** The handoff's entrance easing, cubic-bezier(.2,.8,.2,1). */
export const EASE_OUT = Easing.bezier(0.2, 0.8, 0.2, 1);

export const CARD_SHADOW = shadow("0 2px 10px rgba(60,35,15,0.07)", 2);
export const CTA_SHADOW = shadow("0 10px 22px rgba(242,106,46,0.28)", 6, ONB.orange);

/**
 * Android draws a view that has an elevation shadow above all its siblings,
 * whatever their order — so the text laid over a shadowed card disappeared
 * under it (01's dark row and 03's rows showed no text). A layer meant to sit
 * on top of a shadowed sibling takes a higher elevation of its own; with no
 * background it casts no shadow.
 */
export const ABOVE_SHADOW: ViewStyle = Platform.OS === "android" ? { elevation: 12 } : { zIndex: 1 };

/** Large system text: headlines and buttons grow at most this much (they'd push screens under their buttons). */
export const MAX_FONT_SCALE = 1.2;

/**
 * The space under a screen's bottom buttons: the home indicator / nav bar
 * (at least 20), plus 16 to lift the buttons a little off it (asked
 * 2026-11-12, for every screen).
 */
export function footerBottom(insetBottom: number): number {
  return Math.max(insetBottom, 20) + 16;
}

/** Arabic: the onboarding layout mirrors (the app itself only right-aligns text). */
export function useIsRtl(): boolean {
  return isRtlLanguage(useSettingsStore((state) => state.language));
}

/** A row that runs right to left in Arabic. */
export function rowDirection(rtl: boolean): ViewStyle {
  return { flexDirection: rtl ? "row-reverse" : "row" };
}

/** An arrow or chevron drawn for left to right, turned round in Arabic. */
export function flipX(rtl: boolean): ViewStyle | undefined {
  return rtl ? { transform: [{ scaleX: -1 }] } : undefined;
}

/** An SVG gradient id unique to this instance (two screens can be mounted at once). */
export function useSvgId(prefix: string): string {
  return `${prefix}${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
}

/**
 * A drawing made for the 390 × 844 mock, shrunk to the room it actually has:
 * it takes `flex: 1` (or `style`), measures itself and scales its child —
 * laid out at `width` × `height` — down until it fits, never up. Phones
 * shorter or narrower than the mock (360 × 740 dp, larger system text) would
 * otherwise push the bottom of a screen under its buttons.
 */
export function FitBox({
  width,
  height,
  align = "center",
  natural = false,
  onScale,
  style,
  children,
}: {
  width: number;
  height: number;
  align?: "top" | "center";
  /** Keep its own height when there's room (what follows stays right under it); shrink only when there isn't. */
  natural?: boolean;
  /** Told the scale it settles on (to line other things up with the drawing). */
  onScale?: (scale: number) => void;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const [room, setRoom] = useState<{ w: number; h: number } | null>(null);
  const scale = room ? Math.max(0.5, Math.min(1, room.w / width, room.h / height)) : 1;
  return (
    <View
      style={[
        natural ? { flexGrow: 0, flexShrink: 1, flexBasis: height } : { flex: 1 },
        { minHeight: 0, alignItems: "center", justifyContent: align === "top" ? "flex-start" : "center" },
        style,
      ]}
      onLayout={(event) => {
        const { width: w, height: h } = event.nativeEvent.layout;
        onScale?.(Math.max(0.5, Math.min(1, w / width, h / height)));
        setRoom((current) => (current && Math.abs(current.w - w) < 1 && Math.abs(current.h - h) < 1 ? current : { w, h }));
      }}
    >
      <View style={{ width: width * scale, height: height * scale, opacity: room ? 1 : 0 }}>
        <View style={{ width, height, transformOrigin: "top left", transform: [{ scale }] }}>{children}</View>
      </View>
    </View>
  );
}

const FADE_UP_DONE: ViewStyle = { opacity: 1, transform: [{ translateY: 0 }] };

/**
 * The 0.55 s fade-up (the mocks' `vIn`), after `delay` ms. Once it should be
 * over, React draws it fully shown, so content never stays hidden if the
 * animation didn't run. Reduced motion: simply there.
 */
export function FadeUp({ delay = 0, style, children }: { delay?: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(reduceMotion ? 1 : 0);
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (reduceMotion) return;
    progress.value = withDelay(delay, withTiming(1, { duration: 550, easing: EASE_OUT }));
    const timer = setTimeout(() => setOver(true), delay + 700);
    return () => clearTimeout(timer);
  }, [delay, progress, reduceMotion]);
  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 14 }],
  }));
  return <Animated.View style={[style, over || reduceMotion ? FADE_UP_DONE : animated]}>{children}</Animated.View>;
}

/** The back arrow: a bare arrow (no circle around it, asked 2026-11-13) in a 40-wide tap area. */
export function BackButton({ onPress }: { onPress: () => void }) {
  const t = useTranslation();
  const rtl = useIsRtl();
  return (
    <AnimatedPressable
      onPress={onPress}
      scaleTo={0.92}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={t.onboardingFlow.back}
      className="h-10 w-10 items-center justify-center"
    >
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={ONB.ink} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" style={flipX(rtl)}>
        <Path d="M15 5l-7 7 7 7" />
      </Svg>
    </AnimatedPressable>
  );
}

/** Room kept on each side of the progress bar (the mock's 40-px button plus two 14-px gaps), so it sits centred. */
const HEADER_SIDE = 68;
/** The space between the back arrow's tap area and the bar. */
const ARROW_GAP = 8;

/**
 * The progress bar, centred, with the back arrow just left of it. The bar is
 * a little shorter and thicker than the mock's; the arrow sits closer to it
 * than the mock's round button did (asked 2026-11-13), the bar staying centred.
 */
export function ProgressHeader({ percent, onBack }: { percent?: number; onBack?: () => void }) {
  const t = useTranslation();
  const rtl = useIsRtl();
  return (
    <View className="h-10 items-center" style={rowDirection(rtl)}>
      <View style={{ width: HEADER_SIDE, alignItems: rtl ? "flex-start" : "flex-end" }}>
        {onBack ? (
          <View style={rtl ? { marginLeft: ARROW_GAP } : { marginRight: ARROW_GAP }}>
            <BackButton onPress={onBack} />
          </View>
        ) : null}
      </View>
      {percent !== undefined ? (
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={t.onboardingFlow.progress}
          accessibilityValue={{ min: 0, max: 100, now: percent }}
          className="h-[7px] flex-1 overflow-hidden rounded-[3.5px] bg-[#EADCCB]"
        >
          <View className="h-full rounded-[3.5px] bg-[#F26A2E]" style={{ width: `${percent}%`, alignSelf: rtl ? "flex-end" : "flex-start" }} />
        </View>
      ) : (
        <View className="flex-1" />
      )}
      <View style={{ width: HEADER_SIDE }} />
    </View>
  );
}

/**
 * One onboarding screen: paper background, the header at the mock's 54 px
 * (7 under the status bar), the content from 118, and the footer resting on
 * the home indicator. `header={false}` for the screens that draw their own.
 */
export function OnboardingScreen({
  percent,
  onBack,
  header = true,
  footer,
  footerGap = 6,
  background = ONB.paper,
  children,
}: {
  percent?: number;
  onBack?: () => void;
  header?: boolean;
  footer?: ReactNode;
  footerGap?: number;
  background?: string;
  children: ReactNode;
}) {
  useStatusBarStyle("dark");
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: background }}>
      {header ? (
        <View style={{ marginTop: insets.top + 7, paddingHorizontal: 20 }}>
          <ProgressHeader percent={percent} onBack={onBack} />
        </View>
      ) : null}
      <View style={{ flex: 1, marginTop: header ? 24 : insets.top, paddingHorizontal: 20 }}>{children}</View>
      {footer ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: footerBottom(insets.bottom), gap: footerGap }}>{footer}</View>
      ) : null}
    </View>
  );
}

/**
 * The title block: an optional Space Mono eyebrow, the 28 px headline (the
 * mock's 30, a little smaller as asked 2026-11-12, and the size every
 * onboarding headline uses) (a
 * second part in orange, as on 02 and 03) and the 16 px line under it.
 */
export function OnboardingTitle({
  eyebrow,
  title,
  highlight,
  body,
  delay = 0,
  center = false,
}: {
  eyebrow?: string;
  title: string;
  highlight?: string;
  body?: string;
  delay?: number;
  center?: boolean;
}) {
  const rtl = useRtlText();
  const align: TextStyle | undefined = center ? { textAlign: "center" } : rtl;
  return (
    <FadeUp delay={delay} style={{ gap: 10, paddingHorizontal: 4 }}>
      {eyebrow ? <Eyebrow style={align}>{eyebrow}</Eyebrow> : null}
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="font-grotesk-bold text-[28px] leading-[31px] tracking-[-0.7px] text-[#221C17]" style={align}>
        {title}
        {highlight ? <Text className="text-[#F26A2E]">{highlight}</Text> : null}
      </Text>
      {body ? (
        <Text className="font-grotesk-regular text-[16px] leading-[23px] text-[#7A6E64]" style={align}>
          {body}
        </Text>
      ) : null}
    </FadeUp>
  );
}

/** Space Mono 700, small caps-style label ("TRY IT", "FROM WHAT YOU SAID"). */
export function Eyebrow({ children, color = ONB.deepOrange, size = 11, style }: { children: ReactNode; color?: string; size?: number; style?: StyleProp<TextStyle> }) {
  return (
    <Text className="font-mono-bold" style={[{ fontSize: size, letterSpacing: size * 0.12, color }, style]}>
      {children}
    </Text>
  );
}

/** The orange 50 px call to action with its arrow. */
export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  arrow = true,
  dark = false,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  arrow?: boolean;
  /** The paywall's ink button. */
  dark?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const rtl = useIsRtl();
  // 50 high with a 16 px label: a little smaller than the mock's 56 / 17 (asked 2026-11-12, every screen).
  const height = 50;
  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      scaleTo={0.97}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[
        { height, borderRadius: height / 2, backgroundColor: dark ? ONB.ink : ONB.orange, opacity: disabled ? 0.6 : 1 },
        dark ? null : CTA_SHADOW,
        rowDirection(rtl),
        style,
      ]}
      className="items-center justify-center gap-2"
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1} className="font-grotesk-bold text-white" style={{ fontSize: 16 }}>
        {label}
      </Text>
      {arrow ? (
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" style={flipX(rtl)}>
          <Path d="M5 12h14M13 6l6 6-6 6" />
        </Svg>
      ) : null}
    </AnimatedPressable>
  );
}

/** The quiet 44 px text button under a call to action ("Not now", "I'd rather type"). `textStyle` may be animated. */
export function TextButton({
  label,
  onPress,
  color = ONB.muted,
  disabled = false,
  textStyle,
}: {
  label: string;
  onPress: () => void;
  color?: string;
  disabled?: boolean;
  /** May be an animated style (the hook's link darkens as the screen clears). */
  textStyle?: ComponentProps<typeof Animated.Text>["style"];
}) {
  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      scaleTo={0.97}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-11 items-center justify-center"
    >
      <Animated.Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1} style={[{ fontSize: 15, fontFamily: "SpaceGrotesk-SemiBold", color }, textStyle]}>
        {label}
      </Animated.Text>
    </AnimatedPressable>
  );
}

/** The score chip: a small orange diamond and the number, on peach. */
export function ScorePill({ score, onDark = false }: { score: number | string; onDark?: boolean }) {
  return (
    <View className="h-6 flex-row items-center gap-1.5 rounded-xl px-[9px]" style={{ backgroundColor: onDark ? "#FAF1E4" : ONB.softOrange }}>
      <View style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: ONB.orange, transform: [{ rotate: "45deg" }] }} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="font-grotesk-bold text-[12px] text-[#221C17]">
        {score}
      </Text>
    </View>
  );
}

/**
 * A task as the Tasks page shows it: open circle, title, a line under it
 * (when it's due · how long), and its score. `metaColor` for the top task.
 */
export function TaskRow({
  title,
  meta,
  score,
  metaColor = ONB.muted,
  style,
}: {
  title: string;
  meta?: string;
  score?: number;
  metaColor?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const rtl = useRtlText();
  const mirrored = useIsRtl();
  return (
    <View
      className="h-[58px] items-center gap-3 rounded-[18px] px-[15px]"
      style={[{ backgroundColor: ONB.card }, CARD_SHADOW, rowDirection(mirrored), style]}
    >
      <View className="h-6 w-6 rounded-full border-2 border-[#CFC4B9]" />
      <View className="flex-1 gap-0.5">
        <Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE} className="font-grotesk-semibold text-[15.5px] text-[#221C17]" style={rtl}>
          {title}
        </Text>
        {meta ? (
          <Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE} className="text-[13px]" style={[{ color: metaColor, fontFamily: metaColor === ONB.muted ? "SpaceGrotesk-Regular" : "SpaceGrotesk-SemiBold" }, rtl]}>
            {meta}
          </Text>
        ) : null}
      </View>
      {score !== undefined ? <ScorePill score={score} /> : null}
    </View>
  );
}

/** The calendar in a task's line (02, 03), as drawn in the mocks. */
export function CalendarIcon({ size = 14, color = ONB.muted }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={3.5} y={5} width={17} height={15} rx={3.5} />
      <Path d="M3.5 10h17M8 3v4M16 3v4" />
    </Svg>
  );
}

/** The clock in a task's line (03). */
export function ClockIcon({ size = 14, color = ONB.muted }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx={12} cy={12} r={8.5} />
      <Path d="M12 7.5V12l3 2" />
    </Svg>
  );
}

/**
 * The top and bottom of a scrolling list fading into the paper (the mocks'
 * CSS mask): `top` and `bottom` are the faded heights, in px.
 */
export function PaperFade({ top = 0, bottom = 0, color = ONB.paper }: { top?: number; bottom?: number; color?: string }) {
  const id = useSvgId("fade");
  return (
    <>
      {top > 0 ? (
        <Svg pointerEvents="none" width="100%" height={top} style={{ position: "absolute", left: 0, right: 0, top: 0 }}>
          <Defs>
            <LinearGradient id={`${id}t`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity={1} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height={top} fill={`url(#${id}t)`} />
        </Svg>
      ) : null}
      {bottom > 0 ? (
        <Svg pointerEvents="none" width="100%" height={bottom} style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
          <Defs>
            <LinearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity={0} />
              {/* Fully paper for the last few px, so no card edge peeks out at the foot. */}
              <Stop offset="0.96" stopColor={color} stopOpacity={1} />
              <Stop offset="1" stopColor={color} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height={bottom} fill={`url(#${id}b)`} />
        </Svg>
      ) : null}
    </>
  );
}

/** A found task's line: "Tomorrow · 1 hour", "Fri, Nov 14, 6:00 PM · 30 mins". */
export function draftLine(draft: ExtractedTaskDraft, now: Date, t: Translations): string {
  const copy = t.onboardingFlow;
  let day = copy.noDate;
  if (draft.dueDate) {
    const due = new Date(draft.dueDate);
    const key = toLocalDateKey(due);
    const today = toLocalDateKey(now);
    day =
      key === today
        ? copy.today
        : key === addDaysToKey(today, 1)
          ? copy.tomorrow
          : due.toLocaleDateString(t.locale, { weekday: "short", month: "short", day: "numeric" });
    if (draft.dueHasTime) day += `, ${due.toLocaleTimeString(t.locale, { hour: "numeric", minute: "2-digit" })}`;
  }
  return `${day} · ${formatTaskLength(draft.estimatedMinutes)}`;
}

/** A found task's score, exactly as the saved task will have it. */
export function draftScore(draft: ExtractedTaskDraft, now: Date): number {
  return Math.round(
    computePriorityScore({ dueDate: draft.dueDate, estimatedMinutes: draft.estimatedMinutes, importance: PRIORITY_LEVEL_IMPORTANCE[draft.priorityLevel] }, now),
  );
}

/**
 * The gem without a face — the mocks' small gem on 09 and in 10's
 * notification: four lit facets, a soft halo and a bright core.
 */
export function PlainGem({ width, halo = true }: { width: number; halo?: boolean }) {
  const id = useSvgId("gem");
  return (
    <Svg width={width} height={(width * 220) / 200} viewBox="0 0 200 220" style={{ overflow: "visible" }}>
      <Defs>
        <ClipPath id={`${id}clip`}>
          <Rect x={-44} y={-44} width={88} height={88} rx={25} transform="translate(100 140) rotate(45)" />
        </ClipPath>
        <LinearGradient id={`${id}tl`} gradientUnits="userSpaceOnUse" x1="0" y1="72" x2="0" y2="140">
          <Stop offset="0" stopColor="#FFC08E" />
          <Stop offset="1" stopColor="#FF9152" />
        </LinearGradient>
        <LinearGradient id={`${id}tr`} gradientUnits="userSpaceOnUse" x1="0" y1="72" x2="0" y2="140">
          <Stop offset="0" stopColor="#FF9A5A" />
          <Stop offset="1" stopColor="#F2692A" />
        </LinearGradient>
        <LinearGradient id={`${id}bl`} gradientUnits="userSpaceOnUse" x1="0" y1="134" x2="0" y2="208">
          <Stop offset="0" stopColor="#F6773A" />
          <Stop offset="1" stopColor="#DC5016" />
        </LinearGradient>
        <LinearGradient id={`${id}br`} gradientUnits="userSpaceOnUse" x1="0" y1="134" x2="0" y2="208">
          <Stop offset="0" stopColor="#E95F21" />
          <Stop offset="1" stopColor="#BE3A08" />
        </LinearGradient>
        <RadialGradient id={`${id}halo`} cx="0.5" cy="0.5" r="0.5">
          <Stop offset="0" stopColor="#FFE9A8" stopOpacity={0.9} />
          <Stop offset="1" stopColor="#FFE9A8" stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id={`${id}core`} cx="0.5" cy="0.5" r="0.5">
          <Stop offset="0" stopColor="#FFF8DC" stopOpacity={0.8} />
          <Stop offset="0.4" stopColor="#FFDD80" stopOpacity={0.6} />
          <Stop offset="1" stopColor="#FFB547" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      {halo ? <Circle cx={100} cy={140} r={86} fill={`url(#${id}halo)`} /> : null}
      <G clipPath={`url(#${id}clip)`}>
        <Path d="M96 134 L28 140 L100 68 Z" fill={`url(#${id}tl)`} />
        <Path d="M96 134 L100 68 L172 140 Z" fill={`url(#${id}tr)`} />
        <Path d="M96 134 L172 140 L100 212 Z" fill={`url(#${id}br)`} />
        <Path d="M96 134 L100 212 L28 140 Z" fill={`url(#${id}bl)`} />
        <Circle cx={98} cy={138} r={32} fill={`url(#${id}core)`} />
      </G>
    </Svg>
  );
}

/** A small round check (09's outcomes): peach disc, deep-orange tick. */
export function CheckDot({ size = 22 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: ONB.softOrange, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" stroke={ONB.deepOrange} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M5 12.5l4.5 4.5L19 7.5" />
      </Svg>
    </View>
  );
}
