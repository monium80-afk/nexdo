import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Modal, Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { SheetIcon } from "@/components/addSheet/SheetParts";
import { colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/useTranslation";
import type { DeadlineInput } from "@/lib/deadline";
import { addDaysToKey, keyToLocalDate, toLocalDateKey } from "@/lib/localDate";
import { useTaskStore } from "@/store/useTaskStore";
import type { Task } from "@/types/task";
import { shadow } from "@/constants/shadow";

const P = colors.palette;

const OPTIONS = [
  { key: "oneDay", days: 1 },
  { key: "threeDays", days: 3 },
  { key: "oneWeek", days: 7 },
] as const;

/**
 * The deadline `days` after the current one — or after today, when it's
 * already behind us or there is none. It keeps its time if it has one.
 */
function postponed(task: Task, days: number, now: Date): DeadlineInput {
  const today = toLocalDateKey(now);
  const from = task.deadline && task.deadline.date > today ? task.deadline.date : today;
  return { date: addDaysToKey(from, days), time: task.deadline?.time };
}

/**
 * The Calendar only shows what's coming; the one thing a task there can do
 * is move: tapping it opens this card — +1 day, +3 days, +1 week, or a day
 * picked on the calendar. (A repeating task gets its dates from its repeat,
 * so it has none — see app/(tabs)/calendar.tsx.)
 */
export function PostponeSheet({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
  const t = useTranslation();
  const insets = useSafeAreaInsets();
  const task = useTaskStore((state) => (taskId ? state.tasks.find((entry) => entry.id === taskId) : undefined));
  const updateTask = useTaskStore((state) => state.updateTask);
  const [picking, setPicking] = useState(false);

  const move = (deadline: DeadlineInput) => {
    if (!task) return;
    updateTask(task.id, { deadline });
    onClose();
  };

  const handlePicked = (event: DateTimePickerEvent, picked?: Date) => {
    setPicking(false);
    if (event.type === "set" && picked && task) move({ date: toLocalDateKey(picked), time: task.deadline?.time });
  };

  const now = new Date();
  const pickerStart = task ? postponed(task, 1, now).date : toLocalDateKey(now);

  return (
    <Modal visible={Boolean(task)} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end", paddingHorizontal: 12, paddingBottom: insets.bottom + 12 }}>
        <Pressable onPress={onClose} accessibilityLabel={t.common.close} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: P.veil }} />
        {task ? (
          <View style={{ borderRadius: 24, backgroundColor: P.paperCard, padding: 18, gap: 14, ...shadow("0 10px 30px rgba(34, 28, 23, 0.25)", 12) }}>
            <View style={{ gap: 3 }}>
              <Text accessibilityRole="header" style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 20, color: P.ink }}>
                {t.redesign.postpone}
              </Text>
              <Text numberOfLines={1} style={{ fontFamily: "SpaceGrotesk-Regular", fontSize: 14, color: P.inkMuted }}>
                {task.title}
              </Text>
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {OPTIONS.map((option) => (
                <AnimatedPressable
                  key={option.key}
                  onPress={() => move(postponed(task, option.days, new Date()))}
                  scaleTo={0.95}
                  accessibilityRole="button"
                  style={{ flex: 1, height: 46, borderRadius: 23, backgroundColor: P.tile, alignItems: "center", justifyContent: "center" }}
                >
                  <Text style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 15, color: P.ink }}>{t.taskDetail.postpone[option.key]}</Text>
                </AnimatedPressable>
              ))}
            </View>
            <AnimatedPressable
              onPress={() => setPicking(true)}
              scaleTo={0.97}
              accessibilityRole="button"
              style={{ height: 46, borderRadius: 23, backgroundColor: P.ink, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}
            >
              <SheetIcon name="calendar" size={16} color="#FFFFFF" />
              <Text style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 15, color: "#FFFFFF" }}>{t.redesign.pickDay}</Text>
            </AnimatedPressable>
            {picking ? (
              <DateTimePicker
                value={keyToLocalDate(pickerStart)}
                minimumDate={keyToLocalDate(toLocalDateKey(now))}
                mode="date"
                display={Platform.OS === "ios" ? "inline" : "default"}
                accentColor={P.accent}
                onChange={handlePicked}
              />
            ) : null}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
