import type { NextRequestBody, NextResponseBody } from "@/app/api/next+api";
import { taskToContext } from "@/lib/ai/context";
import { apiPost } from "@/lib/api";
import { formatDuration } from "@/lib/formatDuration";
import { getLanguage, translate } from "@/lib/i18n";
import { PlanLimitError } from "@/lib/plan";
import { useSubscriptionStore } from "@/store/useSubscriptionStore";
import type { Task } from "@/types/task";

/**
 * A short, bold takeaway. The AI gives just that one recommendation; only the
 * offline fallback below adds a lighter second line (detail).
 */
export type TaskAdvice = { headline: string; detail: string };

/** Plain text for places that don't render highlights (the chat) — drops the **markers**. */
export function adviceToText(advice: TaskAdvice): string {
  return `${advice.headline} ${advice.detail}`.replace(/\*\*/g, "").replace(/\\\*/g, "*").trim();
}

function escapeAdviceText(text: string): string {
  return text.replace(/\*/g, "\\*");
}

// The route runs at temperature 0, so the same request gets the same advice
// back — and the Advice button is a toggle, so closing and reopening it used
// to pay for that same answer again. Keyed by the whole request body: any edit
// to the task, its steps, the time budget, the language — or the deadline
// label moving on ("in 2 hours" → "in 1 hour") — is a different key and a
// fresh answer. Only real AI answers are kept; the offline fallback never is.
const ADVICE_CACHE_TTL_MS = 30 * 60 * 1000;
const ADVICE_CACHE_MAX_ENTRIES = 50;
const adviceCache = new Map<string, { advice: TaskAdvice; storedAt: number }>();

function readCachedAdvice(key: string): TaskAdvice | null {
  const entry = adviceCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.storedAt > ADVICE_CACHE_TTL_MS) {
    adviceCache.delete(key);
    return null;
  }
  return entry.advice;
}

function cacheAdvice(key: string, advice: TaskAdvice) {
  // A Map iterates in insertion order, so the first key is the oldest.
  if (adviceCache.size >= ADVICE_CACHE_MAX_ENTRIES) adviceCache.delete(adviceCache.keys().next().value!);
  adviceCache.set(key, { advice, storedAt: Date.now() });
}

// Layer B (Execution Coach) — see data/aiPrompts.ts and app/api/next+api.ts.
// Falls back to the heuristic advice below on any network/parse failure.
//
// Each AI answer is one of the month's breakdowns-and-advice (lib/plan.ts).
// Asked for outright ("Get advice"), a used-up allowance is thrown as
// PlanLimitError so the caller can say so. `unasked` is for advice nobody
// tapped for (the AI chat reads a task out when it opens on one): on Free it
// never touches the allowance, and a used-up one quietly gets the heuristic.
export async function generateAdvice(
  task: Task,
  availableMinutes?: number,
  options: { unasked?: boolean } = {},
): Promise<TaskAdvice> {
  if (options.unasked && useSubscriptionStore.getState().pro === null) return generateAdviceHeuristic(task);
  try {
    const existingPlan = (task.subtasks ?? []).map((subtask) => ({
      id: subtask.id,
      title: subtask.label,
      estimatedMinutes: subtask.estimatedMinutes,
      status: subtask.status,
    }));
    const body: NextRequestBody = {
      task: taskToContext(task),
      existingPlan,
      availableMinutes,
      language: getLanguage(),
    };
    const cacheKey = JSON.stringify(body);
    const cached = readCachedAdvice(cacheKey);
    if (cached) return cached;

    const result = await apiPost<NextResponseBody>("/api/next", body);
    const advice = { headline: result.advice.trim(), detail: "" };
    if (!result.unavailable) cacheAdvice(cacheKey, advice);
    return advice;
  } catch (error) {
    if (error instanceof PlanLimitError && !options.unasked) throw error;
    console.warn("[generateAdvice] falling back to heuristic", error);
    return generateAdviceHeuristic(task);
  }
}

// Heuristic fallback — was the only implementation before Layer B existed.
// Advice here is derived at read time from the task, so it can never go
// stale relative to a task edit.
function generateAdviceHeuristic(task: Task): TaskAdvice {
  const t = translate();
  const currentSubtask = task.subtasks?.find((subtask) => subtask.status === "current");

  // **markers** highlight the key words on the AI advice card, like the AI's own advice.
  const headline = currentSubtask
    ? t.assistant.adviceDoNow(`**${escapeAdviceText(currentSubtask.label)}**`, `**${formatDuration(currentSubtask.estimatedMinutes)}**`)
    : t.assistant.adviceJustDo(`**${escapeAdviceText(task.title)}**`, `**${formatDuration(task.estimatedMinutes)}**`);

  const urgencyPhrase =
    task.priorityScore >= 85
      ? t.assistant.urgencyHigh
      : task.priorityScore >= 60
        ? t.assistant.urgencyMedium
        : t.assistant.urgencyLow;

  return { headline, detail: t.assistant.adviceDetail(task.priorityScore, urgencyPhrase) };
}
