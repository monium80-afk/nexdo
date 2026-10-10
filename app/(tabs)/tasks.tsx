import { Feather, Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { IconButton, PrimaryButton } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { DropdownMenu, type DropdownAnchor } from "@/components/DropdownMenu";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useTabBarHeight } from "@/components/TabBar";
import { TaskCard } from "@/components/TaskCard";
import { gradients, listItemEntering, listItemExiting, listItemLayout } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { getDueInfo } from "@/lib/taskMeta";
import { isListed } from "@/lib/taskOperations";
import { useTaskFilterStore, type TaskSortOption, type TaskStatusFilter } from "@/store/useTaskFilterStore";
import { useTaskStore } from "@/store/useTaskStore";
import type { Task } from "@/types/task";

const SORT_VALUES: TaskSortOption[] = ["recent", "dueDate", "priority"];

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
  const router = useRouter();
  const allTasks = useTaskStore((state) => state.tasks);
  const toggleTaskStatus = useTaskStore((state) => state.toggleTaskStatus);
  const { status, sort, search, setStatus, setSort, setSearch } = useTaskFilterStore();
  const tabBarHeight = useTabBarHeight();
  useStatusBarStyle("light");

  const [searchOpen, setSearchOpen] = useState(false);
  // Where the open menu hangs from — each drops out of its own chip.
  const [statusMenu, setStatusMenu] = useState<DropdownAnchor | null>(null);
  const [sortMenu, setSortMenu] = useState<DropdownAnchor | null>(null);
  const statusChipRef = useRef<View>(null);
  const sortChipRef = useRef<View>(null);
  const openMenu = (chip: View | null, open: (anchor: DropdownAnchor) => void) => {
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

  const statusLabel = t.tasks.status[status];
  const sortLabel = t.tasks.sort[sort];

  const handleOpenTask = (taskId: string) => {
    router.push({ pathname: "/task/[id]", params: { id: taskId } });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.charcoal[900] }} edges={["top"]}>
      <ScreenHeader
        title={t.tasks.title}
        actions={
          // Search and Add share one height, so they read as a pair.
          <>
            <IconButton icon={searchOpen ? "x" : "search"} variant="header" onPress={() => setSearchOpen((open) => !open)} />
            <PrimaryButton icon="plus" label={t.tasks.addTask} onPress={() => router.push("/add")} />
          </>
        }
      >
        {searchOpen ? (
          <View className="glass flex-row items-center gap-2 rounded-[16px] px-4 py-2.5">
            <Feather name="search" size={16} color={colors.ink.charcoalMuted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={t.tasks.searchPlaceholder}
              placeholderTextColor={colors.ink.charcoalMuted}
              autoFocus
              style={rtl}
              className="flex-1 font-grotesk-regular text-sm text-ink-charcoal"
            />
          </View>
        ) : (
          // Each count in its own colour — open work warm, finished work green —
          // split by a hairline so the pair reads as a scoreboard.
          <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
            <Text className="font-grotesk-medium text-sm text-ink-charcoal-muted">
              <Text className="font-grotesk-bold text-orange-300">{pendingCount}</Text>
              {t.tasks.pendingSuffix}
            </Text>
            <View className="h-[12px] w-px bg-white/20" />
            <Text className="font-grotesk-medium text-sm text-ink-charcoal-muted">
              <Text className="font-grotesk-bold text-success-300">{completedCount}</Text>
              {t.tasks.completedSuffix}
            </Text>
            {/* overdue-300: the -500 red is too dark to read on the charcoal header. */}
            {overdueCount > 0 ? (
              <>
                <View className="h-[12px] w-px bg-white/20" />
                <Text className="font-grotesk-semibold text-sm text-overdue-300">
                  {t.tasks.overdueCount(overdueCount)}
                </Text>
              </>
            ) : null}
          </View>
        )}
      </ScreenHeader>

      <View className="screen-body">
        <View pointerEvents="none" className="absolute inset-0" style={gradients.pageGlow} />
        <ScrollView
          // Clear of the tab bar, which floats over the foot of the page.
          contentContainerStyle={{ paddingBottom: 28 + tabBarHeight }}
          showsVerticalScrollIndicator={false}
        >
          {/* Filter on the left, sort on the right, each as wide as its label and
              orange only once something other than the default is picked. The
              funnel is always orange: it's the way into the list. */}
          <View className="flex-row items-center justify-between gap-3 px-6 pt-4">
            {/* Wrapped so each chip can be measured: its menu opens right under it. */}
            <View ref={statusChipRef} collapsable={false} className="shrink">
              <Chip
                label={statusLabel}
                selected={status !== "all"}
                icon={() => <Ionicons name="funnel-outline" size={14} color={colors.orange[500]} />}
                chevron
                onPress={() => openMenu(statusChipRef.current, setStatusMenu)}
              />
            </View>
            <View ref={sortChipRef} collapsable={false} className="shrink">
              <Chip
                label={sortLabel}
                selected={sort !== "recent"}
                icon={(color) => <Ionicons name="swap-vertical" size={14} color={color} />}
                chevron
                onPress={() => openMenu(sortChipRef.current, setSortMenu)}
              />
            </View>
          </View>

          <Text className="px-6 pt-3 font-grotesk-medium text-sm text-ink-cream-muted" style={rtl}>
            {t.tasks.showingPrefix}
            <Text className="font-grotesk-bold text-ink-cream">{filteredTasks.length}</Text>
            {t.tasks.showingSuffix(filteredTasks.length, tasks.length)}
          </Text>

          <View className="gap-3.5 px-4 pt-3.5">
            {filteredTasks.length === 0 ? (
              <EmptyState icon="inbox" title={t.tasks.emptyTitle} body={t.tasks.emptyBody} />
            ) : (
              filteredTasks.map((task, index) => (
                <Animated.View
                  key={task.id}
                  entering={listItemEntering(index)}
                  exiting={listItemExiting()}
                  layout={listItemLayout()}
                >
                  <TaskCard
                    task={task}
                    onPress={() => handleOpenTask(task.id)}
                    onToggle={() => toggleTaskStatus(task.id)}
                  />
                </Animated.View>
              ))
            )}
          </View>
        </ScrollView>
      </View>

      <DropdownMenu
        anchor={statusMenu}
        options={statusOptions}
        selected={status}
        onSelect={setStatus}
        onClose={() => setStatusMenu(null)}
      />
      <DropdownMenu
        anchor={sortMenu}
        align="right"
        options={sortOptions}
        selected={sort}
        onSelect={setSort}
        onClose={() => setSortMenu(null)}
      />
    </SafeAreaView>
  );
}
