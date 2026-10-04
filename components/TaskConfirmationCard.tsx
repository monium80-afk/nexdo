import { Feather } from "@expo/vector-icons";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Platform, Text, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { IconButton, PrimaryButton, SecondaryButton, TextButton } from "@/components/Button";
import { GemLogo } from "@/components/GemLogo";
import { MetaPill } from "@/components/MetaPill";
import { TextField } from "@/components/TextField";
import { gradients } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import type { ExtractedTaskDraft } from "@/lib/ai/types";
import { formatDuration } from "@/lib/formatDuration";
import type { Translations } from "@/lib/i18n";
import { applyPickedDateTime, deadlineFromDate, deadlineInstant } from "@/lib/deadline";
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

/**
 * A task the AI found in a message, before it's added: drawn as the Tasks
 * page's card (same surface, title and details row) with the app's own
 * buttons under it, so it reads as "this is what will land in your list".
 */
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

  // What the picker shows: the draft's deadline, or — with none yet — a time
  // fixed when the card appeared, so a pick can be told apart from it.
  const [blankPickerValue] = useState(() => new Date());
  const pickerValue = draft.dueDate ? new Date(draft.dueDate) : blankPickerValue;

  const handlePickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    const mode = picker;
    if (Platform.OS === "android") setPicker(null);
    if (event.type === "dismissed" || !selected) return;
    // iOS shows date and time in one spinner (only a changed time makes the
    // deadline exact); Android asks for the time in a second dialog.
    const part = Platform.OS === "ios" ? "both" : mode === "time" ? "time" : "date";
    const next = applyPickedDateTime(pickerValue, selected, part, !!draft.dueHasTime);
    onChange?.({ dueDate: next.date.toISOString(), dueHasTime: next.hasTime });
    if (mode === "date" && Platform.OS === "android") setPicker("time");
  };

  return (
    <View className="card card--cream-soft gap-3.5 px-[18px] py-[17px]" style={gradients.card}>
      {isEditing ? (
        <View className="gap-2.5">
          <TextField
            value={draft.title}
            onChangeText={(text) => onChange?.({ title: text })}
            placeholder={t.chat.titlePlaceholder}
          />
          <View className="flex-row items-center gap-2.5">
            <TextField
              value={draft.estimatedMinutes ? String(draft.estimatedMinutes) : ""}
              onChangeText={handleMinutesChange}
              keyboardType="number-pad"
              placeholder={t.chat.minutesPlaceholder}
              className="flex-1"
              trailing={<Feather name="clock" size={15} color={colors.ink.creamMuted} />}
            />
            {/* Shaped like a TextField, but a tap opens the date picker. */}
            <AnimatedPressable
              onPress={() => setPicker("date")}
              scaleTo={0.98}
              accessibilityRole="button"
              className="input min-h-[44px] flex-1 flex-row items-center gap-2 border-cream-200 px-4"
            >
              <Text numberOfLines={1} className="flex-1 font-grotesk-regular text-sm text-ink-cream">
                {formatDueFieldValue(draft.dueDate, draft.dueHasTime, t)}
              </Text>
              <Feather name="calendar" size={15} color={colors.ink.creamMuted} />
            </AnimatedPressable>
          </View>

          {picker ? (
            <DateTimePicker
              value={pickerValue}
              mode={Platform.OS === "ios" ? "datetime" : picker}
              display={Platform.OS === "ios" ? "inline" : "default"}
              onChange={handlePickerChange}
            />
          ) : null}

          <View className="flex-row justify-end">
            <TextButton
              icon="check"
              tone="accent"
              label={t.chat.doneEditing}
              onPress={() => {
                setIsEditing(false);
                setPicker(null);
              }}
            />
          </View>
        </View>
      ) : (
        // The Tasks page's card, line for line: bold title, then the details.
        <View className="gap-2.5">
          <View className="flex-row items-start gap-2">
            <Text className="flex-1 font-grotesk-bold text-[18px] leading-[23px] tracking-tight text-ink-cream" style={rtl}>
              {draft.title}
            </Text>
            {/* Pulled into the corner so the pencil, not its touch area, lines
                up with the title's first line and the card's edge. */}
            <View className="mr-[-8px] mt-[-4px]">
              <IconButton icon="edit-2" onPress={() => setIsEditing(true)} accessibilityLabel={t.chat.editDetails} />
            </View>
          </View>

          <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1.5">
            <MetaPill
              icon={<Feather name="calendar" size={14} color={shownDueDate ? colors.orange[500] : colors.ink.creamSubtle} />}
              label={dueLabel}
              labelClassName={
                shownDueDate
                  ? "font-grotesk-semibold text-[13px] text-ink-cream"
                  : "font-grotesk-medium text-[13px] text-ink-cream-muted"
              }
            />
            <MetaPill
              icon={<GemLogo size={13} />}
              label={String(priorityScore)}
              labelClassName="font-grotesk-semibold text-[13px] text-ink-cream-muted"
              accessibilityLabel={t.tasks.score(priorityScore)}
            />
            <MetaPill
              icon={<Feather name="clock" size={14} color={colors.ink.creamMuted} />}
              label={formatDuration(draft.estimatedMinutes)}
              labelClassName="font-grotesk-medium text-[13px] text-ink-cream-muted"
            />
            {repeatRule ? (
              <MetaPill
                icon={<Feather name="repeat" size={14} color={colors.orange[500]} />}
                label={describeRule(repeatRule, t)}
                labelClassName="font-grotesk-medium text-[13px] text-ink-cream-muted"
              />
            ) : null}
          </View>
        </View>
      )}

      {/* Split from the task by a hairline, so the buttons read as the
          decision about it rather than as more of its details. */}
      <View className="flex-row items-center justify-end gap-2.5 border-t border-cream-200 pt-3.5">
        <SecondaryButton label={t.chat.dismiss} onPress={onDismiss} />
        <PrimaryButton icon="check" label={t.chat.addTask} onPress={onAdd} />
      </View>
    </View>
  );
}
