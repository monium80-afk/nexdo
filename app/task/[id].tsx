import { useAuth } from "@clerk/expo";
import { Feather, Ionicons } from "@expo/vector-icons";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { AddItemField } from "@/components/AddItemField";
import { IconButton, PrimaryButton, SecondaryButton, TextButton } from "@/components/Button";
import { ChecklistRow } from "@/components/ChecklistRow";
import { Chip } from "@/components/Chip";
import { ContextNoteCard, type ContextNoteCardHandle } from "@/components/ContextNoteCard";
import { EmptyState } from "@/components/EmptyState";
import { GemLogo } from "@/components/GemLogo";
import { HighlightedText } from "@/components/HighlightedText";
import { MetaPill } from "@/components/MetaPill";
import { ReassessmentNotice } from "@/components/ReassessmentNotice";
import { RecurrencePicker } from "@/components/RecurrencePicker";
import { ScreenHeader } from "@/components/ScreenHeader";
import { SectionHeader } from "@/components/SectionHeader";
import { TaskEditPanel, type TaskEditChanges, type TaskEditPanelHandle } from "@/components/TaskEditPanel";
import { DeadlineDatePicker, deadlineToDraft, draftToDeadline, type DeadlineDraft } from "@/components/TaskFormFields";
import { TextField } from "@/components/TextField";
import { listItemEntering, listItemLayout } from "@/constants/theme";
import { useScreenEnterAnimation } from "@/hooks/useScreenEnterAnimation";
import { useRtlText } from "@/hooks/useRtlText";
import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { showAlert } from "@/lib/alert";
import { formatDeadline, type DeadlineInput } from "@/lib/deadline";
import { formatDuration } from "@/lib/formatDuration";
import { addDaysToKey, toLocalDateKey } from "@/lib/localDate";
import { showPlanLimit } from "@/lib/paywall";
import { summarizePlan } from "@/lib/planning";
import { describeRule, type RecurrenceScope, type RuleInput } from "@/lib/recurrence";
import type { Translations } from "@/lib/i18n";
import { nextReminderFor, type ReminderPreferences } from "@/lib/reminders";
import { getDueInfo } from "@/lib/taskMeta";
import { useReassessStore } from "@/store/useReassessStore";
import { reminderPreferences, useSettingsStore } from "@/store/useSettingsStore";
import { useTaskStore } from "@/store/useTaskStore";
import type { RecurrenceRule, Task } from "@/types/task";

// Labels live in the translations (taskDetail.postpone).
const POSTPONE_OPTIONS = [
  { value: "oneDay", days: 1 },
  { value: "threeDays", days: 3 },
  { value: "oneWeek", days: 7 },
] as const;

/**
 * The deadline `days` after the current one — or after today, when it's
 * already behind us or there is none. It keeps its time if it has one, and
 * stays date-only if it doesn't.
 */
function postponeDeadline(task: Task, days: number, now: Date): DeadlineInput {
  const today = toLocalDateKey(now);
  const current = task.deadline && task.dueDate && Date.parse(task.dueDate) > now.getTime() ? task.deadline.date : today;
  return { date: addDaysToKey(current > today ? current : today, days), time: task.deadline?.time };
}

/** The picker's own shape for a saved rule, so "Change" opens on what's there. */
function ruleToInput(rule: RecurrenceRule): RuleInput {
  return {
    frequency: rule.frequency,
    interval: rule.interval,
    weekdays: rule.weekdays,
    monthDay: rule.monthDay,
    endDate: rule.endDate,
    missed: rule.missed,
  };
}

/** "Today", "Tomorrow", or a short weekday and date — for a step's suggested day. */
function dayLabel(date: string, today: string, t: Translations): string {
  if (date === today) return t.taskDetail.today;
  if (date === addDaysToKey(today, 1)) return t.taskDetail.tomorrow;
  return formatDeadline({ date }, t.locale);
}

/**
 * Asks which occurrences a change reaches. A browser's dialog can only say
 * yes or no (lib/alert.ts), so the web build keeps to the safe default: this
 * occurrence only.
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
  showAlert(title, body, [
    { text: cancelLabel, style: "cancel" },
    ...options.map((option) => ({
      text: option.label,
      style: option.destructive ? ("destructive" as const) : ("default" as const),
      onPress: () => onChoose(option.scope),
    })),
  ]);
}

export default function TaskDetail() {
  const colors = useColors();
  useStatusBarStyle("light");
  const t = useTranslation();
  const rtl = useRtlText();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isLoaded, isSignedIn } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const task = useTaskStore((state) => state.tasks.find((t) => t.id === id));
  const updateTask = useTaskStore((state) => state.updateTask);
  const deleteTask = useTaskStore((state) => state.deleteTask);
  const completeStep = useTaskStore((state) => state.completeStep);
  const addSubtask = useTaskStore((state) => state.addSubtask);
  const updateSubtask = useTaskStore((state) => state.updateSubtask);
  const deleteSubtask = useTaskStore((state) => state.deleteSubtask);
  const setContextNotes = useTaskStore((state) => state.setContextNotes);
  const restoreTask = useTaskStore((state) => state.restoreTask);
  // As a string, so the page re-renders when a reminder setting changes but not on every store write.
  const reminderPrefsKey = useSettingsStore((state) => JSON.stringify(reminderPreferences(state)));
  // What Nexdo made of the latest note. Lives in a store, not here, so a
  // reassessment that finishes after the user has left still has its report
  // waiting when they come back.
  const reassess = useReassessStore((state) => (id ? state.byTask[id] : undefined));
  const submitContext = useReassessStore((state) => state.submit);
  const retryContext = useReassessStore((state) => state.retry);
  const dismissContext = useReassessStore((state) => state.dismiss);
  const enterStyle = useScreenEnterAnimation();

  // A note that ran into the end of the month's AI messages: the notice under
  // it says so, and on Free the paywall opens too — once, as it happens, not
  // every time this page is opened with the note still waiting.
  const noteHitLimit = reassess?.status === "error" && reassess.reason === "limit";
  const noteHadHitLimit = useRef(noteHitLimit);
  useEffect(() => {
    if (noteHitLimit && !noteHadHitLimit.current) showPlanLimit("chat", true);
    noteHadHitLimit.current = noteHitLimit;
  }, [noteHitLimit]);

  const [note, setNote] = useState("");
  const [subtaskDraft, setSubtaskDraft] = useState("");
  const [editing, setEditing] = useState(false);
  // The date picked on the "Custom Date..." calendar — null while that calendar is closed.
  const [customPostponeDate, setCustomPostponeDate] = useState<DeadlineDraft | null>(null);
  const [editingSubtaskId, setEditingSubtaskId] = useState<string | null>(null);
  const [editingSubtaskText, setEditingSubtaskText] = useState("");
  // The repeat being edited — undefined while the picker is closed.
  const [repeatDraft, setRepeatDraft] = useState<RuleInput | null | undefined>(undefined);
  const editPanelRef = useRef<TaskEditPanelHandle>(null);
  const noteCardRefs = useRef<(ContextNoteCardHandle | null)[]>([]);
  const scrollRef = useRef<ScrollView>(null);

  // When a reassessment the user is waiting on finishes, bring its report
  // into view — the context card is the last thing on the page. Only on that
  // change, not on opening the page with an older report already there.
  const reassessStatus = reassess?.status;
  const previousStatus = useRef(reassessStatus);
  useEffect(() => {
    const finished = previousStatus.current === "running" && reassessStatus !== "running";
    previousStatus.current = reassessStatus;
    if (!finished) return;
    // A frame for the report to lay out, so "the end" includes it.
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(timer);
  }, [reassessStatus]);

  // A direct link skips the tabs' sign-in check, and signing out leaves
  // unsaved tasks on the phone — so this page checks for itself.
  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/onboarding" />;

  if (!task) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream[100] }}>
        <View className="flex-1 justify-center px-6">
          <EmptyState icon="alert-circle" title={t.taskDetail.notFound}>
            <SecondaryButton icon="arrow-left" label={t.taskDetail.goBack} onPress={() => router.back()} className="mt-2" />
          </EmptyState>
        </View>
      </SafeAreaView>
    );
  }

  const now = new Date();
  const due = getDueInfo(task);
  const isOverdue = due.tone === "overdue";
  const contextNotes = task.aiContext.notes;
  const reassessing = reassess?.status === "running";
  const orderedSubtasks = task.subtasks?.slice().sort((a, b) => a.order - b.order) ?? [];
  const completedSubtaskCount = orderedSubtasks.filter((subtask) => subtask.status === "completed").length;
  const isOpen = task.status === "pending";
  const isSkipped = task.status === "skipped";

  // The reminder is its own thing, not the deadline: "Oct 15" with a 9:00
  // reminder is still due Oct 15, not at 9:00.
  const reminderPrefs = JSON.parse(reminderPrefsKey) as ReminderPreferences;
  const reminderAt = nextReminderFor(task, reminderPrefs, now, t);
  const reminderLine = !task.deadline
    ? t.taskDetail.reminderNoDeadline
    : task.reminders?.muted
      ? t.taskDetail.reminderMuted
      : !reminderPrefs.deadlineReminders
        ? t.taskDetail.reminderOffInSettings
        : reminderAt
          ? t.taskDetail.reminderAt(
              new Date(reminderAt).toLocaleString(t.locale, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
            )
          : t.taskDetail.reminderNoneLeft;

  // How the plan stands, and a day to aim for with each step left — worked
  // out from the task as it is, so it follows every tick and deadline change.
  const plan = summarizePlan(task, now);
  const today = toLocalDateKey(now);
  const suggestedDays = new Map(
    plan && plan.pace === "scheduled" && (plan.daysLeft ?? 0) > 1 ? plan.suggestions.map((entry) => [entry.stepId, entry.date]) : [],
  );
  const planCaption = plan && plan.openSteps > 0 && isOpen
    ? [
        t.taskDetail.planLeft(plan.openSteps, formatDuration(plan.remainingMinutes)),
        plan.pace === "overdue"
          ? t.taskDetail.planOverdue
          : plan.pace === "scheduled" && task.deadline
            ? t.taskDetail.planPerDay(formatDuration(plan.minutesPerDay ?? 0), formatDeadline({ date: task.deadline.date }, t.locale))
            : "",
      ]
        .filter(Boolean)
        .join(" ")
    : null;

  const handlePostpone = (days: number) => {
    updateTask(task.id, { deadline: postponeDeadline(task, days, new Date()) });
    setCustomPostponeDate(null);
  };

  const handleToggleCustomPostpone = () => {
    // The calendar opens on the day after the current deadline, same as "+1 Day".
    setCustomPostponeDate(customPostponeDate ? null : deadlineToDraft(postponeDeadline(task, 1, new Date())));
  };

  const handleCustomPostpone = () => {
    if (!customPostponeDate) return;
    updateTask(task.id, { deadline: draftToDeadline(customPostponeDate) });
    setCustomPostponeDate(null);
  };

  // A repeating task asks whether later occurrences should follow — unless
  // nothing actually changed, which there's no point asking about. The panel
  // stays open until that's answered: cancelling the question cancels the
  // save, not the edits. `onSaved` runs once the changes are in.
  const handleSaveEdit = (changes: TaskEditChanges, onSaved?: () => void) => {
    const done = () => {
      setEditing(false);
      onSaved?.();
    };
    const changed =
      (changes.title !== undefined && changes.title !== task.title) ||
      (changes.estimatedMinutes !== undefined && changes.estimatedMinutes !== task.estimatedMinutes) ||
      changes.deadline !== undefined;
    if (!changed) {
      done();
      return;
    }
    if (!task.recurrence || task.status !== "pending") {
      updateTask(task.id, changes);
      done();
      return;
    }
    chooseScope(
      t.taskDetail.editScopeTitle,
      t.taskDetail.editScopeBody,
      [
        { label: t.taskDetail.scopeThis, scope: "this" },
        { label: t.taskDetail.scopeFuture, scope: "future" },
        // Also renames / re-rates the completed ones, so the history reads the same.
        { label: t.taskDetail.scopeSeries, scope: "series" },
      ],
      t.common.cancel,
      (scope) => {
        updateTask(task.id, changes, scope);
        done();
      },
    );
  };

  const handleSaveRepeat = () => {
    if (repeatDraft === undefined) return;
    updateTask(task.id, { recurrence: repeatDraft });
    setRepeatDraft(undefined);
  };

  const handleStopRepeating = () => {
    const stop = () => updateTask(task.id, { recurrence: null });
    showAlert(t.taskDetail.stopRepeatingTitle, t.taskDetail.stopRepeatingBody, [
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

  // A note isn't just filed: Nexdo reassesses the whole task for it, saves
  // the note together with whatever that changes, and reports back in the
  // notice above the box. The box clears right away — the notice shows the
  // note while it's being worked on, and keeps it if anything fails.
  const handleSendNote = () => {
    const trimmed = note.trim();
    if (!trimmed || reassessing) return;
    setNote("");
    Keyboard.dismiss();
    submitContext(task.id, { text: trimmed });
  };

  // An edited note is new context too — it replaces the old one once Nexdo has reassessed for it.
  const handleUpdateNote = (index: number, text: string) => {
    submitContext(task.id, { text, replacesNote: contextNotes[index] });
  };

  const handleDeleteNote = (index: number) => {
    setContextNotes(
      task.id,
      contextNotes.filter((_, entryIndex) => entryIndex !== index),
    );
  };

  // Most edits on this page apply right away. This also saves anything still
  // being typed — the edit panel, a subtask — then closes the page. A note
  // still being typed is sent to Nexdo instead, and the page stays open so
  // the user sees what it changed before leaving.
  const handleSaveChanges = () => {
    // The edit panel goes first. A missing title or a bad duration keeps the
    // page open so the panel can show the error, and a repeating task waits
    // on which occurrences to change — cancelling that keeps it open too.
    if (editPanelRef.current) {
      editPanelRef.current.save(saveRestAndClose);
      return;
    }
    saveRestAndClose();
  };

  const saveRestAndClose = () => {
    if (editingSubtaskId && editingSubtaskText.trim()) updateSubtask(task.id, editingSubtaskId, editingSubtaskText);
    if (subtaskDraft.trim()) addSubtask(task.id, subtaskDraft);

    const editedNote = contextNotes
      .map((entry, index) => ({ index, text: noteCardRefs.current[index]?.pendingNote() }))
      .find((edit) => edit.text && edit.text !== contextNotes[edit.index]);
    if (note.trim() || editedNote) {
      setEditingSubtaskId(null);
      setSubtaskDraft("");
      if (note.trim()) handleSendNote();
      else if (editedNote?.text) handleUpdateNote(editedNote.index, editedNote.text);
      return;
    }

    router.back();
  };

  const handleDelete = () => {
    const repeating = Boolean(task.recurrence) && task.status === "pending";
    // A browser's dialog can only say yes or no (lib/alert.ts), so the web
    // build asks that — and only ever deletes this occurrence of a repeating
    // task, the safe default.
    if (Platform.OS === "web") {
      if (!window.confirm(`${t.taskDetail.deleteConfirmTitle}\n\n${t.taskDetail.deleteConfirmBody}`)) return;
      deleteTask(task.id, repeating ? "this" : undefined);
      router.back();
      return;
    }
    // A repeating task: skip just this one (the next takes its place), or the lot.
    if (repeating) {
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
    showAlert(t.taskDetail.deleteConfirmTitle, t.taskDetail.deleteConfirmBody, [
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
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.charcoal[900] }} edges={["top"]}>
      {/* The Tasks page's header, for one task: its title and actions, then
          its deadline, length and score as the line of summary. */}
      <ScreenHeader
        title={task.title}
        actions={
          <>
            {editing ? null : (
              <IconButton
                icon="edit-2"
                variant="header"
                onPress={() => setEditing(true)}
                accessibilityLabel={t.taskDetail.editTask}
              />
            )}
            <IconButton icon="x" variant="header" onPress={() => router.back()} accessibilityLabel={t.common.close} />
          </>
        }
      >
        <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1.5">
          <MetaPill
            icon={<Feather name="calendar" size={14} color={isOverdue ? colors.overdue[300] : colors.ink.charcoalMuted} />}
            label={due.pillLabel}
            labelClassName={
              isOverdue ? "font-grotesk-semibold text-sm text-overdue-300" : "font-grotesk-medium text-sm text-ink-charcoal-muted"
            }
          />
          <MetaPill
            icon={<Feather name="clock" size={14} color={colors.ink.charcoalMuted} />}
            label={formatDuration(task.estimatedMinutes)}
            labelClassName="font-grotesk-medium text-sm text-ink-charcoal-muted"
          />
          <MetaPill
            icon={<GemLogo size={13} onDark />}
            label={String(task.priorityScore)}
            labelClassName="font-grotesk-bold text-sm text-ink-charcoal"
            accessibilityLabel={t.tasks.score(task.priorityScore)}
          />
        </View>
      </ScreenHeader>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View className="screen-body">
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={{ paddingBottom: 24 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Stacked like the task list: the same cards, the same gap. */}
            <Animated.View style={enterStyle} className="gap-[11px] px-6 pt-4">
              {editing ? (
                <TaskEditPanel
                  ref={editPanelRef}
                  task={task}
                  onSave={handleSaveEdit}
                  onCancel={() => setEditing(false)}
                />
              ) : null}

              <View className="card card--cream-soft gap-3 p-[16px]">
                <SectionHeader icon="calendar" label={t.taskDetail.postponeTitle} />
                <Text className="font-grotesk-medium text-sm text-ink-cream-muted" style={rtl}>
                  {t.taskDetail.currentDeadline(due.label)}
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {POSTPONE_OPTIONS.map((option) => (
                    <Chip
                      key={option.value}
                      label={t.taskDetail.postpone[option.value]}
                      onPress={() => handlePostpone(option.days)}
                    />
                  ))}
                  <Chip
                    label={t.taskDetail.customDate}
                    selected={customPostponeDate !== null}
                    onPress={handleToggleCustomPostpone}
                  />
                </View>
                {customPostponeDate ? (
                  <View className="gap-3">
                    <DeadlineDatePicker value={customPostponeDate} onChange={setCustomPostponeDate} />
                    <PrimaryButton icon="check" label={t.taskDetail.setDate} onPress={handleCustomPostpone} className="self-start" />
                  </View>
                ) : null}
                {isOpen ? (
                  <View className="flex-row items-center gap-3 border-t border-cream-200 pt-3">
                    <Feather name="bell" size={14} color={colors.ink.creamMuted} />
                    <Text className="flex-1 font-grotesk-medium text-sm text-ink-cream-muted" style={rtl}>
                      {reminderLine}
                    </Text>
                    {task.deadline ? (
                      <TextButton
                        label={task.reminders?.muted ? t.taskDetail.unmuteReminders : t.taskDetail.muteReminders}
                        tone="accent"
                        onPress={() => updateTask(task.id, { remindersMuted: !task.reminders?.muted }, task.recurrence ? "future" : undefined)}
                      />
                    ) : null}
                  </View>
                ) : null}
              </View>

              <View className="card card--cream-soft gap-3 p-[16px]">
                <SectionHeader
                  icon="repeat"
                  label={t.taskDetail.repeatEyebrow}
                  action={
                    repeatDraft === undefined
                      ? {
                          label: task.recurrence ? t.taskDetail.editRepeat : t.taskDetail.setRepeat,
                          onPress: () => setRepeatDraft(task.recurrence ? ruleToInput(task.recurrence.rule) : null),
                        }
                      : undefined
                  }
                />

                {repeatDraft === undefined ? (
                  task.recurrence ? (
                    <View className="gap-1">
                      <Text className="font-grotesk-semibold text-base text-ink-cream" style={rtl}>
                        {describeRule(task.recurrence.rule, t)}
                      </Text>
                      {task.status === "pending" ? (
                        <>
                          <Text className="font-grotesk-medium text-sm text-ink-cream-muted" style={rtl}>
                            {t.taskDetail.occurrenceNote}
                          </Text>
                          <TextButton
                            label={t.taskDetail.stopRepeating}
                            onPress={handleStopRepeating}
                            tone="destructive"
                            className="mt-2 self-start"
                          />
                        </>
                      ) : null}
                    </View>
                  ) : (
                    <Text className="font-grotesk-medium text-sm text-ink-cream-muted" style={rtl}>
                      {t.taskDetail.notRepeating}
                    </Text>
                  )
                ) : (
                  <View className="gap-3">
                    <RecurrencePicker value={repeatDraft} onChange={setRepeatDraft} deadline={task.deadline} nested />
                    <View className="flex-row items-center justify-end gap-5">
                      <TextButton label={t.common.cancel} onPress={() => setRepeatDraft(undefined)} />
                      <PrimaryButton icon="check" label={t.taskDetail.saveRepeat} onPress={handleSaveRepeat} />
                    </View>
                  </View>
                )}
              </View>

              {isSkipped ? (
                <TextButton icon="rotate-ccw" label={t.taskDetail.restore} tone="accent" onPress={() => restoreTask(task.id)} />
              ) : null}

              {/* A list rather than a panel, so it's laid out like the task list:
                  a label, then one card per step. */}
              <View className="gap-3 pt-2">
                <SectionHeader
                  icon="check-square"
                  label={t.taskDetail.subtasks(completedSubtaskCount, orderedSubtasks.length)}
                />
                {planCaption ? (
                  <Text className="font-grotesk-medium text-sm text-ink-cream-muted" style={rtl}>
                    {planCaption}
                  </Text>
                ) : null}

                {orderedSubtasks.length > 0 ? (
                  <View className="gap-2">
                    {orderedSubtasks.map((subtask, index) => (
                      <Animated.View key={subtask.id} entering={listItemEntering(index)} layout={listItemLayout()}>
                        {editingSubtaskId === subtask.id ? (
                          <View className="flex-row items-center gap-1">
                            <TextField
                              className="flex-1"
                              value={editingSubtaskText}
                              onChangeText={setEditingSubtaskText}
                              onSubmitEditing={handleSaveSubtask}
                              returnKeyType="done"
                              autoFocus
                            />
                            <IconButton icon="x" onPress={() => setEditingSubtaskId(null)} accessibilityLabel={t.common.cancel} />
                            <IconButton
                              icon="check"
                              variant="primary"
                              onPress={handleSaveSubtask}
                              disabled={!editingSubtaskText.trim()}
                              accessibilityLabel={t.common.save}
                            />
                          </View>
                        ) : (
                          // Any step, in any order, and ticking a finished one
                          // puts it back — the same contract completeStep itself
                          // documents, and what the session checklist and the AI
                          // Breakdown sheet already allow. Only the task being
                          // open still matters.
                          <ChecklistRow
                            label={subtask.label}
                            checked={subtask.status === "completed"}
                            disabled={task.status !== "pending"}
                            onToggle={() => completeStep(task.id, subtask.id)}
                            caption={
                              suggestedDays.has(subtask.id)
                                ? t.taskDetail.suggestedDay(dayLabel(suggestedDays.get(subtask.id)!, today, t))
                                : undefined
                            }
                          >
                            <IconButton
                              icon="edit-2"
                              onPress={() => handleStartEditSubtask(subtask.id, subtask.label)}
                              accessibilityLabel={t.taskDetail.editSubtask(subtask.label)}
                            />
                            <IconButton
                              icon="trash-2"
                              onPress={() =>
                                showAlert(t.taskDetail.deleteConfirmTitle, t.taskDetail.deleteConfirmBody, [
                                  { text: t.common.cancel, style: "cancel" },
                                  {
                                    text: t.common.delete,
                                    style: "destructive",
                                    onPress: () => deleteSubtask(task.id, subtask.id),
                                  },
                                ])
                              }
                              accessibilityLabel={t.taskDetail.deleteSubtask(subtask.label)}
                            />
                          </ChecklistRow>
                        )}
                      </Animated.View>
                    ))}
                  </View>
                ) : null}

                <AddItemField
                  value={subtaskDraft}
                  onChangeText={setSubtaskDraft}
                  onAdd={handleAddSubtask}
                  placeholder={t.taskDetail.addSubtask}
                  addLabel={t.breakdown.addStep}
                />
              </View>

              {task.notes ? (
                <View className="card card--cream-soft gap-2 p-[16px]">
                  <SectionHeader icon="align-left" label={t.taskDetail.notes} />
                  <Text className="text-body text-ink-cream" style={rtl}>
                    {task.notes}
                  </Text>
                </View>
              ) : null}

              {/* Nexdo's current take on the task, kept in step with every
                  reassessment — so "AI advice: Revised" has something to point at. */}
              {task.aiContext.advice ? (
                <View className="card card--cream-soft gap-2 p-[16px]">
                  <SectionHeader
                    icon={<Ionicons name="sparkles" size={14} color={colors.orange[500]} />}
                    label={t.taskDetail.adviceTitle}
                  />
                  <HighlightedText
                    text={task.aiContext.advice}
                    className="text-body text-ink-cream"
                    highlightClassName="font-grotesk-semibold text-orange-600"
                  />
                </View>
              ) : null}

              <View className="card card--cream-soft gap-3 p-[16px]">
                {/* Orange here only because it's the AI's own sparkle. */}
                <SectionHeader
                  icon={<Ionicons name="sparkles" size={14} color={colors.orange[500]} />}
                  label={t.taskDetail.contextTitle}
                />
                <Text className="font-grotesk-medium text-sm text-ink-cream-muted" style={rtl}>
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
                    disabled={reassessing}
                  />
                ))}
                {/* Right above the box, where the user just typed. */}
                {reassess ? (
                  <ReassessmentNotice
                    state={reassess}
                    onDismiss={() => dismissContext(task.id)}
                    onRetry={() => retryContext(task.id)}
                  />
                ) : null}
                <AddItemField
                  value={note}
                  onChangeText={setNote}
                  onAdd={handleSendNote}
                  placeholder={
                    reassess?.status === "clarify" ? t.taskDetail.reassess.answerPlaceholder : t.taskDetail.contextPlaceholder
                  }
                  addLabel={t.common.save}
                  icon="send"
                  multiline
                  disabled={reassessing}
                />
              </View>
            </Animated.View>
          </ScrollView>
        </View>

        {/* Clear of the phone's own navigation bar (the screen's safe area
            only covers the top), as on Add Task and Live voice. */}
        <View
          className="flex-row items-center justify-between gap-4 border-t border-cream-200 bg-cream-50 px-6 pt-3"
          style={{ paddingBottom: insets.bottom + 12 }}
        >
          <TextButton icon="trash-2" label={t.taskDetail.deleteTask} onPress={handleDelete} tone="destructive" />
          {/* Held while Nexdo is reassessing, so its report isn't missed. */}
          <PrimaryButton
            icon="check"
            size="lg"
            label={t.taskDetail.saveChanges}
            onPress={handleSaveChanges}
            disabled={reassessing}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
