import { create } from "zustand";

// No "all" since 2026-11-14 (the user's call): the list opens on To do.
export type TaskStatusFilter = "pending" | "completed" | "overdue" | "noDeadline";
export type TaskSortOption = "recent" | "dueDate" | "priority";

type TaskFilterStore = {
  status: TaskStatusFilter;
  sort: TaskSortOption;
  search: string;
  setStatus: (status: TaskStatusFilter) => void;
  setSort: (sort: TaskSortOption) => void;
  setSearch: (search: string) => void;
};

export const useTaskFilterStore = create<TaskFilterStore>((set) => ({
  status: "pending",
  sort: "recent",
  search: "",
  setStatus: (status) => set({ status }),
  setSort: (sort) => set({ sort }),
  setSearch: (search) => set({ search }),
}));
