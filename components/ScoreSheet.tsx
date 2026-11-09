import { useState } from "react";
import { Text, View } from "react-native";

import { BottomSheet } from "@/components/BottomSheet";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import type { Task } from "@/types/task";

// The score's three parts and their weights (lib/scoring.ts:
// 0.45 urgency + 0.35 importance + 0.20 effort).
const PARTS = [
  { key: "soon", weight: 45 },
  { key: "important", weight: 35 },
  { key: "long", weight: 20 },
] as const;

const DIAMOND = { transform: [{ rotate: "45deg" }] };

/**
 * Opened from a task's score pill on the Tasks page: what the score is and
 * how it's worked out, in plain words — with that task's own score on top.
 */
export function ScoreSheet({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const t = useTranslation();
  const rtl = useRtlText();
  // Kept while the sheet slides away, so it doesn't empty out as it goes.
  const [shown, setShown] = useState<Task | null>(task);
  if (task && task !== shown) setShown(task);

  return (
    <BottomSheet visible={!!task} onClose={onClose} title={t.scoreInfo.title}>
      <View className="gap-[14px] pb-[6px]">
        {shown ? (
          <View className="flex-row items-center gap-[10px]">
            <View className="h-[34px] flex-row items-center gap-[7px] rounded-full bg-peach px-[12px]">
              <View className="h-[9px] w-[9px] rounded-[2px] bg-accent" style={DIAMOND} />
              <Text className="font-grotesk-bold text-[16px] text-ink">{shown.priorityScore}</Text>
            </View>
            <Text numberOfLines={2} className="flex-1 font-grotesk-semibold text-[14px] text-ink" style={rtl}>
              {shown.title}
            </Text>
          </View>
        ) : null}
        <Text className="font-grotesk-regular text-[13.5px] leading-[19px] text-ink-muted" style={rtl}>
          {t.scoreInfo.body}
        </Text>
        <View className="gap-[8px]">
          {PARTS.map((part) => (
            <View key={part.key} className="flex-row items-center gap-[10px]">
              <View className="h-[6px] flex-1 overflow-hidden rounded-full bg-line-soft">
                <View className="h-full rounded-full bg-accent" style={{ width: `${part.weight * 2}%` }} />
              </View>
              <Text className="w-[150px] font-grotesk-medium text-[12.5px] text-ink" style={rtl}>
                {t.scoreInfo.parts[part.key]}
              </Text>
              <Text className="w-[34px] text-right font-mono-bold text-[11px] text-ink-muted">{part.weight}%</Text>
            </View>
          ))}
        </View>
        <Text className="font-grotesk-regular text-[12.5px] leading-[18px] text-ink-muted" style={rtl}>
          {t.scoreInfo.footer}
        </Text>
      </View>
    </BottomSheet>
  );
}
