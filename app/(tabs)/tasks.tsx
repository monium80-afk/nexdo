import { Feather, Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import Animated, { Easing, FadeInUp, LinearTransition } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { FilterSheet } from "@/components/FilterSheet";
import { TaskCard } from "@/components/TaskCard";
import { colors } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import { getDueInfo } from "@/lib/taskMeta";
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
  const t = useTranslation();
  const rtl = useRtlText();
  const router = useRouter();
  const tasks = useTaskStore((state) => state.tasks);
  const toggleTaskStatus = useTaskStore((state) => state.toggleTaskStatus);
  const { status, sort, search, setStatus, setSort, setSearch } = useTaskFilterStore();

  const [searchOpen, setSearchOpen] = useState(false);
  const [statusSheetOpen, setStatusSheetOpen] = useState(false);
  const [sortSheetOpen, setSortSheetOpen] = useState(false);

  const pendingCount = tasks.filter((task) => task.status === "pending").length;
  const completedCount = tasks.filter((task) => task.status === "completed").length;
  const overdueCount = tasks.filter((task) => getDueInfo(task).tone === "overdue").length;

  const statusOptions = useMemo(
    () => [
      { label: t.tasks.status.all, value: "all" as TaskStatusFilter, count: tasks.length },
      { label: t.tasks.status.pending, value: "pending" as TaskStatusFilter, count: pendingCount },
      { label: t.tasks.status.completed, value: "completed" as TaskStatusFilter, count: completedCount },
      { label: t.tasks.status.overdue, value: "overdue" as TaskStatusFilter, count: overdueCount },
    ],
    [tasks.length, pendingCount, completedCount, overdueCount, t],
  );

  const sortOptions = SORT_VALUES.map((value) => ({ label: t.tasks.sort[value], value }));

  const filteredTasks = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = tasks.filter((task) => {
      if (status === "pending" && task.status !== "pending") return false;
      if (status === "completed" && task.status !== "completed") return false;
      if (status === "overdue" && getDueInfo(task).tone !== "overdue") return false;
      if (query && !task.title.toLowerCase().includes(query)) return false;
      return true;
    });
    return sortTasks(filtered, sort);
  }, [tasks, status, sort, search]);

  const statusLabel = t.tasks.status[status];
  const sortLabel = t.tasks.sort[sort];

  const handleOpenTask = (taskId: string) => {
    router.push({ pathname: "/task/[id]", params: { id: taskId } });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.charcoal[900] }} edges={["top"]}>
      <View className="gap-4 bg-charcoal-900 px-6 pb-5 pt-2">
        <View className="flex-row items-center justify-between gap-3">
          <Text className="text-title text-ink-charcoal">{t.tasks.title}</Text>
          <View className="flex-row items-center gap-2.5">
            <AnimatedPressable
              onPress={() => setSearchOpen((open) => !open)}
              hitSlop={8}
              className="h-11 w-11 items-center justify-center rounded-full bg-charcoal-800"
            >
              <Feather name={searchOpen ? "x" : "search"} size={18} color={colors.ink.charcoal} />
            </AnimatedPressable>
            <AnimatedPressable
              onPress={() => router.push("/add")}
              className="btn btn--primary flex-row gap-2"
            >
              <Feather name="plus" size={16} color={colors.cream[50]} />
              <Text className="font-grotesk-bold text-sm text-cream-50">{t.tasks.addTask}</Text>
            </AnimatedPressable>
          </View>
        </View>

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
          <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
            <Text className="font-grotesk-medium text-sm text-ink-charcoal-muted">
              <Text className="font-grotesk-bold text-ink-charcoal">{pendingCount}</Text>
              {t.tasks.pendingSuffix}
              <Text className="font-grotesk-bold text-ink-charcoal">{completedCount}</Text>
              {t.tasks.completedSuffix}
            </Text>
            {overdueCount > 0 ? (
              <Text className="font-grotesk-semibold text-sm text-overdue-500">
                {t.tasks.overdueCount(overdueCount)}
              </Text>
            ) : null}
          </View>
        )}
      </View>

      <ScrollView
        style={{ backgroundColor: colors.cream[100] }}
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row gap-3 px-6 pt-5">
          <AnimatedPressable
            onPress={() => setStatusSheetOpen(true)}
            className={
              status !== "all"
                ? "chip chip--selected flex-1 flex-row items-center justify-center gap-1.5 px-3 py-2"
                : "chip chip--idle flex-1 flex-row items-center justify-center gap-1.5 px-3 py-2"
            }
          >
            <Feather name="filter" size={14} color={status !== "all" ? colors.orange[600] : colors.ink.cream} />
            <Text
              className={
                status !== "all"
                  ? "font-grotesk-bold text-sm text-orange-600"
                  : "font-grotesk-semibold text-sm text-ink-cream"
              }
              numberOfLines={1}
            >
              {statusLabel}
            </Text>
            <Feather name="chevron-down" size={14} color={status !== "all" ? colors.orange[600] : colors.ink.creamMuted} />
          </AnimatedPressable>
          <AnimatedPressable
            onPress={() => setSortSheetOpen(true)}
            className={
              sort !== "recent"
                ? "chip chip--selected flex-1 flex-row items-center justify-center gap-1.5 px-3 py-2"
                : "chip chip--idle flex-1 flex-row items-center justify-center gap-1.5 px-3 py-2"
            }
          >
            <Ionicons name="swap-vertical" size={14} color={sort !== "recent" ? colors.orange[600] : colors.ink.cream} />
            <Text
              className={
                sort !== "recent"
                  ? "font-grotesk-bold text-sm text-orange-600"
                  : "font-grotesk-semibold text-sm text-ink-cream"
              }
              numberOfLines={1}
            >
              {sortLabel}
            </Text>
          </AnimatedPressable>
        </View>

        <Text className="px-6 pt-4 font-grotesk-medium text-sm text-ink-cream-muted" style={rtl}>
          {t.tasks.showingPrefix}
          <Text className="font-grotesk-bold text-ink-cream">{filteredTasks.length}</Text>
          {t.tasks.showingSuffix(filteredTasks.length, tasks.length)}
        </Text>

        <View className="gap-4 px-6 pt-4">
          {filteredTasks.length === 0 ? (
            <View className="items-center gap-2 py-16">
              <Feather name="inbox" size={28} color={colors.ink.creamMuted} />
              <Text className="font-grotesk-semibold text-base text-ink-cream">{t.tasks.emptyTitle}</Text>
              <Text className="text-body text-center text-ink-cream-muted">{t.tasks.emptyBody}</Text>
            </View>
          ) : (
            filteredTasks.map((task, index) => (
              <Animated.View
                key={task.id}
                entering={FadeInUp.delay(Math.min(index, 8) * 40).duration(260)}
                layout={LinearTransition.duration(350).easing(Easing.out(Easing.quad))}
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
