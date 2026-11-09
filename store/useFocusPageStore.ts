import { create } from "zustand";

/**
 * Whether the full-screen focus session page is up (Today's FocusCardTransition).
 * While it is, the tab bar steps aside: the session has the whole screen.
 */
export const useFocusPageStore = create<{ open: boolean; setOpen: (open: boolean) => void }>()((set) => ({
  open: false,
  setOpen: (open) => set((state) => (state.open === open ? state : { open })),
}));
