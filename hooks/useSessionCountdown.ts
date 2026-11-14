import { useEffect, useState } from "react";

import { useTranslation } from "@/hooks/useTranslation";
import { formatClock } from "@/lib/formatDuration";
import { sessionElapsedMs, type ActiveSession } from "@/store/useSessionStore";

export type SessionCountdown = {
  /** `MM:SS` remaining, or `+MM:SS` once the budget is spent. */
  clock: string;
  /** Caption beside the clock, e.g. "remaining of 45m". */
  caption: string;
  /** 0–1, for the progress bar. Clamped at 1 in overtime. */
  progress: number;
  isRunning: boolean;
  isOvertime: boolean;
};

/**
 * Re-renders once a second while the session is running so the readout
 * stays live. The elapsed value itself comes from the store's wall-clock
 * math (see sessionElapsedMs) — this hook only decides *when* to re-read it,
 * which is why pausing can simply stop the interval.
 */
export function useSessionCountdown(session: ActiveSession | null): SessionCountdown {
  const t = useTranslation();
  const runningSince = session?.runningSince ?? null;
  const [now, setNow] = useState(() => Date.now());

  // On resume, `now` still holds a reading from before the pause — earlier
  // than runningSince — which would make the current span come out negative
  // and the clock jump backwards until the first tick lands a second later.
  // Clamping is the whole fix, and unlike re-reading the clock it is a pure
  // derivation: before the first tick the current span is simply zero, which
  // is exactly what it is.
  const liveNow = runningSince === null ? now : Math.max(now, runningSince);

  useEffect(() => {
    if (runningSince === null) return;

    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [runningSince]);

  const totalMs = (session?.plannedMinutes ?? 0) * 60_000;
  const elapsedMs = session ? sessionElapsedMs(session, liveNow) : 0;
  const remainingMs = totalMs - elapsedMs;
  const isOvertime = remainingMs <= 0;
  // Deliberately terser than formatDuration()'s "45 mins": it sits next to a
  // 38px numeral and has to stay out of its way.
  const plannedMinutes = session?.plannedMinutes ?? 0;
  const budgetLabel = t.format.budget(Math.floor(plannedMinutes / 60), plannedMinutes % 60);

  return {
    clock: isOvertime ? `+${formatClock(-remainingMs)}` : formatClock(remainingMs),
    caption: isOvertime ? t.session.overBudget(budgetLabel) : t.session.remainingOf(budgetLabel),
    progress: totalMs === 0 ? 0 : Math.min(elapsedMs / totalMs, 1),
    isRunning: runningSince !== null,
    isOvertime,
  };
}
