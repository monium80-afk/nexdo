import { Feather, Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { ContextNoteCard, type ContextNoteCardHandle } from "@/components/ContextNoteCard";
import { GemLogo } from "@/components/GemLogo";
import { RecurrencePicker } from "@/components/RecurrencePicker";
import { TaskEditPanel, type TaskEditChanges, type TaskEditPanelHandle } from "@/components/TaskEditPanel";
import { DeadlineChip, DeadlineDatePicker } from "@/components/TaskFormFields";
import { colors } from "@/constants/theme";
import { useScreenEnterAnimation } from "@/hooks/useScreenEnterAnimation";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDuration } from "@/lib/formatDuration";
import { describeRule, type RecurrenceScope, type RuleInput } from "@/lib/recurrence";
import { getDueInfo } from "@/lib/taskMeta";
import { useTaskStore } from "@/store/useTaskStore";
import type { RecurrenceRule } from "@/types/task";

// Labels live in the translations (taskDetail.postpone).
const POSTPONE_OPTIONS = [
  { value: "oneDay", days: 1 },
  { value: "threeDays", days: 3 },
  { value: "oneWeek", days: 7 },
] as const;

function computePostponeDate(currentDueDate: string | undefined, days: number, now: Date): Date {
  const parsedDueDate = currentDueDate ? new Date(currentDueDate) : now;
  const base = new Date(Math.max(parsedDueDate.getTime(), now.getTime()));
  base.setDate(base.getDate() + days);
  return base;
}

/** The picker's own shape for a saved rule, so "Change" opens on what's there. */
function ruleToInput(rule: RecurrenceRule): RuleInput {
  return {
    frequency: rule.frequency,
    interval: rule.interval,
    weekdays: rule.weekdays,
    monthDay: rule.monthDay,
    endDate: rule.endDate,
  };
}

/**
 * Asks which occurrences a change reaches. The web build has no native alert
 * to ask with, so there it keeps to the safe default: this occurrence only.
 */
function chooseScope(
  title: string,
  body: string,
  options: { label: string; scope: RecurrenceScope; destructive?: boolean }[],
  cancelLabel: string,
  onChoose: (scope: RecurrenceScope) => void,
) {
  if (Platform.OS === "web") {
    onChoose("this");
    return;
  }
  Alert.alert(title, body, [
    { text: cancelLabel, style: "cancel" },
    ...options.map((option) => ({
      text: option.label,
      style: option.destructive ? ("destructive" as const) : ("default" as const),
      onPress: () => onChoose(option.scope),
    })),
  ]);
}

export default function TaskDetail() {
  const t = useTranslation();
  const rtl = useRtlText();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const task = useTaskStore((state) => state.tasks.find((t) => t.id === id));
  const updateTask = useTaskStore((state) => state.updateTask);
  const deleteTask = useTaskStore((state) => state.deleteTask);
  const completeStep = useTaskStore((state) => state.completeStep);
  const addSubtask = useTaskStore((state) => state.addSubtask);
  const updateSubtask = useTaskStore((state) => state.updateSubtask);
  const deleteSubtask = useTaskStore((state) => state.deleteSubtask);
  const setContextNotes = useTaskStore((state) => state.setContextNotes);
  const enterStyle = useScreenEnterAnimation();

  const [note, setNote] = useState("");
  const [subtaskDraft, setSubtaskDraft] = useState("");
  const [editing, setEditing] = useState(false);
  // The date picked on the "Custom Date..." calendar — null while that calendar is closed.
  const [customPostponeDate, setCustomPostponeDate] = useState<Date | null>(null);
  const [editingSubtaskId, setEditingSubtaskId] = useState<string | null>(null);
  const [editingSubtaskText, setEditingSubtaskText] = useState("");
  // The repeat being edited — undefined while the picker is closed.
  const [repeatDraft, setRepeatDraft] = useState<RuleInput | null | undefined>(undefined);
  const editPanelRef = useRef<TaskEditPanelHandle>(null);
  const noteCardRefs = useRef<(ContextNoteCardHandle | null)[]>([]);

  if (!task) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream[100] }}>
        <View className="flex-1 items-center justify-center gap-3 px-6">
          <Text className="text-title text-ink-cream">{t.taskDetail.notFound}</Text>
          <AnimatedPressable onPress={() => router.back()} className="btn btn--secondary-cream flex-row gap-2 px-6">
            <Feather name="arrow-left" size={16} color={colors.ink.cream} />
            <Text className="font-grotesk-semibold text-base text-ink-cream">{t.taskDetail.goBack}</Text>
          </AnimatedPressable>
        </View>
      </SafeAreaView>
    );
  }

  const due = getDueInfo(task);
  const contextNotes = task.aiContext.notes;
  const orderedSubtasks = task.subtasks?.slice().sort((a, b) => a.order - b.order) ?? [];
  const completedSubtaskCount = orderedSubtasks.filter((subtask) => subtask.status === "completed").length;

  const handlePostpone = (days: number) => {
    const nextDate = computePostponeDate(task.dueDate, days, new Date());
    updateTask(task.id, { dueDate: nextDate.toISOString() });
    setCustomPostponeDate(null);
  };

  const handleToggleCustomPostpone = () => {
    // The calendar opens on the day after the current deadline, same as "+1 Day".
    setCustomPostponeDate(customPostponeDate ? null : computePostponeDate(task.dueDate, 1, new Date()));
  };

  const handleCustomPostpone = () => {
    if (!customPostponeDate) return;
    updateTask(task.id, { dueDate: customPostponeDate.toISOString() });
    setCustomPostponeDate(null);
  };

  // A repeating task asks whether later occurrences should follow — unless
  // nothing actually changed, which there's no point asking about.
  const handleSaveEdit = (changes: TaskEditChanges) => {
    setEditing(false);
    const changed =
      (changes.title !== undefined && changes.title !== task.title) ||
      (changes.estimatedMinutes !== undefined && changes.estimatedMinutes !== task.estimatedMinutes) ||
      changes.dueDate !== undefined;
    if (!changed) return;
    if (!task.recurrence || task.status !== "pending") {
      updateTask(task.id, changes);
      return;
    }
    chooseScope(
      t.taskDetail.editScopeTitle,
      t.taskDetail.editScopeBody,
      [
        { label: t.taskDetail.scopeThis, scope: "this" },
        { label: t.taskDetail.scopeFuture, scope: "future" },
      ],
      t.common.cancel,
      (scope) => updateTask(task.id, changes, scope),
    );
  };

  const handleSaveRepeat = () => {
    if (repeatDraft === undefined) return;
    updateTask(task.id, { recurrence: repeatDraft });
    setRepeatDraft(undefined);
  };

  const handleStopRepeating = () => {
    const stop = () => updateTask(task.id, { recurrence: null });
    if (Platform.OS === "web") {
      stop();
      return;
    }
    Alert.alert(t.taskDetail.stopRepeatingTitle, t.taskDetail.stopRepeatingBody, [
      { text: t.common.cancel, style: "cancel" },
      { text: t.taskDetail.stopRepeating, style: "destructive", onPress: stop },
    ]);
  };

  const handleAddSubtask = () => {
    const trimmed = subtaskDraft.trim();
    if (!trimmed) return;
    addSubtask(task.id, trimmed);
    setSubtaskDraft("");
  };

  const handleStartEditSubtask = (subtaskId: string, label: string) => {
    setEditingSubtaskId(subtaskId);
    setEditingSubtaskText(label);
  };

  const handleSaveSubtask = () => {
    if (!editingSubtaskId || !editingSubtaskText.trim()) return;
    updateSubtask(task.id, editingSubtaskId, editingSubtaskText);
    setEditingSubtaskId(null);
  };

  const handleSendNote = () => {
    const trimmed = note.trim();
    if (!trimmed) return;
    setContextNotes(task.id, [...contextNotes, trimmed]);
    setNote("");
  };

  const handleUpdateNote = (index: number, text: string) => {
    setContextNotes(
      task.id,
      contextNotes.map((entry, entryIndex) => (entryIndex === index ? text : entry)),
    );
  };

  const handleDeleteNote = (index: number) => {
    setContextNotes(
      task.id,
      contextNotes.filter((_, entryIndex) => entryIndex !== index),
    );
  };

  // Most edits on this page apply right away. This also saves anything still
  // being typed — the edit panel, a subtask, a note — then closes the page.
  const handleSaveChanges = () => {
    // A missing title or a bad duration keeps the page open so the panel can show the error.
    if (editPanelRef.current && !editPanelRef.current.save()) return;

    if (editingSubtaskId && editingSubtaskText.trim()) updateSubtask(task.id, editingSubtaskId, editingSubtaskText);
    if (subtaskDraft.trim()) addSubtask(task.id, subtaskDraft);

    const savedNotes = contextNotes.map((entry, index) => noteCardRefs.current[index]?.pendingNote() ?? entry);
    if (note.trim()) savedNotes.push(note.trim());
    if (savedNotes.some((entry, index) => entry !== contextNotes[index])) setContextNotes(task.id, savedNotes);

    router.back();
  };

  const handleDelete = () => {
    // A repeating task: skip just this one (the next takes its place), or the lot.
    if (task.recurrence && task.status === "pending") {
      chooseScope(
        t.taskDetail.deleteScopeTitle,
        t.taskDetail.deleteScopeBody,
        [
          { label: t.taskDetail.deleteThisOccurrence, scope: "this", destructive: true },
          { label: t.taskDetail.deleteWholeSeries, scope: "series", destructive: true },
        ],
        t.common.cancel,
        (scope) => {
          deleteTask(task.id, scope);
          router.back();
        },
      );
      return;
    }
    Alert.alert(t.taskDetail.deleteConfirmTitle, t.taskDetail.deleteConfirmBody, [
      { text: t.common.cancel, style: "cancel" },
      {
        text: t.common.delete,
        style: "destructive",
        onPress: () => {
          deleteTask(task.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream[100] }} edges={["top"]}>
      <View className="gap-2.5 border-b border-cream-300 bg-cream-100 px-5 pb-4 pt-2">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <GemLogo size={18} />
            <Text className="eyebrow text-ink-cream">{t.taskDetail.eyebrow}</Text>
          </View>
          <AnimatedPressable onPress={() => router.back()} hitSlop={8} className="h-9 w-9 items-center justify-center">
            <Feather name="x" size={22} color={colors.ink.cream} />
          </AnimatedPressable>
        </View>
        <View className="flex-row flex-wrap items-center gap-2">
          <View className="flex-row items-center gap-1.5 rounded-2xl border border-orange-500 px-3 py-1.5">
            <GemLogo size={12} />
            <Text className="font-grotesk-semibold text-xs text-orange-600">
              {t.taskDetail.scoreLabel}
              <Text className="font-grotesk-bold">{task.priorityScore}</Text>
            </Text>
          </View>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          style={{ backgroundColor: colors.cream[100] }}
          contentContainerStyle={{ padding: 24, paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View style={[{ gap: 22 }, enterStyle]}>
          <View className="gap-4 rounded-2xl bg-cream-200 p-5">
            <View className="flex-row items-start gap-3">
              <View className="h-10 w-10 items-center justify-center rounded-full bg-cream-300">
                <Feather name="calendar" size={18} color={colors.orange[500]} />
              </View>
              <View className="flex-1 gap-1">
                <Text className="font-grotesk-bold text-sm text-ink-cream" style={rtl}>
                  {t.taskDetail.postponeTitle}
                </Text>
                <Text className="font-grotesk-regular text-xs text-ink-cream-muted" style={rtl}>
                  {t.taskDetail.currentDeadline(due.label)}
                </Text>
              </View>
            </View>
            <View className="flex-row flex-wrap gap-2">
              {POSTPONE_OPTIONS.map((option) => (
                <DeadlineChip
                  key={option.value}
                  label={t.taskDetail.postpone[option.value]}
                  selected={false}
                  onPress={() => handlePostpone(option.days)}
                />
              ))}
              <DeadlineChip
                label={t.taskDetail.customDate}
                selected={customPostponeDate !== null}
                onPress={handleToggleCustomPostpone}
              />
            </View>
            {customPostponeDate ? (
              <View className="gap-2">
                <DeadlineDatePicker value={customPostponeDate} onChange={setCustomPostponeDate} />
                <AnimatedPressable
                  onPress={handleCustomPostpone}
                  className="self-start rounded-2xl bg-orange-500 px-4 py-1.5"
                >
                  <Text className="font-grotesk-semibold text-xs text-cream-50">{t.taskDetail.setDate}</Text>
                </AnimatedPressable>
              </View>
            ) : null}
          </View>

          {editing ? (
            <TaskEditPanel
              ref={editPanelRef}
              task={task}
              onSave={handleSaveEdit}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <>
              <View className="flex-row items-start justify-between gap-3">
                <Text className="flex-1 text-title text-ink-cream" style={rtl}>
                  {task.title}
                </Text>
                <AnimatedPressable
                  onPress={() => setEditing(true)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t.taskDetail.editTask}
                  className="pt-1"
                >
                  <Feather name="edit-2" size={18} color={colors.ink.creamMuted} />
                </AnimatedPressable>
              </View>

              <View className="flex-row flex-wrap gap-2">
                <View className="flex-row items-center gap-1.5 rounded-xl bg-cream-200 px-3 py-1.5">
                  <Feather name="calendar" size={13} color={colors.ink.creamMuted} />
                  <Text className="font-grotesk-medium text-xs text-ink-cream">{t.taskDetail.due(due.label)}</Text>
                </View>
                <View className="flex-row items-center gap-1.5 rounded-xl bg-cream-200 px-3 py-1.5">
                  <Feather name="clock" size={13} color={colors.orange[500]} />
                  <Text className="font-grotesk-semibold text-xs text-orange-600">
                    {t.taskDetail.estimate(formatDuration(task.estimatedMinutes))}
                  </Text>
                </View>
              </View>
            </>
          )}

          <View className="gap-3 rounded-2xl border border-cream-300 bg-cream-50 p-4">
            <View className="flex-row items-center justify-between gap-3">
              <View className="flex-row items-center gap-2">
                <Feather name="repeat" size={14} color={colors.orange[500]} />
                <Text className="eyebrow text-ink-cream">{t.taskDetail.repeatEyebrow}</Text>
              </View>
              {repeatDraft === undefined ? (
                <AnimatedPressable
                  onPress={() => setRepeatDraft(task.recurrence ? ruleToInput(task.recurrence.rule) : null)}
                  hitSlop={8}
                  accessibilityRole="button"
                >
                  <Text className="font-grotesk-semibold text-sm text-orange-500">
                    {task.recurrence ? t.taskDetail.editRepeat : t.taskDetail.setRepeat}
                  </Text>
                </AnimatedPressable>
              ) : null}
            </View>

            {repeatDraft === undefined ? (
              task.recurrence ? (
                <View className="gap-1">
                  <Text className="font-grotesk-semibold text-sm text-ink-cream" style={rtl}>
                    {describeRule(task.recurrence.rule, t)}
                  </Text>
                  {task.status === "pending" ? (
                    <Text className="font-grotesk-regular text-xs text-ink-cream-muted" style={rtl}>
                      {t.taskDetail.occurrenceNote}
                    </Text>
                  ) : null}
                  {task.status === "pending" ? (
                    <AnimatedPressable onPress={handleStopRepeating} hitSlop={8} className="mt-1 self-start">
                      <Text className="font-grotesk-semibold text-sm text-overdue-500">{t.taskDetail.stopRepeating}</Text>
                    </AnimatedPressable>
                  ) : null}
                </View>
              ) : (
                <Text className="font-grotesk-regular text-xs text-ink-cream-muted" style={rtl}>
                  {t.taskDetail.notRepeating}
                </Text>
              )
            ) : (
              <View className="gap-3">
                <RecurrencePicker value={repeatDraft} onChange={setRepeatDraft} dueDate={task.dueDate} />
                <View className="flex-row items-center justify-end gap-4">
                  <AnimatedPressable onPress={() => setRepeatDraft(undefined)} hitSlop={8} className="px-2 py-2">
                    <Text className="font-grotesk-semibold text-sm text-ink-cream-muted">{t.common.cancel}</Text>
                  </AnimatedPressable>
                  <AnimatedPressable onPress={handleSaveRepeat} className="btn btn--primary flex-row gap-2 px-5 py-2.5">
                    <Feather name="check" size={15} color={colors.cream[50]} />
                    <Text className="font-grotesk-bold text-sm text-cream-50">{t.taskDetail.saveRepeat}</Text>
                  </AnimatedPressable>
                </View>
              </View>
            )}
          </View>

          <View className="gap-3">
            <Text className="font-grotesk-medium text-sm text-ink-cream-muted">
              {t.taskDetail.subtasks(completedSubtaskCount, orderedSubtasks.length)}
            </Text>

            {orderedSubtasks.length > 0 ? (
              <View className="gap-2">
                {orderedSubtasks.map((subtask) => {
                  const done = subtask.status === "completed";

                  if (editingSubtaskId === subtask.id) {
                    return (
                      <View
                        key={subtask.id}
                        className="flex-row items-center gap-2 rounded-2xl border border-orange-500 bg-cream-50 py-1.5 pl-4 pr-1.5"
                      >
                        <TextInput
                          value={editingSubtaskText}
                          onChangeText={setEditingSubtaskText}
                          onSubmitEditing={handleSaveSubtask}
                          returnKeyType="done"
                          autoFocus
                          style={rtl}
                          className="flex-1 py-2 font-grotesk-semibold text-sm text-ink-cream"
                        />
                        <AnimatedPressable
                          onPress={() => setEditingSubtaskId(null)}
                          hitSlop={6}
                          accessibilityRole="button"
                          accessibilityLabel={t.common.cancel}
                          className="h-9 w-9 items-center justify-center"
                        >
                          <Feather name="x" size={17} color={colors.ink.creamMuted} />
                        </AnimatedPressable>
                        <AnimatedPressable
                          onPress={handleSaveSubtask}
                          disabled={!editingSubtaskText.trim()}
                          accessibilityRole="button"
                          accessibilityLabel={t.common.save}
                          className="h-9 w-9 items-center justify-center rounded-xl bg-orange-500"
                        >
                          <Feather name="check" size={17} color={colors.cream[50]} />
                        </AnimatedPressable>
                      </View>
                    );
                  }

                  return (
                    <View key={subtask.id} className="flex-row items-center gap-1 rounded-2xl bg-cream-200 py-1.5 pl-4 pr-1.5">
                      <AnimatedPressable
                        // Any step, in any order, and ticking a finished one
                        // puts it back — the same contract completeStep itself
                        // documents, and what the session checklist and the AI
                        // Breakdown sheet already allow. Only the task being
                        // open still matters.
                        onPress={() => {
                          if (task.status === "pending") completeStep(task.id, subtask.id);
                        }}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: done, disabled: task.status !== "pending" }}
                        className="flex-1 flex-row items-center gap-3 py-2"
                      >
                        <View
                          className={
                            done
                              ? "h-6 w-6 items-center justify-center rounded-lg bg-orange-500"
                              : "h-6 w-6 rounded-lg border-2 border-cream-300"
                          }
                        >
                          {done ? <Feather name="check" size={14} color={colors.cream[50]} /> : null}
                        </View>
                        <Text
                          style={rtl}
                          className={
                            done
                              ? "flex-1 font-grotesk-medium text-sm text-ink-cream-muted line-through"
                              : "flex-1 font-grotesk-semibold text-sm text-ink-cream"
                          }
                        >
                          {subtask.label}
                        </Text>
                      </AnimatedPressable>
                      <AnimatedPressable
                        onPress={() => handleStartEditSubtask(subtask.id, subtask.label)}
                        hitSlop={4}
                        accessibilityRole="button"
                        accessibilityLabel={t.taskDetail.editSubtask(subtask.label)}
                        className="h-9 w-9 items-center justify-center"
                      >
                        <Feather name="edit-2" size={15} color={colors.ink.creamMuted} />
                      </AnimatedPressable>
                      <AnimatedPressable
                        onPress={() =>
                          Alert.alert(t.taskDetail.deleteConfirmTitle, t.taskDetail.deleteConfirmBody, [
                            { text: t.common.cancel, style: "cancel" },
                            {
                              text: t.common.delete,
                              style: "destructive",
                              onPress: () => deleteSubtask(task.id, subtask.id),
                            },
                          ])
                        }
                        hitSlop={4}
                        accessibilityRole="button"
                        accessibilityLabel={t.taskDetail.deleteSubtask(subtask.label)}
                        className="h-9 w-9 items-center justify-center"
                      >
                        <Feather name="trash-2" size={15} color={colors.ink.creamMuted} />
                      </AnimatedPressable>
                    </View>
                  );
                })}
              </View>
            ) : null}

            <View className="flex-row items-center gap-2">
              <TextInput
                value={subtaskDraft}
                onChangeText={setSubtaskDraft}
                onSubmitEditing={handleAddSubtask}
                placeholder={t.taskDetail.addSubtask}
                placeholderTextColor={colors.ink.creamMuted}
                returnKeyType="done"
                style={rtl}
                className="flex-1 rounded-2xl border border-cream-300 bg-cream-50 px-4 py-3 font-grotesk-regular text-sm text-ink-cream"
              />
              <AnimatedPressable
                onPress={handleAddSubtask}
                disabled={!subtaskDraft.trim()}
                className="h-11 w-11 items-center justify-center rounded-2xl"
                style={{ backgroundColor: subtaskDraft.trim() ? colors.charcoal[600] : colors.cream[300] }}
              >
                <Feather name="plus" size={18} color={colors.ink.charcoal} />
              </AnimatedPressable>
            </View>
          </View>

          {task.notes ? (
            <View className="gap-2">
              <Text className="eyebrow text-ink-cream" style={rtl}>
                {t.taskDetail.notes}
              </Text>
              <Text className="text-body text-ink-cream-muted" style={rtl}>
                {task.notes}
              </Text>
            </View>
          ) : null}

          <View className="gap-3 rounded-2xl border border-cream-300 bg-cream-50 p-4">
            <View className="flex-row items-center gap-2">
              <Ionicons name="sparkles" size={16} color={colors.orange[500]} />
              <Text className="eyebrow text-ink-cream">{t.taskDetail.contextTitle}</Text>
            </View>
            <Text className="font-grotesk-regular text-xs text-ink-cream-muted" style={rtl}>
              {t.taskDetail.contextBody}
            </Text>
            {contextNotes.map((entry, index) => (
              <ContextNoteCard
                key={`${index}-${entry}`}
                ref={(card) => {
                  noteCardRefs.current[index] = card;
                }}
                note={entry}
                onSave={(text) => handleUpdateNote(index, text)}
                onDelete={() => handleDeleteNote(index)}
              />
            ))}
            <View className="flex-row items-end gap-2 rounded-2xl border border-cream-300 bg-cream-100 px-4 py-2.5">
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder={t.taskDetail.contextPlaceholder}
                placeholderTextColor={colors.ink.creamMuted}
                multiline
                style={[{ textAlignVertical: "top", maxHeight: 120 }, rtl]}
                className="flex-1 font-grotesk-regular text-sm text-ink-cream"
              />
              <AnimatedPressable onPress={handleSendNote} hitSlop={8} disabled={!note.trim()}>
                <Feather
                  name="send"
                  size={18}
                  color={note.trim() ? colors.orange[500] : colors.ink.creamMuted}
                />
              </AnimatedPressable>
            </View>
          </View>
          </Animated.View>
        </ScrollView>

        <View className="flex-row items-center justify-between border-t border-cream-300 bg-cream-50 px-6 py-4">
          <AnimatedPressable onPress={handleDelete} hitSlop={8} className="flex-row items-center gap-2">
            <Feather name="trash-2" size={17} color={colors.overdue[500]} />
            <Text className="font-grotesk-semibold text-sm text-overdue-500">{t.taskDetail.deleteTask}</Text>
          </AnimatedPressable>
          <AnimatedPressable onPress={handleSaveChanges} className="btn btn--primary flex-row gap-2 px-6 py-3">
            <Feather name="check" size={16} color={colors.cream[50]} />
            <Text className="font-grotesk-bold text-sm text-cream-50">{t.taskDetail.saveChanges}</Text>
          </AnimatedPressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
