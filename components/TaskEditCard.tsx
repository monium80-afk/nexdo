import { Feather } from "@expo/vector-icons";
import { useMemo, useState, type ReactNode } from "react";
import { Modal, Platform, Pressable, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { DateDetail, DetailCard, DurationDetail, PriorityDetail, RepeatDetail, type DetailKey } from "@/components/addSheet/AddSheetDetails";
import { DetailHeader, SheetIcon, Toggle } from "@/components/addSheet/SheetParts";
import { useKeyboardHeight } from "@/components/BottomSheet";
import { useSettingsStore } from "@/store/useSettingsStore";
import { formatTime, longDay } from "@/components/addSheet/sheetFormat";
import { colors } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import { showAlert } from "@/lib/alert";
import type { DeadlineInput } from "@/lib/deadline";
import { formatTaskLength } from "@/lib/formatDuration";
import { buildRule, describeRule, recurrenceKind, type RecurrenceScope, type RuleInput } from "@/lib/recurrence";
import { makeDeadline } from "@/lib/deadline";
import { priorityLevelOf, type TaskChanges } from "@/lib/taskOperations";
import { type LocalDate } from "@/lib/localDate";
import { useTaskStore } from "@/store/useTaskStore";
import { withUndo } from "@/store/useUndoStore";
import type { RecurrenceRule, Task, TaskPriorityLevel } from "@/types/task";
import { shadow } from "@/constants/shadow";

const P = colors.palette;
/** The card's tiles and the delete button: a step up from the dark card. */
const TILE = "#342C26";
const LABEL = "#A99D92";
const CHEVRON = "#8A7F76";
const DATE_VALUE = "#F7A16C";
const QUIET_VALUE = "#C9BDB2";
const DELETE_RED = "#F0907A";
const SCORE_PILL = "#472A1B";
const RING = "#5E554E";
const DIAMOND = { transform: [{ rotate: "45deg" }] };

/** The repeat picker's own shape for a saved rule, so it opens on what's there. */
function ruleToInput(rule: RecurrenceRule): RuleInput {
  return {
    frequency: rule.frequency,
    interval: rule.interval,
    weekdays: rule.weekdays,
    monthDay: rule.monthDay,
    endDate: rule.endDate,
    missed: rule.missed,
    time: rule.allDay ? null : `${String(rule.hour).padStart(2, "0")}:${String(rule.minute).padStart(2, "0")}`,
    kind: recurrenceKind(rule),
  };
}

const PRIORITY_DIAMONDS: Record<TaskPriorityLevel, number> = { high: 3, medium: 2, low: 1 };

/** One of the four tiles: a small label with its ›, and the value under it. */
function Tile({ label, onPress, accessibilityValue, children }: { label: string; onPress: () => void; accessibilityValue: string; children: ReactNode }) {
  return (
    <AnimatedPressable
      onPress={onPress}
      scaleTo={0.97}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${accessibilityValue}`}
      style={{ flex: 1, height: 65, borderRadius: 16, backgroundColor: TILE, paddingTop: 13, paddingLeft: 12, paddingRight: 13 }}
    >
      <View style={{ height: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ fontFamily: "SpaceMono-Bold", fontSize: 10, lineHeight: 12, letterSpacing: 1.5, textTransform: "uppercase", color: LABEL, includeFontPadding: false }}>
          {label}
        </Text>
        <SheetIcon name="chevronRight" size={13} color={CHEVRON} strokeWidth={2.2} />
      </View>
      <View style={{ marginTop: 8, height: 20, flexDirection: "row", alignItems: "center" }}>{children}</View>
    </AnimatedPressable>
  );
}

/** Over the page while a task is edited: the page shows through, faded. */
const PAGE_FADE = "rgba(250, 241, 228, 0.68)";

/**
 * The edit card over the page (Tasks, Today). The page stays exactly as it
 * is, faded behind it; tapping it closes the card, unsaved. Given `anchorY`
 * (the tapped task's top on screen), the card opens right over that task —
 * kept on screen, and above the keyboard while the title is being typed.
 */
export function TaskEditModal({ taskId, anchorY, onClose }: { taskId: string | null; anchorY?: number; onClose: () => void }) {
  const task = useTaskStore((state) => (taskId ? state.tasks.find((entry) => entry.id === taskId) : undefined));
  const toggleTaskStatus = useTaskStore((state) => state.toggleTaskStatus);
  const t = useTranslation();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const keyboardHeight = useKeyboardHeight(Boolean(task));
  const [cardHeight, setCardHeight] = useState(0);
  const visible = Boolean(task);

  // Where the card's top goes: on the tapped task (4 above it, as the card is
  // a touch bigger), or centred; never under the status bar, the keyboard or
  // off the bottom of the screen.
  const lowest = screenHeight - (keyboardHeight > 0 ? keyboardHeight + 12 : insets.bottom + 16) - cardHeight;
  const highest = insets.top + 8;
  const wanted = anchorY !== undefined ? anchorY - 4 : (screenHeight - cardHeight) / 2;
  const top = Math.max(highest, Math.min(wanted, lowest));

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1 }}>
        <Pressable onPress={onClose} accessibilityLabel={t.common.close} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: PAGE_FADE }} />
        {task ? (
          <View
            onLayout={(event) => setCardHeight(event.nativeEvent.layout.height)}
            style={{ position: "absolute", left: 20, right: 20, top, opacity: cardHeight > 0 ? 1 : 0 }}
          >
            <TaskEditCard
              key={task.id}
              task={task}
              onClose={onClose}
              onToggle={() => {
                onClose();
                toggleTaskStatus(task.id);
              }}
            />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

/**
 * Tapping a task on the Tasks page (2026-11 redesign): the task's card turns
 * into this dark card, in place. The title is edited right there; Date,
 * Duration, Repeat and Priority open the Add task sheet's own pickers. Done
 * saves it all; nothing changes before that.
 */
export function TaskEditCard({ task, onClose, onToggle }: { task: Task; onClose: () => void; onToggle: () => void }) {
  const t = useTranslation();
  const rtl = useRtlText();
  const insets = useSafeAreaInsets();
  const tasks = useTaskStore((state) => state.tasks);
  const updateTask = useTaskStore((state) => state.updateTask);
  const deleteTask = useTaskStore((state) => state.deleteTask);
  const now = useMemo(() => new Date(), []);

  const savedRepeat = task.recurrence ? ruleToInput(task.recurrence.rule) : null;
  const savedLevel = priorityLevelOf(task.importance);
  const [title, setTitle] = useState(task.title);
  const [deadline, setDeadline] = useState<DeadlineInput | undefined>(task.deadline ? { ...task.deadline } : undefined);
  const [minutes, setMinutes] = useState(task.estimatedMinutes);
  const [repeat, setRepeat] = useState<RuleInput | null>(savedRepeat);
  const [priority, setPriority] = useState<TaskPriorityLevel>(savedLevel);
  const savedMuted = Boolean(task.reminders?.muted);
  const [muted, setMuted] = useState(savedMuted);
  const [detail, setDetail] = useState<DetailKey | "reminders" | null>(null);
  // Whether reminders are on at all (Settings → Notifications → Reminders).
  const remindersEverywhere = useSettingsStore((state) => state.deadlineRemindersEnabled);
  const remindersOn = Boolean(deadline) && !muted && remindersEverywhere;
  const reminderText = !deadline
    ? t.redesign.noDateNoReminder
    : !remindersEverywhere
      ? t.redesign.turnOnInSettings
      : muted
        ? t.redesign.off
        : t.redesign.remindersBody;

  // How many open tasks fall on each day: the dots under the date picker's days.
  const busy = useMemo(() => {
    const counts = new Map<LocalDate, number>();
    for (const entry of tasks) {
      if (entry.status !== "pending" || !entry.deadline?.date) continue;
      counts.set(entry.deadline.date, (counts.get(entry.deadline.date) ?? 0) + 1);
    }
    return counts;
  }, [tasks]);

  const rule = useMemo(() => (repeat ? buildRule(repeat, makeDeadline(deadline), now) : null), [deadline, now, repeat]);
  const dateText = deadline
    ? deadline.time
      ? `${longDay(deadline.date, now, t)}, ${formatTime(deadline.time, t.locale)}`
      : longDay(deadline.date, now, t)
    : t.addSheet.noDate;
  const durationText = formatTaskLength(minutes);
  const repeatText = rule ? describeRule(rule, t) : t.recurrence.endsNever;
  const priorityText = t.addSheet[priority];

  const handleDone = () => {
    const trimmed = title.trim();
    const changes: TaskChanges = {};
    if (trimmed && trimmed !== task.title) changes.title = trimmed;
    if (minutes !== task.estimatedMinutes) changes.estimatedMinutes = minutes;
    if (JSON.stringify(deadline ?? null) !== JSON.stringify(task.deadline ?? null)) changes.deadline = deadline ?? null;
    if (priority !== savedLevel) changes.priority = priority;
    if (muted !== savedMuted) changes.remindersMuted = muted;
    const repeatChanged = JSON.stringify(repeat) !== JSON.stringify(savedRepeat);

    // The repeat after the rest, so it follows the deadline just set.
    const finish = (scope?: RecurrenceScope) => {
      if (Object.keys(changes).length > 0) updateTask(task.id, changes, scope);
      if (repeatChanged) updateTask(task.id, { recurrence: repeat });
      onClose();
    };
    // A repeating task asks which occurrences the change reaches (as Task Details does).
    if (Object.keys(changes).length === 0 || !task.recurrence || task.status !== "pending" || Platform.OS === "web") {
      finish(task.recurrence && task.status === "pending" ? "this" : undefined);
      return;
    }
    showAlert(t.taskDetail.editScopeTitle, t.taskDetail.editScopeBody, [
      { text: t.common.cancel, style: "cancel" },
      { text: t.taskDetail.scopeThis, onPress: () => finish("this") },
      { text: t.taskDetail.scopeFuture, onPress: () => finish("future") },
      { text: t.taskDetail.scopeSeries, onPress: () => finish("series") },
    ]);
  };

  const handleDelete = () => {
    const repeating = Boolean(task.recurrence) && task.status === "pending";
    const remove = (scope?: RecurrenceScope) => {
      onClose();
      withUndo(t.undoToast.deleted(task.title), () => deleteTask(task.id, scope));
    };
    if (Platform.OS === "web") {
      if (window.confirm(`${t.taskDetail.deleteConfirmTitle}\n\n${t.taskDetail.deleteConfirmBody}`)) remove(repeating ? "this" : undefined);
      return;
    }
    if (repeating) {
      showAlert(t.taskDetail.deleteScopeTitle, t.taskDetail.deleteScopeBody, [
        { text: t.common.cancel, style: "cancel" },
        { text: t.taskDetail.deleteThisOccurrence, style: "destructive", onPress: () => remove("this") },
        { text: t.taskDetail.deleteWholeSeries, style: "destructive", onPress: () => remove("series") },
      ]);
      return;
    }
    showAlert(t.taskDetail.deleteConfirmTitle, t.taskDetail.deleteConfirmBody, [
      { text: t.common.cancel, style: "cancel" },
      { text: t.common.delete, style: "destructive", onPress: () => remove() },
    ]);
  };

  const closeDetail = () => setDetail(null);
  const filledDiamonds = PRIORITY_DIAMONDS[priority];

  return (
    <View
      style={{
        marginHorizontal: -4,
        borderRadius: 22,
        backgroundColor: P.ink,
        paddingTop: 18,
        paddingHorizontal: 16,
        paddingBottom: 16,
        ...shadow("0 16px 32px rgba(34, 28, 23, 0.28)", 12),
      }}
    >
      {/* The round box, the title being edited, and the score. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <AnimatedPressable
          onPress={onToggle}
          hitSlop={10}
          scaleTo={0.9}
          accessibilityRole="checkbox"
          accessibilityLabel={task.title}
          accessibilityState={{ checked: task.status === "completed" }}
          style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: RING }}
        />
        <TextInput
          value={title}
          onChangeText={setTitle}
          multiline
          submitBehavior="blurAndSubmit"
          returnKeyType="done"
          selectionColor={P.accent}
          cursorColor={P.accent}
          accessibilityLabel={t.taskDetail.editTask}
          style={[
            { flex: 1, padding: 0, fontFamily: "SpaceGrotesk-Bold", fontSize: 20, lineHeight: 25, letterSpacing: -0.3, color: "#FFFFFF", includeFontPadding: false },
            rtl,
          ]}
        />
        <View style={{ height: 26, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 13, paddingHorizontal: 9, backgroundColor: SCORE_PILL }}>
          <View style={[{ width: 8, height: 8, borderRadius: 2, backgroundColor: P.accent }, DIAMOND]} />
          <Text style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 13, color: P.peachOnDark, includeFontPadding: false }}>{task.priorityScore}</Text>
        </View>
      </View>

      <View style={{ marginTop: 14, gap: 8.5 }}>
        <View style={{ flexDirection: "row", gap: 8.5 }}>
          <Tile label={t.addSheet.date} onPress={() => setDetail("date")} accessibilityValue={dateText}>
            <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: "SpaceGrotesk-Bold", fontSize: 16, color: deadline ? DATE_VALUE : QUIET_VALUE, includeFontPadding: false }}>
              {dateText}
            </Text>
          </Tile>
          <Tile label={t.addSheet.duration} onPress={() => setDetail("duration")} accessibilityValue={durationText}>
            <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: "SpaceGrotesk-Bold", fontSize: 16, color: minutes > 0 ? "#FFFFFF" : QUIET_VALUE, includeFontPadding: false }}>
              {durationText}
            </Text>
          </Tile>
        </View>
        <View style={{ flexDirection: "row", gap: 8.5 }}>
          <Tile label={t.addSheet.repeat} onPress={() => setDetail("repeat")} accessibilityValue={repeatText}>
            <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: "SpaceGrotesk-Bold", fontSize: 16, color: rule ? "#FFFFFF" : QUIET_VALUE, includeFontPadding: false }}>
              {repeatText}
            </Text>
          </Tile>
          <Tile label={t.addSheet.priority} onPress={() => setDetail("priority")} accessibilityValue={priorityText}>
            <View style={{ flexDirection: "row", gap: 3.5, marginLeft: 1.5, marginRight: 8 }}>
              {[0, 1, 2].map((index) => (
                <View key={index} style={[{ width: 7, height: 7, borderRadius: 1.5, backgroundColor: index < filledDiamonds ? P.accent : RING }, DIAMOND]} />
              ))}
            </View>
            <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: "SpaceGrotesk-Bold", fontSize: 16, color: "#FFFFFF", includeFontPadding: false }}>
              {priorityText}
            </Text>
          </Tile>
        </View>
      </View>

      {/* This task's own reminders: opens its picker, like the tiles above. */}
      <Pressable
        onPress={() => setDetail("reminders")}
        accessibilityRole="button"
        accessibilityLabel={`${t.redesign.reminders}, ${reminderText}`}
        style={({ pressed }) => ({
          marginTop: 8.5,
          height: 52,
          borderRadius: 16,
          backgroundColor: TILE,
          paddingLeft: 12,
          paddingRight: 13,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <Feather name={remindersOn ? "bell" : "bell-off"} size={15} color={remindersOn ? DATE_VALUE : LABEL} />
        <Text style={{ fontFamily: "SpaceMono-Bold", fontSize: 10, letterSpacing: 1.5, color: LABEL, includeFontPadding: false }}>{t.redesign.remindersLabel}</Text>
        <Text numberOfLines={1} style={{ flex: 1, textAlign: "right", fontFamily: "SpaceGrotesk-Bold", fontSize: 14, color: remindersOn ? "#FFFFFF" : QUIET_VALUE, includeFontPadding: false }}>
          {reminderText}
        </Text>
        <SheetIcon name="chevronRight" size={13} color={CHEVRON} strokeWidth={2.2} />
      </Pressable>

      {/* Delete on the left, Done on the right. */}
      <View style={{ marginTop: 14.5, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <AnimatedPressable
          onPress={handleDelete}
          scaleTo={0.92}
          accessibilityRole="button"
          accessibilityLabel={t.taskDetail.deleteTask}
          style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: TILE, alignItems: "center", justifyContent: "center" }}
        >
          <Feather name="trash-2" size={18} color={DELETE_RED} />
        </AnimatedPressable>
        <AnimatedPressable
          onPress={handleDone}
          scaleTo={0.95}
          accessibilityRole="button"
          style={{
            height: 44,
            minWidth: 86.5,
            paddingHorizontal: 22,
            borderRadius: 22,
            backgroundColor: P.accent,
            alignItems: "center",
            justifyContent: "center",
            ...shadow("0 8px 20px rgba(242, 106, 46, 0.35)", 6, "#F26A2E"),
          }}
        >
          <Text style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 16, color: "#FFFFFF", includeFontPadding: false }}>{t.common.done}</Text>
        </AnimatedPressable>
      </View>

      {/* A tile's picker: the Add task sheet's own, over the page. */}
      <Modal visible={detail !== null} transparent animationType="fade" statusBarTranslucent onRequestClose={closeDetail}>
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          <Pressable onPress={closeDetail} accessibilityLabel={t.common.close} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: P.veil }} />
          <View style={{ paddingHorizontal: 12, paddingBottom: insets.bottom + 12 }}>
            {detail === "date" ? <DateDetail deadline={deadline} onChange={setDeadline} busy={busy} now={now} onBack={closeDetail} /> : null}
            {detail === "duration" ? <DurationDetail minutes={minutes} onChange={setMinutes} onBack={closeDetail} /> : null}
            {detail === "repeat" ? <RepeatDetail repeat={repeat} onChange={setRepeat} deadline={deadline} now={now} onBack={closeDetail} /> : null}
            {detail === "priority" ? <PriorityDetail value={priority} onChange={setPriority} onBack={closeDetail} /> : null}
            {detail === "reminders" ? (
              <DetailCard>
                <DetailHeader title={t.redesign.reminders} onBack={closeDetail} onDone={closeDetail} />
                {deadline ? (
                  <>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                      <Text style={{ flex: 1, fontFamily: "SpaceGrotesk-SemiBold", fontSize: 15.5, color: P.ink }}>{t.redesign.remindThisTask}</Text>
                      <Toggle value={!muted} onChange={(on) => setMuted(!on)} accessibilityLabel={t.redesign.remindThisTask} />
                    </View>
                    <Text style={{ fontFamily: "SpaceGrotesk-Regular", fontSize: 13, lineHeight: 18, color: P.inkMuted }}>{t.redesign.remindersWhen}</Text>
                    {!remindersEverywhere ? (
                      <Text style={{ fontFamily: "SpaceGrotesk-Medium", fontSize: 13, lineHeight: 18, color: P.alert }}>{t.redesign.remindersOffEverywhere}</Text>
                    ) : null}
                  </>
                ) : (
                  <>
                    <Text style={{ fontFamily: "SpaceGrotesk-Regular", fontSize: 14, lineHeight: 19, color: P.inkMuted }}>{t.taskDetail.reminderNoDeadline}</Text>
                    <AnimatedPressable
                      onPress={() => setDetail("date")}
                      scaleTo={0.97}
                      accessibilityRole="button"
                      style={{ height: 44, borderRadius: 22, backgroundColor: P.ink, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}
                    >
                      <SheetIcon name="calendar" size={16} color="#FFFFFF" />
                      <Text style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 15, color: "#FFFFFF" }}>{t.redesign.pickDay}</Text>
                    </AnimatedPressable>
                  </>
                )}
              </DetailCard>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}
