import type { RealtimeChannel } from "@supabase/supabase-js";

import { messageAttachments } from "@/lib/chatAttachments";
import { normalizeRecurrence } from "@/lib/recurrence";
import { supabase } from "@/lib/supabase";
import type { Task } from "@/types/task";
import type { ChatAttachment, ChatMessage } from "@/types/chat";

// Background sync helpers used by useTaskStore/useChatStore. Every function
// here is fire-and-forget from the caller's perspective — mutations stay
// synchronous locally, these just mirror the change to Supabase.

type TaskRow = {
  id: string;
  user_id: string;
  title: string;
  status: Task["status"];
  due_date: string | null;
  estimated_minutes: number;
  created_at: string;
  updated_at: string;
  notes: string | null;
  subtasks: Task["subtasks"] | null;
  current_step_id: string | null;
  priority_score: number;
  suitability_score: number;
  importance: number;
  complexity: Task["complexity"];
  ai_context: Task["aiContext"];
  skip: Task["skip"] | null;
  completed_at: string | null;
  // Optional on the type: a database that hasn't run the migration in
  // supabase/schema.sql yet has no such columns (see upsertTaskRows).
  recurrence?: Task["recurrence"] | null;
  /** The deadline's calendar day (Postgres `date`). */
  deadline_date?: string | null;
  /** Its clock time (Postgres `time`, read back as "HH:MM:SS") — null for a date-only deadline. */
  deadline_time?: string | null;
  deadline_timezone?: string | null;
  reminder_settings?: Task["reminders"] | null;
  pinned_at?: string | null;
  closed_at?: string | null;
};

/** Columns added after the first release, each by a re-run of supabase/schema.sql. */
const NEWER_COLUMNS = ["deadline_date", "deadline_time", "deadline_timezone", "reminder_settings", "pinned_at", "closed_at"] as const;

function toTaskRow(task: Task, userId: string): TaskRow {
  return {
    id: task.id,
    user_id: userId,
    title: task.title,
    status: task.status,
    due_date: task.dueDate ?? null,
    estimated_minutes: task.estimatedMinutes,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    notes: task.notes ?? null,
    subtasks: task.subtasks ?? null,
    current_step_id: task.currentStepId ?? null,
    priority_score: task.priorityScore,
    suitability_score: task.suitabilityScore,
    importance: task.importance,
    complexity: task.complexity,
    ai_context: task.aiContext,
    skip: task.skip ?? null,
    completed_at: task.completedAt ?? null,
    recurrence: task.recurrence ?? null,
    deadline_date: task.deadline?.date ?? null,
    deadline_time: task.deadline?.time ?? null,
    deadline_timezone: task.deadline?.timeZone ?? null,
    reminder_settings: task.reminders ?? null,
    pinned_at: task.pinnedAt ?? null,
    closed_at: task.closedAt ?? null,
  };
}

/**
 * The row's deadline, when the database has the deadline columns and one is
 * set. Without them, only due_date is there, and lib/deadline.ts
 * reconcileDeadline reads that as an exact deadline.
 */
function deadlineFromRow(row: TaskRow): Task["deadline"] {
  if (!row.deadline_date) return undefined;
  const time = row.deadline_time ? row.deadline_time.slice(0, 5) : undefined;
  return {
    date: row.deadline_date.slice(0, 10),
    ...(time ? { time } : {}),
    ...(row.deadline_timezone ? { timeZone: row.deadline_timezone } : {}),
  };
}

function fromTaskRow(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    deadline: deadlineFromRow(row),
    dueDate: row.due_date ?? undefined,
    estimatedMinutes: row.estimated_minutes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    notes: row.notes ?? undefined,
    subtasks: row.subtasks ?? undefined,
    currentStepId: row.current_step_id ?? undefined,
    priorityScore: row.priority_score,
    suitabilityScore: row.suitability_score,
    importance: row.importance,
    complexity: row.complexity,
    aiContext: row.ai_context ?? { notes: [] },
    skip: row.skip ?? undefined,
    completedAt: row.completed_at ?? undefined,
    recurrence: normalizeRecurrence(row.recurrence),
    reminders: row.reminder_settings?.muted === true ? { muted: true } : undefined,
    pinnedAt: row.pinned_at ?? undefined,
    closedAt: row.closed_at ?? undefined,
  };
}

// Clerk stamps the token's time claims on its servers and Supabase checks them
// against its own clock. Hydration fires the moment a user signs in, with a
// token Clerk minted milliseconds earlier, and Supabase can briefly see it as
// issued "in the future" — PGRST303 "JWT not yet valid". The same token is
// accepted a moment later, so the launch fetch waits and tries once more
// instead of skipping the whole sync until the next app start.
const JWT_RETRY_DELAY_MS = 2_000;

async function retryOnJwtTiming<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if ((error as { code?: string } | null)?.code !== "PGRST303") throw error;
    await new Promise((resolve) => setTimeout(resolve, JWT_RETRY_DELAY_MS));
    return run();
  }
}

export async function fetchTasks(userId: string): Promise<Task[]> {
  return retryOnJwtTiming(async () => {
    const { data, error } = await supabase.from("tasks").select("*").eq("user_id", userId);
    if (error) throw error;
    return (data as TaskRow[]).map(fromTaskRow);
  });
}

// The "recurrence" column arrives with a migration the database owner has to
// run (supabase/schema.sql). Until then PostgREST rejects any row that names
// it (PGRST204). That must not stop ordinary tasks saving — the stale
// "category" column once broke every save for a week — so a plain task is
// retried without the key. A repeating task is not: saved without its rule,
// the next sync would come back as a one-off and quietly stop repeating, so it
// stays unsaved (and retried) until the column exists. Checked again every
// few minutes, so running the migration while the app is open is picked up.
const RECURRENCE_COLUMN_RECHECK_MS = 5 * 60 * 1000;
let recurrenceColumnMissingUntil = 0;
// The same for the deadline / reminder / pin / archive columns. Without them
// a row is still saved — due_date keeps the instant, so no deadline is lost —
// only the "no set time", per-task reminder and pin details stay on the phone
// until the migration is run (useTaskStore keeps them across a re-fetch).
let newerColumnsMissingUntil = 0;

function isMissingColumn(error: { code?: string; message?: string } | null, names: readonly string[]): boolean {
  return !!error && error.code === "PGRST204" && names.some((name) => (error.message ?? "").includes(name));
}

function withoutRecurrence(row: TaskRow): TaskRow {
  const copy = { ...row };
  delete copy.recurrence;
  return copy;
}

function withoutNewerColumns(row: TaskRow): TaskRow {
  const copy = { ...row };
  NEWER_COLUMNS.forEach((column) => delete copy[column]);
  return copy;
}

/**
 * Saves several tasks in one request. PostgREST runs a bulk upsert as a single
 * statement, so the rows land together or not at all — a bulk AI change can't
 * be left half-written.
 */
export async function upsertTaskRows(tasks: Task[], userId: string): Promise<void> {
  if (tasks.length === 0) return;
  const rows = tasks.map((task) => toTaskRow(task, userId));
  // PostgREST names one missing column per error, so a database missing both
  // groups takes two rounds to find out; three attempts cover it.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const now = Date.now();
    const dropRecurrence = now < recurrenceColumnMissingUntil;
    const dropNewer = now < newerColumnsMissingUntil;
    let sendable = dropNewer ? rows.map(withoutNewerColumns) : rows;
    if (dropRecurrence) {
      // A repeating task saved without its rule would come back as a one-off.
      if (sendable.some((row) => row.recurrence)) {
        throw new Error("Repeating tasks can't be saved until supabase/schema.sql adds the recurrence column.");
      }
      sendable = sendable.map(withoutRecurrence);
    }
    const { error } = await supabase.from("tasks").upsert(sendable);
    if (!error) return;
    if (!dropNewer && isMissingColumn(error, NEWER_COLUMNS)) {
      newerColumnsMissingUntil = Date.now() + RECURRENCE_COLUMN_RECHECK_MS;
      console.warn(
        "[supabaseSync] The tasks table has no deadline_date/reminder_settings columns yet — run supabase/schema.sql. Tasks still save; a date-only deadline is stored as its end-of-day time until then.",
      );
      continue;
    }
    if (!dropRecurrence && isMissingColumn(error, ["recurrence"])) {
      recurrenceColumnMissingUntil = Date.now() + RECURRENCE_COLUMN_RECHECK_MS;
      console.warn(
        "[supabaseSync] The tasks table has no recurrence column yet — run supabase/schema.sql. Repeating tasks stay unsaved until then.",
      );
      continue;
    }
    throw error;
  }
  throw new Error("[supabaseSync] tasks upsert kept failing on missing columns");
}

export async function upsertTaskRow(task: Task, userId: string): Promise<void> {
  return upsertTaskRows([task], userId);
}

// Scoped to the owner as well as the id. RLS already enforces this server
// side, but every other query here says whose rows it means, and a delete is
// the one that costs the most if a policy is ever loosened by accident.
export async function deleteTaskRow(taskId: string, userId: string): Promise<void> {
  return deleteTaskRows([taskId], userId);
}

/** Deletes several tasks in one statement — all of them or none. */
export async function deleteTaskRows(taskIds: string[], userId: string): Promise<void> {
  if (taskIds.length === 0) return;
  const { error } = await supabase.from("tasks").delete().in("id", taskIds).eq("user_id", userId);
  if (error) throw error;
}

/** Account deletion only — removes every task the account ever synced. */
export async function deleteAllTasks(userId: string): Promise<void> {
  const { error } = await supabase.from("tasks").delete().eq("user_id", userId);
  if (error) throw error;
}

export function subscribeToTasks(userId: string, onChange: (task: Task, event: "INSERT" | "UPDATE" | "DELETE", oldId?: string) => void): RealtimeChannel {
  return supabase
    .channel(`tasks:${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "tasks", filter: `user_id=eq.${userId}` },
      (payload) => {
        if (payload.eventType === "DELETE") {
          onChange(fromTaskRow(payload.old as TaskRow), "DELETE", (payload.old as TaskRow).id);
          return;
        }
        onChange(fromTaskRow(payload.new as TaskRow), payload.eventType as "INSERT" | "UPDATE");
      },
    )
    .subscribe();
}

type MessageRow = {
  id: string;
  user_id: string;
  role: ChatMessage["role"];
  text: string;
  created_at: string;
  // jsonb: an array since one message can carry several files. Rows written
  // before that hold a single object, which fromMessageRow() still reads.
  attachment: ChatAttachment[] | ChatAttachment | null;
  related_task_id: string | null;
};

function toMessageRow(message: ChatMessage, userId: string): MessageRow {
  const attachments = messageAttachments(message);
  return {
    id: message.id,
    user_id: userId,
    role: message.role,
    text: message.text,
    created_at: message.createdAt,
    attachment: attachments.length > 0 ? attachments : null,
    related_task_id: message.relatedTaskId ?? null,
  };
}

function fromMessageRow(row: MessageRow): ChatMessage {
  const attachments = Array.isArray(row.attachment) ? row.attachment : row.attachment ? [row.attachment] : [];
  return {
    id: row.id,
    role: row.role,
    text: row.text,
    createdAt: row.created_at,
    attachments: attachments.length > 0 ? attachments : undefined,
    relatedTaskId: row.related_task_id ?? undefined,
  };
}

export async function fetchMessages(userId: string): Promise<ChatMessage[]> {
  return retryOnJwtTiming(async () => {
    const { data, error } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data as MessageRow[]).map(fromMessageRow);
  });
}

export async function upsertMessageRow(message: ChatMessage, userId: string): Promise<void> {
  const { error } = await supabase.from("chat_messages").upsert(toMessageRow(message, userId));
  if (error) throw error;
}

export async function deleteAllMessages(userId: string): Promise<void> {
  const { error } = await supabase.from("chat_messages").delete().eq("user_id", userId);
  if (error) throw error;
}

export function subscribeToMessages(userId: string, onChange: (message: ChatMessage, event: "INSERT" | "UPDATE") => void): RealtimeChannel {
  return supabase
    .channel(`chat_messages:${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "chat_messages", filter: `user_id=eq.${userId}` },
      (payload) => {
        if (payload.eventType === "DELETE") return;
        onChange(fromMessageRow(payload.new as MessageRow), payload.eventType as "INSERT" | "UPDATE");
      },
    )
    .subscribe();
}
