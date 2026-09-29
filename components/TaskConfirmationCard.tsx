import { Feather } from "@expo/vector-icons";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Platform, Text, TextInput, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { GemLogo } from "@/components/GemLogo";
import { useRtlText } from "@/hooks/useRtlText";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import type { ExtractedTaskDraft } from "@/lib/ai/types";
import { formatDuration } from "@/lib/formatDuration";
import type { Translations } from "@/lib/i18n";
import { deadlineFromDate, deadlineInstant } from "@/lib/deadline";
import { buildRule, describeRule, slotDeadline } from "@/lib/recurrence";
import { computePriorityScore, PRIORITY_LEVEL_IMPORTANCE } from "@/lib/scoring";
import { previewDueLabel } from "@/lib/taskMeta";

function formatDueFieldValue(dueDate: string | undefined, hasTime: boolean | undefined, t: Translations): string {
  if (!dueDate) return t.due.noDeadline;
  const due = new Date(dueDate);
  const date = due.toLocaleDateString(t.locale, { month: "short", day: "numeric" });
  if (!hasTime) return date;
  return `${date}, ${due.toLocaleTimeString(t.locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })}`;
}

/** Shared shell for the editable fields — a bordered pill matching the design. */
function EditField({ children }: { children: React.ReactNode }) {
  return (
    <View className="flex-1 rounded-xl border border-cream-300 bg-cream-50 px-3 py-2">{children}</View>
  );
}

export function TaskConfirmationCard({
  draft,
  onAdd,
  onDismiss,
  onChange,
}: {
  draft: ExtractedTaskDraft;
  onAdd: () => void;
  onDismiss: () => void;
  /** Writes edits back into the queued draft so "Add Task" saves what's on screen. */
  onChange: (patch: Partial<ExtractedTaskDraft>) => void;
}) {
  const colors = useColors();
  const t = useTranslation();
  const rtl = useRtlText();
  const [isEditing, setIsEditing] = useState(false);
  // "date" then "time" on Android, where the two pickers are separate dialogs.
  const [picker, setPicker] = useState<"date" | "time" | null>(null);

  const now = new Date();
  // What saving will set up — the same deadline and rule addTask builds from
  // these fields: a day, with a time only if one was said. A repeating task
  // is due on its first occurrence, which the rule may move (a deadline on a
  // Wednesday for "every Mon and Thu" starts on Thursday).
  const draftDeadline = draft.dueDate ? deadlineFromDate(new Date(draft.dueDate), !!draft.dueHasTime) : undefined;
  const repeatRule = draft.recurrence ? buildRule(draft.recurrence, draftDeadline, now) : null;
  const shownDeadline = repeatRule ? slotDeadline(repeatRule, repeatRule.anchorDate) : draftDeadline;
  const shownDueDate = shownDeadline ? deadlineInstant(shownDeadline).toISOString() : undefined;
  const dueLabel = previewDueLabel(shownDueDate, !!shownDeadline?.time, now, t);
  // Scored off the draft's own priority and the deadline it will really have,
  // so this preview matches what applyStructuredAction will actually save.
  const priorityScore = computePriorityScore(
    {
      dueDate: shownDueDate,
      estimatedMinutes: draft.estimatedMinutes,
      importance: PRIORITY_LEVEL_IMPORTANCE[draft.priorityLevel],
    },
    now,
  );

  const handleMinutesChange = (text: string) => {
    const parsed = Number.parseInt(text.replace(/\D/g, ""), 10);
    onChange?.({ estimatedMinutes: Number.isNaN(parsed) ? 0 : parsed });
  };

  const handlePickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    const mode = picker;
    if (Platform.OS === "android") setPicker(null);
    if (event.type === "dismissed" || !selected) return;
    const base = draft.dueDate ? new Date(draft.dueDate) : new Date();
    // Picking a time (or the combined iOS date+time spinner) means the user
    // has now set one explicitly.
    let dueHasTime = draft.dueHasTime;
    if (mode === "time") {
      base.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
      dueHasTime = true;
    } else {
      base.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
      // iOS shows date and time in one spinner; Android needs a second dialog.
      if (Platform.OS === "ios") {
        base.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
        dueHasTime = true;
      }
    }
    onChange?.({ dueDate: base.toISOString(), dueHasTime });
    if (mode === "date" && Platform.OS === "android") setPicker("time");
  };

  return (
    // The frame (orange edge, width, corners) is the card's own and stays as it is.
    <View className="card card--cream gap-3 border-orange-500 px-4 pb-4 pt-5">
      <View className="flex-row items-start gap-2">
        {isEditing ? (
          <TextInput
            value={draft.title}
            onChangeText={(text) => onChange?.({ title: text })}
            placeholder={t.chat.titlePlaceholder}
            placeholderTextColor={colors.ink.creamMuted}
            style={[{ flex: 1 }, rtl]}
            className="rounded-xl border border-cream-300 bg-cream-50 px-3 py-2 font-grotesk-bold text-sm text-ink-cream"
          />
        ) : (
          <>
            <Text
              className="flex-1 font-grotesk-semibold text-[20px] leading-[25px] tracking-[-0.02em] text-ink-cream"
              style={rtl}
            >
              {draft.title}
            </Text>
            <AnimatedPressable
              onPress={() => setIsEditing(true)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t.chat.editDetails}
              className="mt-[1px]"
            >
              <Feather name="edit-2" size={15} color={colors.ink.creamSubtle} />
            </AnimatedPressable>
          </>
        )}
      </View>

      {isEditing ? (
        <View className="gap-2.5">
          <View className="flex-row items-center gap-2.5">
            <Feather name="clock" size={14} color={colors.orange[500]} />
            <EditField>
              <TextInput
                value={draft.estimatedMinutes ? String(draft.estimatedMinutes) : ""}
                onChangeText={handleMinutesChange}
                keyboardType="number-pad"
                placeholder={t.chat.minutesPlaceholder}
                placeholderTextColor={colors.ink.creamSubtle}
                style={{ padding: 0 }}
                className="font-grotesk-medium text-sm text-ink-cream-subtle"
              />
            </EditField>
            <Feather name="calendar" size={14} color={colors.orange[500]} />
            <AnimatedPressable
              onPress={() => setPicker("date")}
              className="flex-1 rounded-xl border border-cream-300 bg-cream-50 px-3 py-2"
            >
              <Text className="font-grotesk-medium text-sm text-ink-cream-subtle">
                {formatDueFieldValue(draft.dueDate, draft.dueHasTime, t)}
              </Text>
            </AnimatedPressable>
          </View>

          <View className="flex-row items-center justify-end">
            <AnimatedPressable
              onPress={() => {
                setIsEditing(false);
                setPicker(null);
              }}
              hitSlop={8}
            >
              <Text className="font-grotesk-medium text-sm text-ink-cream-subtle underline">{t.chat.doneEditing}</Text>
            </AnimatedPressable>
          </View>

          {picker ? (
            <DateTimePicker
              value={draft.dueDate ? new Date(draft.dueDate) : new Date()}
              mode={Platform.OS === "ios" ? "datetime" : picker}
              display={Platform.OS === "ios" ? "inline" : "default"}
              onChange={handlePickerChange}
            />
          ) : null}
        </View>
      ) : (
        // Score in a soft chip, then duration and deadline. "No deadline"
        // is a shade quieter than a real one.
        <View className="flex-row flex-wrap items-center gap-x-3.5 gap-y-2">
          <View
            accessible
            accessibilityLabel={t.tasks.score(priorityScore)}
            // Less on the left: the gem's box has air of its own, so this
            // looks even on both sides.
            className="flex-row items-center gap-1 rounded-[8px] bg-cream-200/70 py-[2px] pl-[5px] pr-[7px]"
          >
            <GemLogo size={13} />
            <Text className="font-grotesk-semibold text-[13px] leading-[17px] text-ink-cream-muted">{priorityScore}</Text>
          </View>
          <View className="flex-row items-center gap-1">
            <Feather name="clock" size={14} color={colors.ink.creamSubtle} />
            <Text className="font-grotesk-medium text-[13.5px] text-ink-cream-muted">
              {formatDuration(draft.estimatedMinutes)}
            </Text>
          </View>
          <View className="flex-row items-center gap-1">
            <Feather name="calendar" size={14} color={colors.ink.creamSubtle} />
            <Text
              className={
                shownDueDate
                  ? "font-grotesk-medium text-[13.5px] text-ink-cream-muted"
                  : "font-grotesk-medium text-[13.5px] text-ink-cream-subtle"
              }
            >
              {dueLabel}
            </Text>
          </View>
        </View>
      )}

      {repeatRule ? (
        <View className="flex-row items-center gap-1">
          <Feather name="repeat" size={14} color={colors.ink.creamSubtle} />
          <Text className="flex-1 font-grotesk-medium text-[13.5px] text-ink-cream-muted" style={rtl}>
            {describeRule(repeatRule, t)}
          </Text>
        </View>
      ) : null}

      <View className="mt-1 flex-row items-center justify-end gap-5">
        <AnimatedPressable onPress={onDismiss} hitSlop={8}>
          <Text className="font-grotesk-semibold text-[13.5px] text-ink-cream-muted">{t.chat.dismiss}</Text>
        </AnimatedPressable>
        <AnimatedPressable onPress={onAdd} className="flex-row items-center gap-2 rounded-full bg-orange-500 px-4 py-2">
          <Feather name="check" size={13} color={colors.onAccent} />
          <Text className="font-grotesk-bold text-[12.5px] leading-[17.5px] text-on-accent">{t.chat.addTask}</Text>
        </AnimatedPressable>
      </View>
    </View>
  );
}
