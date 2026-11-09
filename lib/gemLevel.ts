export type GemLevel = 1 | 2 | 3 | 4 | 5;

/**
 * The gem's level from today's tasks (the user's rule, 2026-11-03): level 1
 * while none is done, level 5 only once every one is, and the tasks done in
 * between spread as evenly as they can over levels 2–4 (4 tasks: one level
 * each; 2 tasks: 1 → 3 → 5).
 */
export function gemLevelFor(done: number, total: number): GemLevel {
  if (total <= 0 || done <= 0) return 1;
  if (done >= total) return 5;
  const level = 1 + Math.round((done / total) * 4);
  return Math.min(4, Math.max(2, level)) as GemLevel;
}
