import { create } from "zustand";

/**
 * The Add task sheet (components/addSheet/AddTaskSheet.tsx). It lives over the
 * tabs, like Magic mic, so the page behind it can be blurred on Android too —
 * which a separate screen can't do. Opened by the + buttons; app/add.tsx
 * opens it for a link to /add.
 */
export const useAddSheetStore = create<{ open: boolean; show: () => void; hide: () => void }>()((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

/** Opens the Add task sheet. */
export function openAddSheet() {
  useAddSheetStore.getState().show();
}
