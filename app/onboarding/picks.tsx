import { useRouter } from "expo-router";
import { Text, useWindowDimensions, View } from "react-native";
import Animated, { Easing } from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import {
  ABOVE_SHADOW,
  CalendarIcon,
  CARD_SHADOW,
  ClockIcon,
  FadeUp,
  FitBox,
  ONB,
  ONB_PROGRESS,
  OnboardingScreen,
  OnboardingTitle,
  PrimaryButton,
  rowDirection,
  useIsRtl,
  useSvgId,
} from "@/components/onboarding/OnboardingKit";
import { at, CSS_EASE, CSS_EASE_IN_OUT, kf, useTimeline, useTimelineStyle, type Timeline } from "@/components/onboarding/timeline";
import { shadow } from "@/constants/shadow";
import { useTranslation } from "@/hooks/useTranslation";

// 03 · Nexdo picks what comes first (screens/03-…html, an 8 s loop): four
// unsorted rows, a scan line sweeps down, each "···" turns into its score,
// the rows re-order by score and the winner turns dark. Plays once, holds.
//
// Only opacity and transforms animate. The winner's ink-to-cream text is two
// copies of its content cross-fading, and every text layer sits above the
// cards' shadows (ABOVE_SHADOW) — on Android a shadowed card otherwise
// covered its own text, and the rows showed up empty.

const LOOP = 8;
const END = at(64, LOOP);
const MOVE_EASE = Easing.bezierFn(0.6, 0, 0.2, 1);
const ROW_GAP = 78;
const ROW_HEIGHT = 68;
/** The score chip's width, kept free at the end of the text layers. */
const CHIP_WIDTH = 52;
const FILL = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } as const;

type Row = { title: string; due: string; minutes?: number; score: number; moveTo: number };

/** Ring, title and the "when · how long" line, in ink or (the winner, once dark) in cream. */
function RowText({ row, onDark }: { row: Row; onDark: boolean }) {
  const t = useTranslation();
  const rtl = useIsRtl();
  const color = onDark ? ONB.paper : ONB.ink;
  return (
    <View style={[FILL, { paddingLeft: rtl ? 14 : 16, paddingRight: rtl ? 16 : 14, alignItems: "center", gap: 12 }, rowDirection(rtl)]}>
      <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: ONB.ring }} />
      <View style={{ flex: 1, gap: 4, alignItems: rtl ? "flex-end" : "flex-start" }}>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ fontSize: 16.5, fontFamily: "SpaceGrotesk-SemiBold", color }}>
          {row.title}
        </Text>
        <View style={[{ alignItems: "center", gap: 12, opacity: 0.7 }, rowDirection(rtl)]}>
          <View style={[{ alignItems: "center", gap: 5 }, rowDirection(rtl)]}>
            <CalendarIcon color={color} />
            <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ fontSize: 13.5, fontFamily: "SpaceGrotesk-Regular", color }}>
              {row.due}
            </Text>
          </View>
          {row.minutes ? (
            <View style={[{ alignItems: "center", gap: 5 }, rowDirection(rtl)]}>
              <ClockIcon color={color} />
              <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ fontSize: 13.5, fontFamily: "SpaceGrotesk-Regular", color }}>
                {t.onboardingFlow.picks.minutes(row.minutes)}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      <View style={{ width: CHIP_WIDTH }} />
    </View>
  );
}

function PickRow({ timeline, row, index, winner }: { timeline: Timeline; row: Row; index: number; winner: boolean }) {
  const rtl = useIsRtl();
  const moveStyle = useTimelineStyle(timeline, (t) => {
    "worklet";
    return { transform: [{ translateY: kf(t, [[at(42, LOOP), 0], [at(56, LOOP), row.moveTo]], MOVE_EASE) }] };
  });
  const darkStyle = useTimelineStyle(timeline, (t) => {
    "worklet";
    return { opacity: kf(t, [[at(58, LOOP), 0], [at(64, LOOP), 1]], CSS_EASE) };
  });
  const lightTextStyle = useTimelineStyle(timeline, (t) => {
    "worklet";
    return { opacity: winner ? 1 - kf(t, [[at(58, LOOP), 0], [at(64, LOOP), 1]], CSS_EASE) : 1 };
  });
  const dotsStyle = useTimelineStyle(timeline, (t) => {
    "worklet";
    return { opacity: kf(t, [[at(14 + 6 * index, LOOP), 1], [at(17 + 6 * index, LOOP), 0]], CSS_EASE) };
  });
  const scoreStyle = useTimelineStyle(timeline, (t) => {
    "worklet";
    const p = kf(t, [[at(14 + 6 * index, LOOP), 0], [at(18 + 6 * index, LOOP), 1]], CSS_EASE);
    return { opacity: p, transform: [{ scale: 0.6 + 0.4 * p }] };
  });

  return (
    <Animated.View style={[{ position: "absolute", left: 0, right: 0, top: ROW_GAP * index, height: ROW_HEIGHT }, moveStyle]}>
      <View style={[FILL, { borderRadius: 18, backgroundColor: ONB.card }, CARD_SHADOW]} />
      {winner ? <Animated.View style={[FILL, { borderRadius: 18, backgroundColor: ONB.ink }, shadow("0 14px 28px rgba(34,28,23,0.25)", 8, ONB.ink), darkStyle]} /> : null}

      <Animated.View style={[FILL, ABOVE_SHADOW, lightTextStyle]}>
        <RowText row={row} onDark={false} />
      </Animated.View>
      {winner ? (
        <Animated.View style={[FILL, ABOVE_SHADOW, darkStyle]}>
          <RowText row={row} onDark />
        </Animated.View>
      ) : null}

      {/* The score chip: "···" until the scan reaches the row, then the number. */}
      <View style={[FILL, ABOVE_SHADOW, { paddingLeft: rtl ? 14 : 16, paddingRight: rtl ? 16 : 14, alignItems: "center", justifyContent: "flex-end" }, rowDirection(rtl)]}>
        <View style={{ height: 26, minWidth: CHIP_WIDTH, paddingHorizontal: 10, borderRadius: 13, backgroundColor: ONB.softOrange, alignItems: "center", justifyContent: "center" }}>
          <Animated.Text maxFontSizeMultiplier={1.2} style={[{ fontSize: 12.5, fontFamily: "SpaceGrotesk-Bold", color: ONB.ink }, dotsStyle]}>
            ···
          </Animated.Text>
          <Animated.View style={[FILL, { alignItems: "center", justifyContent: "center", gap: 6 }, rowDirection(rtl), scoreStyle]}>
            <View style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: ONB.orange, transform: [{ rotate: "45deg" }] }} />
            <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 12.5, fontFamily: "SpaceGrotesk-Bold", color: ONB.ink }}>
              {row.score}
            </Text>
          </Animated.View>
        </View>
      </View>
    </Animated.View>
  );
}

function ScanLine({ timeline }: { timeline: Timeline }) {
  const id = useSvgId("scan");
  const style = useTimelineStyle(timeline, (t) => {
    "worklet";
    return {
      opacity: kf(t, [[at(10, LOOP), 0], [at(12, LOOP), 1], [at(36, LOOP), 1], [at(40, LOOP), 0]], CSS_EASE_IN_OUT),
      transform: [{ translateY: kf(t, [[at(10, LOOP), -10], [at(36, LOOP), 312]], CSS_EASE_IN_OUT) }],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: "absolute", left: -6, right: -6, top: 0, height: 3, zIndex: 3, borderRadius: 2 }, shadow("0 0 16px rgba(242,106,46,0.7)", 0, ONB.orange), ABOVE_SHADOW, style]}
    >
      <Svg width="100%" height={3}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={ONB.orange} stopOpacity={0} />
            <Stop offset="0.5" stopColor={ONB.orange} stopOpacity={1} />
            <Stop offset="1" stopColor={ONB.orange} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height={3} rx={1.5} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

export default function OnboardingPicks() {
  const t = useTranslation();
  const copy = t.onboardingFlow.picks;
  const router = useRouter();
  const timeline = useTimeline(END);
  const rowsWidth = useWindowDimensions().width - 40;

  // Their places before (top to bottom) and how far each moves once scored.
  const rows: Row[] = [
    { title: copy.gym[0], due: copy.gym[1], score: 30, moveTo: 234 },
    { title: copy.reply[0], due: copy.reply[1], score: 61, moveTo: 0 },
    { title: copy.lab[0], due: copy.lab[1], minutes: 20, score: 88, moveTo: -156 },
    { title: copy.dentist[0], due: copy.dentist[1], score: 44, moveTo: -78 },
  ];

  return (
    <OnboardingScreen
      percent={ONB_PROGRESS.picks}
      onBack={() => router.back()}
      footer={<PrimaryButton label={t.onboardingFlow.continue} onPress={() => router.push("/onboarding/pains")} />}
    >
      <View style={{ flex: 1, gap: 28 }}>
        <OnboardingTitle title={copy.headline} highlight={copy.highlight} body={copy.body} />
        {/* Shrinks on a short phone rather than running under the button. */}
        <FadeUp delay={120} style={{ flex: 1, minHeight: 0 }}>
          <FitBox width={rowsWidth} height={302} natural align="top">
            <View style={{ width: rowsWidth, height: 302 }}>
              {rows.map((row, index) => (
                <PickRow key={row.title} timeline={timeline} row={row} index={index} winner={index === 2} />
              ))}
              <ScanLine timeline={timeline} />
            </View>
          </FitBox>
        </FadeUp>
      </View>
    </OnboardingScreen>
  );
}
