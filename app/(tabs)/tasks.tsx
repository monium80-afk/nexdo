import { Feather, Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { IconButton, PrimaryButton } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { FilterSheet } from "@/components/FilterSheet";
import { ScreenHeader } from "@/components/ScreenHeader";
import { TaskCard } from "@/components/TaskCard";
import { listItemEntering, listItemExiting, listItemLayout } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
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

  const [searchOpen, setSearchOpen] = useState(false);
  const [statusSheetOpen, setStatusSheetOpen] = useState(false);
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const [deadlineNow, setDeadlineNow] = useState(() => new Date());

  // The list is open and done tasks. Archived ones — and occurrences a
  // repeating task skipped — are kept, but only under the Archived filter.
  const tasks = useMemo(() => allTasks.filter(isListed), [allTasks]);
  const archivedTasks = useMemo(() => allTasks.filter((task) => task.status === "archived"), [allTasks]);

  const pendingCount = tasks.filter((task) => task.status === "pending").length;
  const completedCount = tasks.filter((task) => task.status === "completed").length;
  const overdueCount = tasks.filter((task) => getDueInfo(task, deadlineNow).tone === "overdue").length;

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
      // Only once there's something archived to find.
      ...(archivedTasks.length > 0
        ? [{ label: t.tasks.status.archived, value: "archived" as TaskStatusFilter, count: archivedTasks.length }]
        : []),
    ],
    [tasks.length, pendingCount, completedCount, overdueCount, archivedTasks.length, t],
  );

  const sortOptions = SORT_VALUES.map((value) => ({ label: t.tasks.sort[value], value }));

  const filteredTasks = useMemo(() => {
    const query = search.trim().toLowerCase();
    const source = status === "archived" ? archivedTasks : tasks;
    const filtered = source.filter((task) => {
      if (status === "pending" && task.status !== "pending") return false;
      if (status === "completed" && task.status !== "completed") return false;
      if (status === "overdue" && getDueInfo(task, deadlineNow).tone !== "overdue") return false;
      if (query && !task.title.toLowerCase().includes(query)) return false;
      return true;
    });
    return sortTasks(filtered, sort);
  }, [tasks, archivedTasks, status, sort, search, deadlineNow]);

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
          <View className="flex-row items-center gap-2 rounded-2xl border border-charcoal-600 bg-charcoal-800 px-4 py-2.5">
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
          <View className="flex-row flex-wrap items-center gap-x-[15px] gap-y-1">
            <Text className="font-grotesk-medium text-sm text-ink-charcoal-muted">
              <Text className="font-grotesk-bold text-ink-charcoal">{pendingCount}</Text>
              {t.tasks.pendingSuffix}
            </Text>
            <Text className="font-grotesk-medium text-sm text-ink-charcoal-muted">
              <Text className="font-grotesk-bold text-ink-charcoal">{completedCount}</Text>
              {t.tasks.completedSuffix}
            </Text>
            {/* overdue-300: the -500 red is too dark to read on the charcoal header. */}
            {overdueCount > 0 ? (
              <Text className="font-grotesk-semibold text-sm text-overdue-300">
                {t.tasks.overdueCount(overdueCount)}
              </Text>
            ) : null}
          </View>
        )}
      </ScreenHeader>

      <View className="screen-body">
        <ScrollView
          contentContainerStyle={{ paddingBottom: 28 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Filter on the left, sort on the right, each as wide as its label and
              orange only once something other than the default is picked. */}
          <View className="flex-row items-center justify-between gap-3 px-6 pt-4">
            <Chip
              label={statusLabel}
              selected={status !== "all"}
              icon={(color) => <Feather name="filter" size={14} color={color} />}
              chevron
              onPress={() => setStatusSheetOpen(true)}
            />
            <Chip
              label={sortLabel}
              selected={sort !== "recent"}
              icon={(color) => <Ionicons name="swap-vertical" size={14} color={color} />}
              chevron
              onPress={() => setSortSheetOpen(true)}
            />
          </View>

          <Text className="px-6 pt-3 font-grotesk-medium text-sm text-ink-cream-muted" style={rtl}>
            {t.tasks.showingPrefix}
            <Text className="font-grotesk-bold text-ink-cream">{filteredTasks.length}</Text>
            {t.tasks.showingSuffix(filteredTasks.length, tasks.length)}
          </Text>

          <View className="gap-[11px] px-6 pt-3">
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

      <FilterSheet
        visible={statusSheetOpen}
        title={t.tasks.statusTitle}
        options={statusOptions}
        selected={status}
        onSelect={setStatus}
        onClose={() => setStatusSheetOpen(false)}
      />
      <FilterSheet
        visible={sortSheetOpen}
        title={t.tasks.sortTitle}
        options={sortOptions}
        selected={sort}
        onSelect={setSort}
        onClose={() => setSortSheetOpen(false)}
      />
    </SafeAreaView>
  );
}
