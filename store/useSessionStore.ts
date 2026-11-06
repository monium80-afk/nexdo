import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { posthog } from "@/lib/posthog";
import type { EnergyLevel } from "@/lib/sessionPlan";

/**
 * A focus session, run on the Today page — started there or from Task
 * Details. It snapshots the plan at start time — which tasks, how long, what
 * energy — so a task edit mid-run can't silently re-shuffle what you're in
 * the middle of working on.
 */
export type ActiveSession = {
  taskIds: string[];
  /**
   * The countdown's full length. 0 for a task with no duration (a goal kept
   * through the day): that session has no timer, and nothing to ring at.
   */
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

/**
 * How a session ended, for analytics: one event per session, so a funnel
 * from `session_started` shows how many sessions get finished. A session
 * counts as completed when its task was finished in it, or when its clock ran
 * the full planned time — read here, as it ends, because the alarm's own
 * timer only runs while the app is open.
 */
function captureSessionEnd(session: ActiveSession, taskCompleted: boolean) {
  const elapsedMs = sessionElapsedMs(session);
  const timeUp = session.plannedMinutes > 0 && elapsedMs >= session.plannedMinutes * 60_000;
  const outcome = taskCompleted ? "task_completed" : timeUp ? "time_up" : "ended_early";
  posthog.capture(outcome === "ended_early" ? "session_ended" : "session_completed", {
    outcome,
    elapsed_minutes: Math.round(elapsedMs / 60_000),
    planned_minutes: session.plannedMinutes,
    task_count: session.taskIds.length,
  });
}

type SessionStore = {
  session: ActiveSession | null;
  /**
   * A session asked for from outside the Today page (Task Details' Start
   * session): the Today page starts it — or reopens it, if it's already
   * running — full screen, then clears this. Never saved: a request the app
   * was closed on is simply dropped.
   */
  openRequest: { taskId: string; plannedMinutes: number } | null;
  requestOpen: (taskId: string, plannedMinutes: number) => void;
  clearOpenRequest: () => void;
  start: (input: { taskIds: string[]; plannedMinutes: number; energy: EnergyLevel }) => void;
  pause: () => void;
  resume: () => void;
  resetTimer: () => void;
  /** "+5 min" on the session card — more time on the clock, same task. */
  extendMinutes: (minutes: number) => void;
  focusTask: (index: number) => void;
  /** Pulls a task out of the run ("I'm stuck") and keeps the focus in range. */
  dropTask: (taskId: string) => void;
  /** Ends the session. "task_completed" when its task was finished in it. */
  leave: (reason?: "task_completed") => void;
};

export const useSessionStore = create<SessionStore>()(
  persist(
    (set, get) => ({
      session: null,
      openRequest: null,

      requestOpen: (taskId, plannedMinutes) => set({ openRequest: { taskId, plannedMinutes } }),
      clearOpenRequest: () => set({ openRequest: null }),

      start: ({ taskIds, plannedMinutes, energy }) => {
        const replaced = get().session;
        if (replaced) captureSessionEnd(replaced, false);
        set({
          session: {
            taskIds,
            plannedMinutes,
            energy,
            activeIndex: 0,
            elapsedMs: 0,
            runningSince: Date.now(),
          },
        });
      },

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
          const dropped = session ? session.taskIds.indexOf(taskId) : -1;
          if (!session || dropped < 0) return {};
          const taskIds = session.taskIds.filter((id) => id !== taskId);
          if (taskIds.length === 0) {
            captureSessionEnd(session, false);
            return { session: null };
          }
          // A task before the focused one going moves the focus down a place
          // with it; the focused one going hands it to the task after.
          const activeIndex = dropped < session.activeIndex ? session.activeIndex - 1 : session.activeIndex;
          return {
            session: {
              ...session,
              taskIds,
              activeIndex: Math.min(activeIndex, taskIds.length - 1),
            },
          };
        }),

      leave: (reason) => {
        const session = get().session;
        if (session) captureSessionEnd(session, reason === "task_completed");
        set({ session: null });
      },
    }),
    {
      name: "nexdo-session",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ session: state.session }),
    },
  ),
);
