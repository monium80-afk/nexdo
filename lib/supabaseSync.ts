import type { RealtimeChannel } from "@supabase/supabase-js";

import { messageAttachments } from "@/lib/chatAttachments";
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
};

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
  };
}

function fromTaskRow(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
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

export async function upsertTaskRow(task: Task, userId: string): Promise<void> {
  const { error } = await supabase.from("tasks").upsert(toTaskRow(task, userId));
  if (error) throw error;
}

// Scoped to the owner as well as the id. RLS already enforces this server
// side, but every other query here says whose rows it means, and a delete is
// the one that costs the most if a policy is ever loosened by accident.
export async function deleteTaskRow(taskId: string, userId: string): Promise<void> {
  const { error } = await supabase.from("tasks").delete().eq("id", taskId).eq("user_id", userId);
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
