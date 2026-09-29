// Server-only: the "is this body sane?" half of the API route boundary
// (lib/serverAuth.ts is the "who is calling?" half). Type-only imports here,
// so nothing in this file pulls client code onto the server or vice versa.
//
// Every route used to do `(await request.json()) as SomeRequestBody`. A TS
// `as` is erased at runtime, so that cast validated nothing — it only told
// the compiler to stop asking. These helpers are the runtime equivalent:
// they cap how much work one request can ask for before it reaches Gemini.

import type { TaskContext } from "@/lib/ai/context";
import type { PlanStep } from "@/lib/ai/types";

/** A body bigger than the route's cap, or not JSON at all. */
export class BadRequestError extends Error {}

export function badRequest(): Response {
  return Response.json({ error: "Bad request" }, { status: 400 });
}

/**
 * Reads and parses the body, refusing anything over `maxBytes`.
 *
 * Content-Length is checked first so an oversized upload is rejected before
 * it is buffered, but it's a client-supplied header — the decoded text is
 * measured again afterwards, which is the check that actually holds.
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new BadRequestError("body too large");
  }

  const reader = request.body?.getReader();
  if (!reader) throw new BadRequestError("invalid JSON");

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new BadRequestError("body too large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);

  try {
    return JSON.parse(text);
  } catch {
    throw new BadRequestError("invalid JSON");
  }
}

/** An object to read fields off, or an empty one — so callers never touch a null. */
export function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** A string truncated to `max` characters, or undefined if it isn't a non-empty string. */
export function clampString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** The first `max` entries of an array, or [] if it isn't one. */
export function clampArray(value: unknown, max: number): unknown[] {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

/** A finite number inside [min, max], or undefined. Rejects NaN and Infinity. */
export function clampNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

/** The value if it is one of `allowed`, otherwise undefined. */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/** Mirrors AppLanguage in types/settings.ts — an unknown value just falls back to English. */
export const LANGUAGES = ["en", "fr", "es", "ar", "de"] as const;

// ---------------------------------------------------------------------
// Shared shapes — three routes accept a TaskContext, so it is validated
// once here rather than three slightly different ways.
// ---------------------------------------------------------------------

export const MAX_ID_LENGTH = 100;
export const MAX_TITLE_LENGTH = 200;
export const MAX_NOTE_LENGTH = 1_000;
export const MAX_CONTEXT_NOTES = 20;
export const MAX_STEPS = 30;

const TASK_STATUSES = ["pending", "completed"] as const;
const COMPLEXITIES = ["simple", "medium", "complex"] as const;
const STEP_STATUSES = ["pending", "current", "completed"] as const;

/**
 * The tasks a route receives are the client's own trimmed TaskContext objects,
 * but they still land verbatim inside a Gemini prompt — so they get the same
 * treatment as any other untrusted field rather than being trusted for being
 * "ours". Returns null for anything without at least an id and a title.
 */
export function parseTaskContext(raw: unknown): TaskContext | null {
  const task = asObject(raw);
  const id = clampString(task.id, MAX_ID_LENGTH);
  const title = clampString(task.title, MAX_TITLE_LENGTH);
  if (!id || !title) return null;

  return {
    id,
    title,
    status: oneOf(task.status, TASK_STATUSES) ?? "pending",
    dueDate: clampString(task.dueDate, 40),
    dueLabel: clampString(task.dueLabel, 100) ?? "",
    estimatedMinutes: clampNumber(task.estimatedMinutes, 0, 10_000) ?? 30,
    priorityScore: clampNumber(task.priorityScore, 0, 1_000) ?? 0,
    complexity: oneOf(task.complexity, COMPLEXITIES) ?? "simple",
    notes: clampString(task.notes, MAX_NOTE_LENGTH),
    contextNotes: clampArray(task.contextNotes, MAX_CONTEXT_NOTES)
      .map((note) => clampString(note, MAX_NOTE_LENGTH))
      .filter((note): note is string => !!note),
    priority: oneOf(task.priority, ["high", "medium", "low"] as const),
    overdue: task.overdue === true ? true : undefined,
    completedLabel: clampString(task.completedLabel, 100),
    repeats: clampString(task.repeats, 160),
  };
}

/** A step with no id — what the breakdown route sends and receives. */
export function parsePlanSteps(raw: unknown, max = MAX_STEPS): PlanStep[] {
  return clampArray(raw, max)
    .map((entry) => {
      const step = asObject(entry);
      const title = clampString(step.title, MAX_TITLE_LENGTH);
      return title ? { title, estimatedMinutes: clampNumber(step.estimatedMinutes, 0, 10_000) ?? 15 } : null;
    })
    .filter((step): step is PlanStep => step !== null);
}

/** A step that already exists on a task, so it carries an id and a status. */
export type ExistingPlanStep = {
  id: string;
  title: string;
  estimatedMinutes: number;
  status: (typeof STEP_STATUSES)[number];
};

export function parseExistingPlan(raw: unknown, max = MAX_STEPS): ExistingPlanStep[] {
  return clampArray(raw, max)
    .map((entry) => {
      const step = asObject(entry);
      const id = clampString(step.id, MAX_ID_LENGTH);
      const title = clampString(step.title, MAX_TITLE_LENGTH);
      if (!id || !title) return null;
      return {
        id,
        title,
        estimatedMinutes: clampNumber(step.estimatedMinutes, 0, 10_000) ?? 15,
        status: oneOf(step.status, STEP_STATUSES) ?? "pending",
      };
    })
    .filter((step): step is ExistingPlanStep => step !== null);
}
