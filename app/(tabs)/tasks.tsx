import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { ScrollView, Text, TextInput, View, type LayoutRectangle } from "react-native";
import Animated, { Easing, Keyframe, LinearTransition, useReducedMotion } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { EmptyState } from "@/components/EmptyState";
import { DropdownMenu, type DropdownAnchor } from "@/components/DropdownMenu";
import { AppIcon } from "@/components/icons/AppIcons";
import { ScoreSheet, type ScoreTarget } from "@/components/ScoreSheet";
import { useTabBarHeight } from "@/components/TabBar";
import { TaskCard } from "@/components/TaskCard";
import { TaskEditModal } from "@/components/TaskEditCard";
import { listItemEntering, listItemExiting } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";
import { useColors } from "@/hooks/useTheme";
import { useToday } from "@/hooks/useToday";
import { useTranslation } from "@/hooks/useTranslation";
import { useVisibleTasks } from "@/hooks/useVisibleTasks";
import { measureView, nextFrame } from "@/lib/measureView";
import { isRoutine } from "@/lib/recurrence";
import { buildToday } from "@/lib/schedule";
import { getDueInfo } from "@/lib/taskMeta";
import { isListed } from "@/lib/taskOperations";
import { openAddSheet } from "@/store/useAddSheetStore";
import { useMagicMicStore, type ScreenRect } from "@/store/useMagicMicStore";
import { useTaskFilterStore, type TaskSortOption, type TaskStatusFilter } from "@/store/useTaskFilterStore";
import { useTaskStore } from "@/store/useTaskStore";
import { useUndoStore, withUndo } from "@/store/useUndoStore";
import type { Task } from "@/types/task";

const SORT_VALUES: TaskSortOption[] = ["recent", "dueDate", "priority"];

// Anim-TaskDone.html: the cards under a ticked one slide up into its place
// (aRest, 38 → 50 % of 4 s), and the pills' counts roll over (aOld / aNew, 240 ms).
const REST_SLIDE = LinearTransition.duration(480).easing(Easing.bezier(0.3, 0, 0.2, 1));
const COUNT_IN = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 8 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }] },
}).duration(240);
const COUNT_OUT = new Keyframe({
  0: { opacity: 1, transform: [{ translateY: 0 }] },
  100: { opacity: 0, transform: [{ translateY: -8 }] },
}).duration(240);

// A row Magic mic's card has just landed in: a short orange edge that fades
// (Anim-MicTasks.html mzUpd / mzNew: in over 160 ms, gone over 560).
const LANDED_EDGE = new Keyframe({
  0: { opacity: 0 },
  22: { opacity: 1 },
  100: { opacity: 0 },
}).duration(720);
const LANDED_EDGE_MS = 760;

/** A pill's count: the old number rises away as the new one comes up from below. */
function RollingCount({ value, className }: { value: number; className: string }) {
  const reduceMotion = useReducedMotion();
  // Not on first showing: only when the number changes.
  const [first] = useState(value);
  const changed = value !== first;
  return (
    <View>
      <Animated.Text
        key={value}
        entering={changed && !reduceMotion ? COUNT_IN : undefined}
        exiting={reduceMotion ? undefined : COUNT_OUT}
        className={className}
      >
        {value}
      </Animated.Text>
    </View>
  );
}

function compareBySort(a: Task, b: Task, sort: TaskSortOption): number {
  switch (sort) {
    case "dueDate": {
      // Tasks with no deadline always sink below dated ones, whatever the direction.
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    }
    case "priority":
      return b.priorityScore - a.priorityScore;
    case "recent":
    default:
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  }
}

function sortTasks(list: Task[], sort: TaskSortOption): Task[] {
  return [...list].sort((a, b) => {
    // Completed tasks always sink below pending ones, whatever the chosen sort.
    if (a.status !== b.status) return a.status === "completed" ? 1 : -1;
    return compareBySort(a, b, sort);
  });
}

export default function TasksListScreen() {
  const colors = useColors();
  const t = useTranslation();
  const rtl = useRtlText();
  // While Magic mic is open, the list as it was when it opened.
  const allTasks = useVisibleTasks();
  const toggleTaskStatus = useTaskStore((state) => state.toggleTaskStatus);
  // Rows whose Magic mic card is still flying in: laid out, but not shown yet.
  const hiddenIds = useMagicMicStore((state) => state.hiddenIds);
  const setTasksLanding = useMagicMicStore((state) => state.setTasksLanding);
  const { status, sort, search, setStatus, setSort, setSearch } = useTaskFilterStore();
  const tabBarHeight = useTabBarHeight();
  // A light page since the 2026-11 redesign: dark status bar icons.
  useStatusBarStyle("dark");

  const [searchOpen, setSearchOpen] = useState(false);
  // The sort menu drops out of its pill.
  const [sortMenu, setSortMenu] = useState<DropdownAnchor | null>(null);
  const sortChipRef = useRef<ComponentRef<typeof View>>(null);
  const openMenu = (chip: ComponentRef<typeof View> | null, open: (anchor: DropdownAnchor) => void) => {
    chip?.measureInWindow((x, y, width, height) => open({ x, y, width, height }));
  };
  const [deadlineNow, setDeadlineNow] = useState(() => new Date());

  // The list shows open and done tasks. Skipped repeating occurrences stay out of the active list.
  const tasks = useMemo(() => allTasks.filter(isListed), [allTasks]);

  const pendingCount = tasks.filter((task) => task.status === "pending").length;
  const completedCount = tasks.filter((task) => task.status === "completed").length;
  const overdueCount = tasks.filter((task) => getDueInfo(task, deadlineNow).tone === "overdue").length;
  // No deadline puts a task on no day — not on Today, not in the Schedule —
  // so this filter is the way to find them all.
  const noDeadlineCount = tasks.filter((task) => !task.deadline).length;

  // Refresh at the next exact due time or local midnight so labels and colors
  // change while the list stays open, without polling throughout the day.
  useEffect(() => {
    const now = Date.now();
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    const nextDue = tasks
      .filter((task) => task.status === "pending" && task.dueDate)
      .map((task) => Date.parse(task.dueDate!))
      .filter((time) => Number.isFinite(time) && time > now)
      .reduce((soonest, time) => Math.min(soonest, time), Number.POSITIVE_INFINITY);
    const nextChange = Math.min(midnight.getTime(), nextDue);
    const timer = setTimeout(() => setDeadlineNow(new Date()), Math.max(1, nextChange - now));
    return () => clearTimeout(timer);
  }, [deadlineNow, tasks]);

  const statusOptions = useMemo(
    () => [
      { label: t.tasks.status.all, value: "all" as TaskStatusFilter, count: tasks.length },
      { label: t.tasks.status.pending, value: "pending" as TaskStatusFilter, count: pendingCount },
      { label: t.tasks.status.completed, value: "completed" as TaskStatusFilter, count: completedCount },
      { label: t.tasks.status.overdue, value: "overdue" as TaskStatusFilter, count: overdueCount },
      { label: t.tasks.status.noDeadline, value: "noDeadline" as TaskStatusFilter, count: noDeadlineCount },
    ],
    [tasks.length, pendingCount, completedCount, overdueCount, noDeadlineCount, t],
  );

  const sortOptions = SORT_VALUES.map((value) => ({ label: t.tasks.sort[value], value }));

  const filteredTasks = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = tasks.filter((task) => {
      if (status === "pending" && task.status !== "pending") return false;
      if (status === "completed" && task.status !== "completed") return false;
      if (status === "overdue" && getDueInfo(task, deadlineNow).tone !== "overdue") return false;
      if (status === "noDeadline" && task.deadline) return false;
      if (query && !task.title.toLowerCase().includes(query)) return false;
      return true;
    });
    return sortTasks(filtered, sort);
  }, [tasks, status, sort, search, deadlineNow]);

  // Where each row sits, for Magic mic's cards to land in (see
  // components/MagicMicOverlay.tsx). Row layouts come from onLayout — the
  // final place, even while the list is still sliding things into it.
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const listRef = useRef<ComponentRef<typeof View>>(null);
  const rowLayouts = useRef(new Map<string, LayoutRectangle>());
  const shownIds = useRef<string[]>([]);
  useEffect(() => {
    shownIds.current = filteredTasks.map((task) => task.id);
  }, [filteredTasks]);

  useFocusEffect(
    useCallback(() => {
      setTasksLanding(async (taskIds) => {
        // A row that has only just been added needs a frame or two to be laid out.
        for (let frame = 0; frame < 8; frame++) {
          const waiting = taskIds.some((id) => shownIds.current.includes(id) && !rowLayouts.current.has(id));
          if (!waiting) break;
          await nextFrame();
        }
        const [list, viewport] = await Promise.all([measureView(listRef.current), measureView(scrollRef.current)]);
        const rows: Record<string, ScreenRect> = {};
        for (const id of taskIds) {
          const row = rowLayouts.current.get(id);
          if (list && row && shownIds.current.includes(id)) {
            rows[id] = { x: list.x + row.x, y: list.y + row.y, width: row.width, height: row.height };
          }
        }
        return {
          rows,
          visibleTop: viewport?.y ?? 0,
          // The tab bar floats over the foot of the list.
          visibleBottom: viewport ? viewport.y + viewport.height - tabBarHeight : 0,
        };
      });
      return () => setTasksLanding(null);
    }, [setTasksLanding, tabBarHeight]),
  );

  const sortLabel = t.tasks.sort[sort];

  // Rows Magic mic's cards have just landed in (they were hidden while the
  // card flew), for their short orange edge.
  const reduceMotion = useReducedMotion();
  const [landedIds, setLandedIds] = useState<string[]>([]);
  const [lastHidden, setLastHidden] = useState<string[]>(hiddenIds);
  if (hiddenIds !== lastHidden) {
    const landed = lastHidden.filter((id) => !hiddenIds.includes(id));
    setLastHidden(hiddenIds);
    if (landed.length > 0) setLandedIds((current) => [...current, ...landed]);
  }
  useEffect(() => {
    if (landedIds.length === 0) return;
    const timer = setTimeout(() => setLandedIds([]), LANDED_EDGE_MS);
    return () => clearTimeout(timer);
  }, [landedIds]);

  // What the score means, for the task whose score pill was tapped.
  const [scoreTarget, setScoreTarget] = useState<ScoreTarget | null>(null);
  const dayKey = useToday();

  // Ticking one off can be taken back; unticking is its own undo. A task that
  // counts for today feeds the gem — the toast says so (Anim-TaskDone.html).
  const handleToggle = (task: Task) => {
    if (task.status !== "pending") {
      toggleTaskStatus(task.id);
      return;
    }
    withUndo(t.undoToast.done(task.title), () => toggleTaskStatus(task.id));
    const day = buildToday(
      useTaskStore.getState().tasks.filter((entry) => !isRoutine(entry)),
      { now: new Date(), today: dayKey },
    );
    const counted = getDueInfo(task).tone === "today" || getDueInfo(task).tone === "overdue";
    const total = day.done + day.ids.size;
    if (counted && total > 0) {
      useUndoStore.getState().decorate({ message: t.undoToast.gemBrighter, subtitle: t.undoToast.doneToday(day.done, total), gem: true });
    }
  };

  // The task being edited: the dark edit card opens over the page, right on
  // the tapped task, and the page fades behind it — nothing in the list moves
  // (components/TaskEditCard.tsx TaskEditModal).
  const [editing, setEditing] = useState<{ id: string; anchorY?: number } | null>(null);
  const handleOpenTask = async (taskId: string) => {
    const row = rowLayouts.current.get(taskId);
    const list = row ? await measureView(listRef.current) : null;
    setEditing({ id: taskId, anchorY: list && row ? list.y + row.y : undefined });
  };

  // The filters as a row of pills (Final-Tasks.html: "To do · 5", "Done · 2"…):
  // open and done first, then overdue (while there's any), no deadline, all.
  const filterPills = [
    statusOptions[1],
    statusOptions[2],
    ...(overdueCount > 0 || status === "overdue" ? [statusOptions[3]] : []),
    statusOptions[4],
    statusOptions[0],
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.palette.paper }} edges={["top"]}>
      <ScrollView
        ref={scrollRef}
        // Clear of the tab bar, which floats over the foot of the page.
        contentContainerStyle={{ paddingBottom: 28 + tabBarHeight }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-[9px] px-[20px] pt-[10px]">
          {/* How the list is sorted, and the way to change it: its menu drops out of the pill. */}
          <View ref={sortChipRef} collapsable={false} className="self-start">
            <AnimatedPressable
              onPress={() => openMenu(sortChipRef.current, setSortMenu)}
              scaleTo={0.96}
              accessibilityRole="button"
              className="h-[26px] flex-row items-center gap-[6px] rounded-full bg-peach px-[11px]"
            >
              <AppIcon name="check" size={11} strokeWidth={3} color={colors.palette.accentInk} />
              <Text className="font-mono-bold text-[10px] tracking-[1.2px] text-accent-ink">
                {t.tasks.sortedBy(sortLabel).toUpperCase()}
              </Text>
              <Feather name="chevron-down" size={11} color={colors.palette.accentInk} />
            </AnimatedPressable>
          </View>

          <View className="flex-row items-center justify-between gap-3">
            <Text numberOfLines={1} className="shrink font-grotesk-bold text-[26px] leading-[30px] tracking-[-0.52px] text-ink" style={rtl}>
              {t.tasks.yourTasks}
            </Text>
            <View className="flex-row items-center gap-[8px]">
              <AnimatedPressable
                onPress={() => setSearchOpen((open) => !open)}
                scaleTo={0.92}
                accessibilityRole="button"
                accessibilityLabel={t.tasks.searchPlaceholder}
                className="h-[40px] w-[40px] items-center justify-center rounded-full bg-chip"
              >
                <Feather name={searchOpen ? "x" : "search"} size={17} color={colors.palette.ink} />
              </AnimatedPressable>
              <AnimatedPressable
                onPress={() => openAddSheet()}
                scaleTo={0.92}
                accessibilityRole="button"
                accessibilityLabel={t.tasks.addTask}
                className="h-[40px] w-[40px] items-center justify-center rounded-full bg-ink"
              >
                <AppIcon name="plus" size={19} strokeWidth={2.4} color="#FFFFFF" />
              </AnimatedPressable>
            </View>
          </View>

          {searchOpen ? (
            <View className="h-[42px] flex-row items-center gap-2 rounded-full border-[1.5px] border-line bg-paper-card px-[14px]">
              <Feather name="search" size={15} color={colors.palette.inkMuted} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder={t.tasks.searchPlaceholder}
                placeholderTextColor={colors.palette.inkMuted}
                autoFocus
                style={rtl}
                className="flex-1 font-grotesk-regular text-[13.5px] text-ink"
              />
            </View>
          ) : null}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, gap: 7 }}
          accessibilityRole="radiogroup"
        >
          {filterPills.map((option) => {
            const selected = status === option.value;
            return (
              <AnimatedPressable
                key={option.value}
                onPress={() => setStatus(option.value)}
                scaleTo={0.95}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                className={`h-[34px] justify-center rounded-full px-[14px] ${selected ? "bg-ink" : "bg-chip"}`}
              >
                <View className="flex-row items-center">
                  <Text className={`font-grotesk-semibold text-[12.5px] ${selected ? "text-white" : "text-ink"}`}>
                    {`${option.label} · `}
                  </Text>
                  <RollingCount value={option.count} className={`font-grotesk-semibold text-[12.5px] ${selected ? "text-white" : "text-ink"}`} />
                </View>
              </AnimatedPressable>
            );
          })}
        </ScrollView>

        <View>
          <View ref={listRef} collapsable={false} className="gap-[10px] px-[20px] pt-[14px]">
            {filteredTasks.length === 0 ? (
              <EmptyState icon="inbox" title={t.tasks.emptyTitle} body={t.tasks.emptyBody} />
            ) : (
              filteredTasks.map((task, index) => (
                <Animated.View
                  key={task.id}
                  entering={listItemEntering(index)}
                  exiting={listItemExiting()}
                  layout={REST_SLIDE}
                  onLayout={(event) => rowLayouts.current.set(task.id, event.nativeEvent.layout)}
                >
                  <View className={hiddenIds.includes(task.id) ? "opacity-0" : undefined}>
                    {landedIds.includes(task.id) && !reduceMotion ? (
                      <Animated.View
                        pointerEvents="none"
                        entering={LANDED_EDGE}
                        className="absolute inset-0 z-10 rounded-[16px] border-[1.5px] border-accent"
                        style={{ opacity: 0 }}
                      />
                    ) : null}
                    <TaskCard
                      task={task}
                      onPress={() => void handleOpenTask(task.id)}
                      onToggle={() => handleToggle(task)}
                      onScorePress={(anchor) => setScoreTarget({ task, anchor })}
                    />
                  </View>
                </Animated.View>
              ))
            )}
          </View>
        </View>
      </ScrollView>

      <ScoreSheet target={scoreTarget} onClose={() => setScoreTarget(null)} />

      <TaskEditModal taskId={editing?.id ?? null} anchorY={editing?.anchorY} onClose={() => setEditing(null)} />

      <DropdownMenu
        anchor={sortMenu}
        options={sortOptions}
        selected={sort}
        onSelect={setSort}
        onClose={() => setSortMenu(null)}
      />
    </SafeAreaView>
  );
}
