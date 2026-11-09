import { create } from "zustand";

export type TaskStatusFilter = "all" | "pending" | "completed" | "overdue" | "noDeadline";
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
  status: "all",
  sort: "recent",
  search: "",
  setStatus: (status) => set({ status }),
  setSort: (sort) => set({ sort }),
  setSearch: (search) => set({ search }),
}));
