import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { CompletionEntry, FocusEntry } from "@/lib/pace";

/** Enough for years, still a small file. */
const MAX_ENTRIES = 3000;
const MAX_COMPLETIONS = 6000;

/**
 * What the Insights page and "your pace" (lib/pace.ts) are built from:
 * every timed focus session, saved when it ends, and every task finished,
 * saved when it's done (lib/focusLog.ts) — finished tasks themselves are
 * deleted after a week (COMPLETED_RETENTION_DAYS), the count of them isn't.
 * Kept on this phone only — never synced or sent anywhere, and no task
 * titles in it. Each entry names the account it belongs to, so on a shared
 * phone each account only ever sees its own.
 */
type FocusLogStore = {
  entries: FocusEntry[];
  completions: CompletionEntry[];
  add: (entry: FocusEntry) => void;
  addCompletion: (completion: CompletionEntry) => void;
  /** A finished task reopened (Undo, unticked): it no longer counts as done. */
  removeCompletion: (taskId: string) => void;
  /** A deleted account's history goes with it. */
  forget: (userId: string) => void;
};

export const useFocusLogStore = create<FocusLogStore>()(
  persist(
    (set) => ({
      entries: [],
      completions: [],
      add: (entry) => set((state) => ({ entries: [...state.entries, entry].slice(-MAX_ENTRIES) })),
      addCompletion: (completion) =>
        set((state) => ({ completions: [...state.completions, completion].slice(-MAX_COMPLETIONS) })),
      removeCompletion: (taskId) =>
        set((state) => {
          const index = state.completions.map((entry) => entry.taskId).lastIndexOf(taskId);
          return index < 0 ? {} : { completions: state.completions.filter((_, other) => other !== index) };
        }),
      forget: (userId) =>
        set((state) => ({
          entries: state.entries.filter((entry) => entry.userId !== userId),
          completions: state.completions.filter((entry) => entry.userId !== userId),
        })),
    }),
    {
      name: "nexdo-focus-log",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

/** The signed-in account's entries (or, signed out, the ones made signed out). */
export function entriesFor<T extends { userId: string | null }>(entries: T[], userId: string | null): T[] {
  return entries.filter((entry) => entry.userId === userId);
}
