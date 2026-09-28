import { Feather } from "@expo/vector-icons";
import { useImperativeHandle, useState, type Ref } from "react";
import { Text, TextInput, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import {
  computeDeadlineDate,
  DEADLINE_OPTIONS,
  DeadlineChip,
  DeadlineDatePicker,
  DURATION_OPTIONS,
  DurationChip,
  SectionHeader,
  type DeadlineValue,
} from "@/components/TaskFormFields";
import { colors } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import { getDueInfo } from "@/lib/taskMeta";
import type { TaskChanges } from "@/lib/taskOperations";
import type { Task } from "@/types/task";

export type TaskEditChanges = Pick<TaskChanges, "title" | "estimatedMinutes" | "dueDate">;

/** Lets Task Details' "Save Changes" button save these drafts too. */
export type TaskEditPanelHandle = {
  /** Saves the drafts — false when a field needs fixing first. */
  save: () => boolean;
};

// "keep" leaves the deadline untouched until the user picks something else.
type DeadlineChoice = DeadlineValue | "keep" | "custom";

// The calendar opens on the task's own deadline while it's still ahead, otherwise tomorrow evening.
function initialCustomDeadline(dueDate: string | undefined): Date {
  const current = dueDate ? new Date(dueDate) : undefined;
  if (current && current.getTime() > Date.now()) return current;
  return computeDeadlineDate("tomorrow") ?? new Date();
}

/**
 * Everything the pen icon on Task Details can change. Edits stay local
 * drafts until "Save changes", so backing out never half-updates a task.
 */
export function TaskEditPanel({
  task,
  onSave,
  onCancel,
  ref,
}: {
  task: Task;
  onSave: (changes: TaskEditChanges) => void;
  onCancel: () => void;
  ref?: Ref<TaskEditPanelHandle>;
}) {
  const t = useTranslation();
  const rtl = useRtlText();
  const isPresetDuration = DURATION_OPTIONS.includes(task.estimatedMinutes);

  const [title, setTitle] = useState(task.title);
  const [titleError, setTitleError] = useState(false);

  const [durationMinutes, setDurationMinutes] = useState(task.estimatedMinutes);
  const [customDurationOpen, setCustomDurationOpen] = useState(!isPresetDuration);
  const [customDurationText, setCustomDurationText] = useState(isPresetDuration ? "" : String(task.estimatedMinutes));
  const [durationError, setDurationError] = useState(false);

  const [deadline, setDeadline] = useState<DeadlineChoice>("keep");
  const [customDeadline, setCustomDeadline] = useState(() => initialCustomDeadline(task.dueDate));

  // Previewed as if pending, so a completed task shows a date instead of "Completed".
  const describeDeadline = (dueDate: string | undefined) =>
    getDueInfo({ ...task, status: "pending", dueDate }).pillLabel;

  const deadlineCaption =
    deadline === "keep"
      ? t.form.editCurrentDeadline(describeDeadline(task.dueDate))
      : deadline === "custom"
        ? t.form.newDeadline(describeDeadline(customDeadline.toISOString()))
        : deadline === "none"
          ? t.form.deadlineRemoved
          : t.form.newDeadline(describeDeadline(computeDeadlineDate(deadline)?.toISOString()));

  const handleSave = (): boolean => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setTitleError(true);
      return false;
    }

    const estimatedMinutes = customDurationOpen ? Number.parseInt(customDurationText.trim(), 10) : durationMinutes;
    if (customDurationOpen && (!/^\d+$/.test(customDurationText.trim()) || estimatedMinutes <= 0)) {
      setDurationError(true);
      return false;
    }

    const changes: TaskEditChanges = { title: trimmedTitle, estimatedMinutes };

    if (deadline === "custom") {
      changes.dueDate = customDeadline.toISOString();
    } else if (deadline !== "keep") {
      // "No deadline" is null: remove it.
      changes.dueDate = computeDeadlineDate(deadline)?.toISOString() ?? null;
    }

    onSave(changes);
    return true;
  };

  useImperativeHandle(ref, () => ({ save: handleSave }));

  return (
    <View className="gap-6 rounded-2xl border border-cream-300 bg-cream-50 p-4">
      <View className="flex-row items-center gap-2">
        <Feather name="edit-2" size={13} color={colors.orange[500]} />
        <Text className="eyebrow text-orange-500">{t.form.editEyebrow}</Text>
      </View>

      <View className="gap-2">
        <Text className="eyebrow text-ink-cream">{t.form.taskTitle}</Text>
        <TextInput
          value={title}
          onChangeText={(text) => {
            setTitle(text);
            setTitleError(false);
          }}
          placeholder={t.form.editTitlePlaceholder}
          placeholderTextColor={colors.ink.creamMuted}
          returnKeyType="done"
          style={rtl}
          className={
            titleError
              ? "rounded-2xl border border-overdue-500 bg-cream-50 px-4 py-3 font-grotesk-semibold text-base text-ink-cream"
              : "rounded-2xl border border-cream-300 bg-cream-50 px-4 py-3 font-grotesk-semibold text-base text-ink-cream"
          }
        />
        {titleError ? (
          <Text className="font-grotesk-medium text-xs text-overdue-500">{t.form.titleRequired}</Text>
        ) : null}
      </View>

      <View className="gap-3">
        <SectionHeader
          icon={<Feather name="clock" size={14} color={colors.orange[500]} />}
          label={t.form.duration}
          action={{ label: t.form.customDuration, onPress: () => setCustomDurationOpen((open) => !open) }}
        />
        <View className="flex-row flex-wrap gap-2">
          {DURATION_OPTIONS.map((minutes) => (
            <DurationChip
              key={minutes}
              label={t.form.durationOptions[minutes]}
              selected={!customDurationOpen && durationMinutes === minutes}
              onPress={() => {
                setDurationMinutes(minutes);
                setCustomDurationOpen(false);
                setDurationError(false);
              }}
            />
          ))}
        </View>
        {customDurationOpen ? (
          <View className="flex-row items-center gap-2 rounded-2xl border border-cream-300 bg-cream-50 px-4 py-3">
            <TextInput
              value={customDurationText}
              onChangeText={(text) => {
                setCustomDurationText(text);
                setDurationError(false);
              }}
              placeholder={t.form.minutesPlaceholder}
              placeholderTextColor={colors.ink.creamMuted}
              keyboardType="number-pad"
              className="flex-1 font-grotesk-regular text-sm text-ink-cream"
            />
            <Text className="font-grotesk-medium text-xs text-ink-cream-muted">{t.form.minutesUnit}</Text>
          </View>
        ) : null}
        {durationError ? (
          <Text className="font-grotesk-medium text-xs text-overdue-500">{t.form.durationError}</Text>
        ) : null}
      </View>

      <View className="gap-3">
        <SectionHeader
          icon={<Feather name="calendar" size={14} color={colors.orange[500]} />}
          label={t.form.deadline}
          action={{
            label: t.form.specificDate,
            onPress: () => setDeadline((current) => (current === "custom" ? "keep" : "custom")),
          }}
        />
        <View className="flex-row flex-wrap gap-2">
          {DEADLINE_OPTIONS.map((value) => (
            <DeadlineChip
              key={value}
              label={t.form.deadlines[value]}
              selected={deadline === value}
              onPress={() => setDeadline(value)}
            />
          ))}
        </View>
        {deadline === "custom" ? <DeadlineDatePicker value={customDeadline} onChange={setCustomDeadline} /> : null}
        <Text className="font-grotesk-medium text-xs text-ink-cream-muted">{deadlineCaption}</Text>
      </View>

      <View className="flex-row items-center justify-end gap-4">
        <AnimatedPressable onPress={onCancel} hitSlop={8} accessibilityRole="button" className="px-2 py-3">
          <Text className="font-grotesk-semibold text-sm text-ink-cream-muted">{t.common.cancel}</Text>
        </AnimatedPressable>
        <AnimatedPressable onPress={handleSave} accessibilityRole="button" className="btn btn--primary flex-row gap-2 px-5 py-3">
          <Feather name="check" size={16} color={colors.cream[50]} />
          <Text className="font-grotesk-bold text-sm text-cream-50">{t.form.saveChanges}</Text>
        </AnimatedPressable>
      </View>
    </View>
  );
}
