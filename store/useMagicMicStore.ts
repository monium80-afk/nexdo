import { create } from "zustand";

import { useTaskStore } from "@/store/useTaskStore";
import type { Task } from "@/types/task";

/** A box on screen, in window coordinates. */
export type ScreenRect = { x: number; y: number; width: number; height: number };

/**
 * Where the Tasks page's rows are right now, for cards flying into the list.
 * `visibleTop` / `visibleBottom` bound the part of the list that's on screen.
 */
export type TasksLanding = (taskIds: string[]) => Promise<{
  rows: Record<string, ScreenRect>;
  visibleTop: number;
  visibleBottom: number;
}>;

type MagicMicStore = {
  /** The overlay (components/MagicMicOverlay.tsx) is up. */
  isOpen: boolean;
  /** The tab it was opened from: decides where the cards fly at the end. */
  originTab: string | undefined;
  /**
   * The task list as it was when the mic opened. The screens behind the
   * overlay show this instead of the live list (hooks/useVisibleTasks.ts), so
   * nothing moves under the blur while changes are saved — until the cards
   * fly home and it's let go.
   */
  frozenTasks: Task[] | null;
  /** Rows the Tasks page keeps invisible while their card is flying to them. */
  hiddenIds: string[];
  /** The Tasks icon's centre along the tab bar. */
  tasksX: number | null;
  /** Set by the Tasks page while it's the tab in view. */
  tasksLanding: TasksLanding | null;
  /** Bumped as each card reaches the Tasks icon, so the icon can catch it. */
  arrivals: number;

  open: (originTab: string | undefined) => void;
  /** The screens behind go back to the live list. */
  release: () => void;
  hide: (taskIds: string[]) => void;
  /** A card has landed on its row: the row shows, the card goes, in one render. */
  land: (taskId: string) => void;
  arrive: () => void;
  close: () => void;
  setTasksX: (x: number) => void;
  setTasksLanding: (landing: TasksLanding | null) => void;
};

export const useMagicMicStore = create<MagicMicStore>()((set) => ({
  isOpen: false,
  originTab: undefined,
  frozenTasks: null,
  hiddenIds: [],
  tasksX: null,
  tasksLanding: null,
  arrivals: 0,

  open: (originTab) =>
    set({ isOpen: true, originTab, frozenTasks: useTaskStore.getState().tasks, hiddenIds: [] }),
  release: () => set({ frozenTasks: null }),
  hide: (taskIds) => set({ hiddenIds: taskIds }),
  land: (taskId) => set((state) => ({ hiddenIds: state.hiddenIds.filter((id) => id !== taskId) })),
  arrive: () => set((state) => ({ arrivals: state.arrivals + 1 })),
  close: () => set({ isOpen: false, frozenTasks: null, hiddenIds: [] }),
  setTasksX: (tasksX) => set((state) => (state.tasksX === tasksX ? state : { tasksX })),
  setTasksLanding: (tasksLanding) => set({ tasksLanding }),
}));
