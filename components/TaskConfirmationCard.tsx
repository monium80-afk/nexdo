import { Feather } from "@expo/vector-icons";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Platform, Text, TextInput, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { GemLogo } from "@/components/GemLogo";
import { colors } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import type { ExtractedTaskDraft } from "@/lib/ai/types";
import { formatDuration } from "@/lib/formatDuration";
import type { Translations } from "@/lib/i18n";
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
  const t = useTranslation();
  const rtl = useRtlText();
  const [isEditing, setIsEditing] = useState(false);
  // "date" then "time" on Android, where the two pickers are separate dialogs.
  const [picker, setPicker] = useState<"date" | "time" | null>(null);

  const now = new Date();
  // Scored off the draft's own priority so this preview matches what
  // applyStructuredAction will actually save.
  const priorityScore = computePriorityScore(
    {
      dueDate: draft.dueDate,
      estimatedMinutes: draft.estimatedMinutes,
      importance: PRIORITY_LEVEL_IMPORTANCE[draft.priorityLevel],
    },
    now,
  );
  const dueLabel = previewDueLabel(draft.dueDate, draft.dueHasTime, now, t);

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
    <View className="card card--cream gap-3 border-orange-500 p-4">
      <View className="flex-row items-center justify-between gap-2">
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
          <Text className="flex-1 font-grotesk-bold text-base text-ink-cream" style={rtl}>
            {draft.title}
          </Text>
        )}
        <View className="flex-row items-center gap-1.5 rounded-full bg-charcoal-900 px-2.5 py-1.5">
          <GemLogo size={14} onDark />
          <Text className="font-grotesk-bold text-xs text-ink-charcoal">{priorityScore}</Text>
        </View>
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
        <View className="flex-row items-center justify-between gap-2">
          <View className="flex-row items-center gap-4">
            <View className="flex-row items-center gap-1.5">
              <Feather name="clock" size={14} color={colors.orange[500]} />
              <Text className="font-grotesk-medium text-sm text-ink-cream-subtle">
                {formatDuration(draft.estimatedMinutes)}
              </Text>
            </View>
            <View className="flex-row items-center gap-1.5">
              <Feather name="calendar" size={14} color={colors.orange[500]} />
              <Text className="font-grotesk-medium text-sm text-ink-cream-subtle">{dueLabel}</Text>
            </View>
          </View>
          {/* Icon rather than an "Edit details" label — the row is tight on
              narrow screens and the text pushed past the card's edge. */}
          <AnimatedPressable onPress={() => setIsEditing(true)} hitSlop={10} accessibilityLabel={t.chat.editDetails}>
            <Feather name="edit-2" size={15} color={colors.ink.creamSubtle} />
          </AnimatedPressable>
        </View>
      )}

      <View className="h-px bg-cream-300" />

      <View className="flex-row items-center justify-end gap-4">
        <AnimatedPressable onPress={onDismiss} hitSlop={8}>
          <Text className="font-grotesk-semibold text-sm text-ink-cream-muted">{t.chat.dismiss}</Text>
        </AnimatedPressable>
        <AnimatedPressable onPress={onAdd} className="flex-row items-center gap-2 rounded-full bg-orange-500 px-4 py-2">
          <Feather name="check" size={16} color={colors.cream[50]} />
          <Text className="font-grotesk-bold text-sm text-cream-50">{t.chat.addTask}</Text>
        </AnimatedPressable>
      </View>
    </View>
  );
}
