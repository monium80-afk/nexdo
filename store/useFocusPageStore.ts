import { create } from "zustand";

/**
 * Whether the full-screen focus session page is up (Today's FocusCardTransition).
 * While it is, the tab bar steps aside: the session has the whole screen.
 * `fadeInMs`: how the bar comes back — faded in with Today after a task done
 * in the session (constants/focusFinish.ts), at once otherwise.
 */
export const useFocusPageStore = create<{
  open: boolean;
  fadeInMs: number;
  setOpen: (open: boolean, fadeInMs?: number) => void;
}>()((set) => ({
  open: false,
  fadeInMs: 0,
  setOpen: (open, fadeInMs = 0) =>
    set((state) => (state.open === open && state.fadeInMs === fadeInMs ? state : { open, fadeInMs })),
}));
