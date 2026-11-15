import { useMagicMicStore } from "@/store/useMagicMicStore";
import { useTaskStore } from "@/store/useTaskStore";
import type { Task } from "@/types/task";

/**
 * The task list a tab screen shows: the live one, except while Magic mic is
 * open over it — then the list as it was when the mic opened, so nothing
 * shifts under the blur. Everything else (saving, ticking) uses the store.
 */
export function useVisibleTasks(): Task[] {
  const tasks = useTaskStore((state) => state.tasks);
  const frozen = useMagicMicStore((state) => state.frozenTasks);
  return frozen ?? tasks;
}
