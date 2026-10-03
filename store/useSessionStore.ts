import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { EnergyLevel } from "@/lib/sessionPlan";

/**
 * A focus session started from the Next screen. It snapshots the plan at
 * start time — which tasks, how long, what energy — so a task edit mid-run
 * can't silently re-shuffle what you're in the middle of working on.
 */
export type ActiveSession = {
  taskIds: string[];
  /** The time budget the user picked; the countdown's full length. */
  plannedMinutes: number;
  energy: EnergyLevel;
  /** Index into taskIds of the task the runner is focused on. */
  activeIndex: number;
  /** Milliseconds banked before the current running span (grows on each pause). */
  elapsedMs: number;
  /** Epoch ms the current running span started; null while paused. */
  runningSince: number | null;
};

/**
 * Elapsed time is derived from the wall clock rather than counted by a
 * ticking interval, so the timer stays honest if the app is backgrounded,
 * killed, or reopened mid-session.
 */
export function sessionElapsedMs(session: ActiveSession, now: number = Date.now()): number {
  return session.elapsedMs + (session.runningSince === null ? 0 : now - session.runningSince);
}

type SessionStore = {
  session: ActiveSession | null;
  start: (input: { taskIds: string[]; plannedMinutes: number; energy: EnergyLevel }) => void;
  pause: () => void;
  resume: () => void;
  resetTimer: () => void;
  /** "+5 min" on the session card — more time on the clock, same task. */
  extendMinutes: (minutes: number) => void;
  focusTask: (index: number) => void;
  /** Pulls a task out of the run ("I'm stuck") and keeps the focus in range. */
  dropTask: (taskId: string) => void;
  leave: () => void;
};

export const useSessionStore = create<SessionStore>()(
  persist(
    (set) => ({
      session: null,

      start: ({ taskIds, plannedMinutes, energy }) =>
        set({
          session: {
            taskIds,
            plannedMinutes,
            energy,
            activeIndex: 0,
            elapsedMs: 0,
            runningSince: Date.now(),
          },
        }),

      pause: () =>
        set((state) => {
          const session = state.session;
          if (!session || session.runningSince === null) return {};
          return {
            session: { ...session, elapsedMs: sessionElapsedMs(session), runningSince: null },
          };
        }),

      resume: () =>
        set((state) => {
          const session = state.session;
          if (!session || session.runningSince !== null) return {};
          return { session: { ...session, runningSince: Date.now() } };
        }),

      // Restarts the countdown from the full budget and leaves it running —
      // a reset mid-session means "give me the whole block again", not "stop".
      resetTimer: () =>
        set((state) =>
          state.session
            ? { session: { ...state.session, elapsedMs: 0, runningSince: Date.now() } }
            : {},
        ),

      extendMinutes: (minutes) =>
        set((state) =>
          state.session
            ? { session: { ...state.session, plannedMinutes: state.session.plannedMinutes + minutes } }
            : {},
        ),

      focusTask: (index) =>
        set((state) => {
          const session = state.session;
          if (!session || index < 0 || index >= session.taskIds.length) return {};
          return { session: { ...session, activeIndex: index } };
        }),

      dropTask: (taskId) =>
        set((state) => {
          const session = state.session;
          if (!session) return {};
          const taskIds = session.taskIds.filter((id) => id !== taskId);
          if (taskIds.length === 0) return { session: null };
          return {
            session: {
              ...session,
              taskIds,
              activeIndex: Math.min(session.activeIndex, taskIds.length - 1),
            },
          };
        }),

      leave: () => set({ session: null }),
    }),
    {
      name: "nexdo-session",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
