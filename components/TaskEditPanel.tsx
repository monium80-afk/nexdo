import { useImperativeHandle, useState, type Ref } from "react";
import { Text, View } from "react-native";

import { PrimaryButton, TextButton } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { SectionHeader } from "@/components/SectionHeader";
import {
  computeDeadline,
  DEADLINE_OPTIONS,
  DeadlineDatePicker,
  deadlineToDraft,
  draftToDeadline,
  DURATION_OPTIONS,
  type DeadlineDraft,
  type DeadlineValue,
} from "@/components/TaskFormFields";
import { TextField } from "@/components/TextField";
import { useTranslation } from "@/hooks/useTranslation";
import { makeDeadline, withDeadline, type DeadlineInput } from "@/lib/deadline";
import { getDueInfo } from "@/lib/taskMeta";
import type { TaskChanges } from "@/lib/taskOperations";
import type { Task } from "@/types/task";

export type TaskEditChanges = Pick<TaskChanges, "title" | "estimatedMinutes" | "deadline">;

/** Lets Task Details' "Save Changes" button save these drafts too. */
export type TaskEditPanelHandle = {
  /** Saves the drafts — false when a field needs fixing first. */
  save: () => boolean;
};

// "keep" leaves the deadline untouched until the user picks something else.
type DeadlineChoice = DeadlineValue | "keep" | "custom";

// The calendar opens on the task's own deadline while it's still ahead, otherwise tomorrow.
function initialCustomDeadline(task: Task): DeadlineDraft {
  if (task.deadline && task.dueDate && Date.parse(task.dueDate) > Date.now()) return deadlineToDraft(task.deadline);
  return deadlineToDraft(undefined);
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
  const isPresetDuration = DURATION_OPTIONS.includes(task.estimatedMinutes);

  const [title, setTitle] = useState(task.title);
  const [titleError, setTitleError] = useState(false);

  const [durationMinutes, setDurationMinutes] = useState(task.estimatedMinutes);
  const [customDurationOpen, setCustomDurationOpen] = useState(!isPresetDuration);
  const [customDurationText, setCustomDurationText] = useState(isPresetDuration ? "" : String(task.estimatedMinutes));
  const [durationError, setDurationError] = useState(false);

  const [deadline, setDeadline] = useState<DeadlineChoice>("keep");
  const [customDeadline, setCustomDeadline] = useState(() => initialCustomDeadline(task));

  // Previewed as if pending, so a completed task shows a date instead of "Completed".
  const describeDeadline = (input: DeadlineInput | undefined) =>
    getDueInfo(withDeadline({ ...task, status: "pending" }, makeDeadline(input))).pillLabel;

  const deadlineCaption =
    deadline === "keep"
      ? t.form.editCurrentDeadline(getDueInfo({ ...task, status: "pending" }).pillLabel)
      : deadline === "custom"
        ? t.form.newDeadline(describeDeadline(draftToDeadline(customDeadline)))
        : deadline === "none"
          ? t.form.deadlineRemoved
          : t.form.newDeadline(describeDeadline(computeDeadline(deadline)));

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
      changes.deadline = draftToDeadline(customDeadline);
    } else if (deadline !== "keep") {
      // "No deadline" is null: remove it.
      changes.deadline = computeDeadline(deadline) ?? null;
    }

    onSave(changes);
    return true;
  };

  useImperativeHandle(ref, () => ({ save: handleSave }));

  return (
    <View className="card card--cream-soft gap-5 p-[16px]">
      <SectionHeader icon="edit-2" label={t.form.editEyebrow} />

      <View className="gap-2">
        <SectionHeader label={t.form.taskTitle} required />
        <TextField
          value={title}
          onChangeText={(text) => {
            setTitle(text);
            setTitleError(false);
          }}
          placeholder={t.form.editTitlePlaceholder}
          returnKeyType="done"
          error={titleError}
        />
        {titleError ? <Text className="font-grotesk-medium text-sm text-overdue-500">{t.form.titleRequired}</Text> : null}
      </View>

      <View className="gap-3">
        <SectionHeader
          icon="clock"
          label={t.form.duration}
          action={{ label: t.form.customDuration, onPress: () => setCustomDurationOpen((open) => !open) }}
        />
        <View className="flex-row flex-wrap gap-2">
          {DURATION_OPTIONS.map((minutes) => (
            <Chip
              key={minutes}
              label={t.form.durationOptions[minutes]}
              selected={!customDurationOpen && durationMinutes === minutes}
              accessibilityRole="radio"
              onPress={() => {
                setDurationMinutes(minutes);
                setCustomDurationOpen(false);
                setDurationError(false);
              }}
            />
          ))}
        </View>
        {customDurationOpen ? (
          <TextField
            value={customDurationText}
            onChangeText={(text) => {
              setCustomDurationText(text);
              setDurationError(false);
            }}
            placeholder={t.form.minutesPlaceholder}
            keyboardType="number-pad"
            error={durationError}
            trailing={<Text className="font-grotesk-medium text-sm text-ink-cream-muted">{t.form.minutesUnit}</Text>}
          />
        ) : null}
        {durationError ? <Text className="font-grotesk-medium text-sm text-overdue-500">{t.form.durationError}</Text> : null}
      </View>

      <View className="gap-3">
        <SectionHeader
          icon="calendar"
          label={t.form.deadline}
          action={{
            label: t.form.specificDate,
            onPress: () => setDeadline((current) => (current === "custom" ? "keep" : "custom")),
          }}
        />
        <View className="flex-row flex-wrap gap-2">
          {DEADLINE_OPTIONS.map((value) => (
            <Chip
              key={value}
              label={t.form.deadlines[value]}
              selected={deadline === value}
              accessibilityRole="radio"
              onPress={() => setDeadline(value)}
            />
          ))}
        </View>
        {deadline === "custom" ? <DeadlineDatePicker value={customDeadline} onChange={setCustomDeadline} /> : null}
        <Text className="font-grotesk-medium text-sm text-ink-cream-muted">{deadlineCaption}</Text>
      </View>

      <View className="flex-row items-center justify-end gap-5">
        <TextButton label={t.common.cancel} onPress={onCancel} />
        <PrimaryButton icon="check" label={t.form.saveChanges} onPress={handleSave} />
      </View>
    </View>
  );
}
