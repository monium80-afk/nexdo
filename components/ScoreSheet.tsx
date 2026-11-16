import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { Modal, Pressable, Text, View, useWindowDimensions } from "react-native";
import Animated, { FadeOut, Keyframe } from "react-native-reanimated";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { useTabBarHeight } from "@/components/TabBar";
import type { ScoreAnchor } from "@/components/TaskCard";
import { colors } from "@/constants/theme";
import { shadow } from "@/constants/shadow";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import { PRIORITY_WEIGHTS, priorityBreakdown } from "@/lib/priority";
import type { Task } from "@/types/task";

const P = colors.palette;
// The design spec (2026-11-09).
const DIM = "rgba(34, 28, 23, 0.25)";
const CARD = "#221C17";
const ACCENT = "#F26A2E";
const MUTED = "#BFB2A7";
const ICON = "#FFB089";
const TILE = "rgba(250, 241, 228, 0.06)";
const TRACK = "rgba(250, 241, 228, 0.12)";
const PILL_COPY = "#FCE2D2";
const PILL_RING = "rgba(250, 241, 228, 0.9)";
const RING = 4;
const SIDE = 20;
/** The card sits this far under the tapped pill. */
const BELOW_PILL = 8;
const ARROW = 14;
/** How far the arrow's point sticks out of the card's top edge. */
const ARROW_OUT = 6;
/** The rotated square's centre, from the card's edge: half its diagonal, less what sticks out. */
const ARROW_OFFSET = (ARROW * Math.SQRT2) / 2 - ARROW_OUT - ARROW / 2;
/** The system font size can grow text this much at most here, so the layout holds. */
const MAX_SCALE = 1.15;
const DIAMOND = { transform: [{ rotate: "45deg" }] };
/** The tiles' labels: one size for all three, small enough for "Important" in a third of the card. */
const TILE_LABEL_SIZE = 10.5;

/** The three parts of the score, for this task (lib/priority.ts). */
const PARTS = [
  { key: "soon", icon: "calendar", value: "urgency" },
  { key: "important", icon: "flag", value: "importance" },
  { key: "long", icon: "clock", value: "effort" },
] as const;

const cardEntering = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.96 }] },
  100: { opacity: 1, transform: [{ scale: 1 }] },
}).duration(180);

export type ScoreTarget = { task: Task; anchor: ScoreAnchor };

/**
 * Tapping a task's score on the Tasks page: the page dims, a copy of the
 * tapped score sits over the dim at the same spot, and a compact dark card
 * under it says what the score means — with each factor's share of this
 * task's score. Got it, or a tap on the dim, closes it.
 */
export function ScoreSheet({ target, onClose }: { target: ScoreTarget | null; onClose: () => void }) {
  const t = useTranslation();
  const rtl = useRtlText();
  const tabBarHeight = useTabBarHeight();
  const { height: screenHeight } = useWindowDimensions();
  const [cardHeight, setCardHeight] = useState(0);
  // Kept while it fades away, so it doesn't empty out as it goes.
  const [shown, setShown] = useState<ScoreTarget | null>(target);
  if (target && target !== shown) {
    setShown(target);
    setCardHeight(0);
  }
  if (!shown) return null;

  const { task, anchor } = shown;
  const { pill, row } = anchor;
  const copy = t.scoreInfo.compact;

  // Each factor's share of the score: its weighted part over all three.
  const breakdown = priorityBreakdown(task, { now: new Date() });
  const weighted = {
    urgency: PRIORITY_WEIGHTS.urgency * breakdown.urgency,
    importance: PRIORITY_WEIGHTS.importance * breakdown.importance,
    effort: PRIORITY_WEIGHTS.effort * breakdown.effort,
  };
  const sum = weighted.urgency + weighted.importance + weighted.effort;
  const share = (value: keyof typeof weighted) => (sum > 0 ? (weighted[value] / sum) * 100 : 0);

  // 8 dp under the pill; over the row instead only if it would run under the tab bar.
  const anchorBottom = pill ? pill.y + pill.height : (row?.y ?? 120) + (row?.height ?? 0);
  const below = anchorBottom + BELOW_PILL;
  const bottomLimit = screenHeight - tabBarHeight - 8;
  const fitsBelow = cardHeight === 0 || below + cardHeight <= bottomLimit || !pill;
  const top = fitsBelow ? below : pill.y - BELOW_PILL - cardHeight;
  const arrowCentre = pill ? pill.x + pill.width / 2 - SIDE : null;

  return (
    <Modal visible={!!target} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      {target ? (
        <Animated.View exiting={FadeOut.duration(150)} style={{ flex: 1 }}>
          <Pressable onPress={onClose} accessibilityLabel={t.common.close} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: DIM }} />

          {/* A copy of the tapped score, over the dim, exactly where it is. */}
          {pill ? (
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                left: pill.x - RING,
                top: pill.y - RING,
                width: pill.width + RING * 2,
                height: pill.height + RING * 2,
                borderRadius: (pill.height + RING * 2) / 2,
                backgroundColor: PILL_RING,
                padding: RING,
              }}
            >
              <View style={{ flex: 1, borderRadius: pill.height / 2, backgroundColor: PILL_COPY, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <View style={[{ width: 7, height: 7, borderRadius: 2, backgroundColor: ACCENT }, DIAMOND]} />
                <Text maxFontSizeMultiplier={MAX_SCALE} style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 11.5, color: P.ink, includeFontPadding: false }}>
                  {task.priorityScore}
                </Text>
              </View>
            </View>
          ) : null}

          <Animated.View
            entering={cardEntering}
            onLayout={(event) => setCardHeight(event.nativeEvent.layout.height)}
            style={{
              position: "absolute",
              left: SIDE,
              right: SIDE,
              top,
              opacity: cardHeight > 0 ? 1 : 0,
              // It grows out of the arrow.
              transformOrigin: arrowCentre !== null ? `${arrowCentre}px ${fitsBelow ? 0 : cardHeight}px` : "center",
            }}
          >
            <View style={[{ borderRadius: 20, backgroundColor: CARD, padding: 14, gap: 12 }, shadow("0 20px 40px rgba(20, 12, 6, 0.35)", 14, "#140C06")]}>
              {/* The arrow, under the tapped pill. */}
              {arrowCentre !== null ? (
                <View
                  style={[
                    { position: "absolute", left: arrowCentre - ARROW / 2, width: ARROW, height: ARROW, borderRadius: 3, backgroundColor: CARD },
                    fitsBelow ? { top: ARROW_OFFSET } : { bottom: ARROW_OFFSET },
                    DIAMOND,
                  ]}
                />
              ) : null}

              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text
                    numberOfLines={1}
                    maxFontSizeMultiplier={MAX_SCALE}
                    style={[{ fontFamily: "SpaceGrotesk-Bold", fontSize: 16, lineHeight: 20, color: "#FFFFFF", includeFontPadding: false }, rtl]}
                  >
                    {copy.headline}
                  </Text>
                  <Text
                    numberOfLines={2}
                    maxFontSizeMultiplier={MAX_SCALE}
                    style={[{ fontFamily: "SpaceGrotesk-Regular", fontSize: 12.5, lineHeight: 16.5, color: MUTED, includeFontPadding: false }, rtl]}
                  >
                    {copy.line}
                  </Text>
                </View>
                <AnimatedPressable
                  onPress={onClose}
                  scaleTo={0.95}
                  accessibilityRole="button"
                  style={{ flexShrink: 0, height: 32, paddingHorizontal: 14, borderRadius: 16, backgroundColor: ACCENT, alignItems: "center", justifyContent: "center" }}
                >
                  <Text maxFontSizeMultiplier={MAX_SCALE} style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 13.5, color: "#FFFFFF", includeFontPadding: false }}>
                    {t.scoreInfo.gotIt}
                  </Text>
                </AnimatedPressable>
              </View>

              <View style={{ flexDirection: "row", gap: 6 }}>
                {PARTS.map((part) => (
                  <View key={part.key} style={{ flex: 1, minWidth: 0, borderRadius: 14, backgroundColor: TILE, padding: 10, gap: 7 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Feather name={part.icon} size={13} color={ICON} />
                      {/* One fixed size for all three (the size "Important" fits at),
                          not each shrunk on its own — they looked uneven. */}
                      <Text
                        numberOfLines={1}
                        maxFontSizeMultiplier={1}
                        style={{ flex: 1, fontFamily: "SpaceGrotesk-SemiBold", fontSize: TILE_LABEL_SIZE, color: "#FFFFFF", includeFontPadding: false }}
                      >
                        {copy[part.key]}
                      </Text>
                    </View>
                    <View style={{ height: 4, borderRadius: 2, backgroundColor: TRACK, overflow: "hidden" }}>
                      <View style={{ height: 4, borderRadius: 2, width: `${Math.min(100, share(part.value))}%`, backgroundColor: ACCENT }} />
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </Animated.View>
        </Animated.View>
      ) : null}
    </Modal>
  );
}
