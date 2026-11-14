import { useEffect, useState } from "react";

import { useTaskStore } from "@/store/useTaskStore";

/** How long a change may wait to reach the server before Today says so. */
const PENDING_AFTER_MS = 60_000;
/** How often the wait is looked at again. */
const CHECK_EVERY_MS = 15_000;

/**
 * Whether the signed-in account has a change (a save or a delete) that hasn't
 * reached the server for a minute — offline, most likely. Saves are retried
 * on their own (store/useTaskStore.ts); this only lets Today say that the
 * change is safe on the phone meanwhile.
 */
export function useSyncPending(): boolean {
  const syncUserId = useTaskStore((state) => state.syncUserId);
  const unsynced = useTaskStore((state) => state.unsynced);
  const pendingDeletes = useTaskStore((state) => state.pendingDeletes);
  const [now, setNow] = useState(() => Date.now());

  const waiting = syncUserId !== null && (Object.keys(unsynced).length > 0 || Object.keys(pendingDeletes).length > 0);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [waiting]);

  if (!waiting) return false;
  const oldest = Math.min(...[...Object.values(unsynced), ...Object.values(pendingDeletes)].map((at) => Date.parse(at)).filter(Number.isFinite));
  return Number.isFinite(oldest) && now - oldest >= PENDING_AFTER_MS;
}
