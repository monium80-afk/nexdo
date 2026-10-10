import { translate } from "@/lib/i18n";

/** "45 mins", "1 hour 30 mins" — worded in the app language. */
export function formatDuration(minutes: number): string {
  return translate().format.duration(Math.floor(minutes / 60), minutes % 60);
}

/**
 * A task's length as it's shown on the task: its duration, or "No duration"
 * for one that has none — a goal kept through the day ("drink 2 L of water")
 * rather than a sitting of work. Stored as 0 minutes (see Task.estimatedMinutes).
 */
export function formatTaskLength(minutes: number): string {
  return minutes > 0 ? formatDuration(minutes) : translate().format.noDuration;
}

/** Live countdown readout — `MM:SS`, widening to `H:MM:SS` past an hour. */
export function formatClock(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");

  return hours > 0 ? `${hours}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}
