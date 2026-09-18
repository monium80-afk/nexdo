import { Feather, Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { ContextNoteCard, type ContextNoteCardHandle } from "@/components/ContextNoteCard";
import { GemLogo } from "@/components/GemLogo";
import { TaskEditPanel, type TaskEditChanges, type TaskEditPanelHandle } from "@/components/TaskEditPanel";
import { DeadlineChip, DeadlineDatePicker } from "@/components/TaskFormFields";
import { colors } from "@/constants/theme";
import { useScreenEnterAnimation } from "@/hooks/useScreenEnterAnimation";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDuration } from "@/lib/formatDuration";
import { getDueInfo } from "@/lib/taskMeta";
import { useCategory } from "@/store/useCategoryStore";
import { useTaskStore } from "@/store/useTaskStore";

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

export default function TaskDetail() {
  const t = useTranslation();
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
  const category = useCategory(task?.category ?? "");
  const enterStyle = useScreenEnterAnimation();

  const [note, setNote] = useState("");
  const [subtaskDraft, setSubtaskDraft] = useState("");
  const [editing, setEditing] = useState(false);
  // The date picked on the "Custom Date..." calendar — null while that calendar is closed.
  const [customPostponeDate, setCustomPostponeDate] = useState<Date | null>(null);
  const [editingSubtaskId, setEditingSubtaskId] = useState<string | null>(null);
  const [editingSubtaskText, setEditingSubtaskText] = useState("");
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

  const handleSaveEdit = (changes: TaskEditChanges) => {
    updateTask(task.id, changes);
    setEditing(false);
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
                <Text className="font-grotesk-bold text-sm text-ink-cream">{t.taskDetail.postponeTitle}</Text>
                <Text className="font-grotesk-regular text-xs text-ink-cream-muted">
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
                <Text className="flex-1 text-title text-ink-cream">{task.title}</Text>
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
                <View className="flex-row items-center gap-1.5 rounded-xl border border-cream-300 px-3 py-1.5">
                  <Feather name="folder" size={13} color={colors.ink.creamMuted} />
                  <Text className="font-grotesk-medium text-xs text-ink-cream">{category.label}</Text>
                </View>
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
                        onPress={() => task.status === "pending" && subtask.status === "current" && completeStep(task.id, subtask.id)}
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
              <Text className="eyebrow text-ink-cream">{t.taskDetail.notes}</Text>
              <Text className="text-body text-ink-cream-muted">{task.notes}</Text>
            </View>
          ) : null}

          <View className="gap-3 rounded-2xl border border-cream-300 bg-cream-50 p-4">
            <View className="flex-row items-center gap-2">
              <Ionicons name="sparkles" size={16} color={colors.orange[500]} />
              <Text className="eyebrow text-ink-cream">{t.taskDetail.contextTitle}</Text>
            </View>
            <Text className="font-grotesk-regular text-xs text-ink-cream-muted">{t.taskDetail.contextBody}</Text>
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
                style={{ textAlignVertical: "top", maxHeight: 120 }}
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
