import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { composeAttachmentMessage } from "@/lib/ai/attachmentMessage";
import { classifyIntent } from "@/lib/ai/classifyIntent";
import { extractAttachmentsText } from "@/lib/ai/media";
import type { ExtractedTaskDraft, StructuredAction } from "@/lib/ai/types";
import { isImageAttachment } from "@/lib/chatAttachments";
import { getLanguage, translate } from "@/lib/i18n";
import { deleteAllMessages, fetchMessages, subscribeToMessages, upsertMessageRow } from "@/lib/supabaseSync";
import { describeTaskCount, tasksInScope } from "@/lib/taskMeta";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTaskStore } from "@/store/useTaskStore";
import type { ChatAttachment, ChatMessage } from "@/types/chat";
import type { Task } from "@/types/task";

const RECENT_TASK_LIMIT = 5;
const HISTORY_TURNS = 6;
// English and French replies are both understood, whatever the app language.
// A letter lookahead rather than \b, which doesn't treat accented letters as part of a word.
const YES_PATTERN = /^(yes|yep|yeah|sure|do it|confirm|ok|okay|go ahead|oui|ouais|d'accord|vas-y|allez-y|confirme|confirmer)(?![a-zà-ÿ])/i;
const NO_PATTERN = /^(no|nope|cancel|never ?mind|don'?t|non|annule|annuler|laisse tomber|pas maintenant)(?![a-zà-ÿ])/i;
// Literal "undo" is intercepted here rather than sent to the AI — see
// TASK_MANAGER_SYSTEM_PROMPT §6.2, which is written assuming this.
const UNDO_PATTERN = /^(undo( (that|it))?|revert( (that|it))?|d[ée]faire( [çc]a)?|d[ée]fais( [çc]a)?)[.!]?$/i;

// Invalidates any in-flight classifyIntent() call so its response is
// dropped if the user signs out (or the store resets) before it resolves —
// the async request has no way to know the chat underneath it changed.
let signOutGeneration = 0;

// Same local-first background sync approach as useTaskStore.
let realtimeChannel: RealtimeChannel | null = null;

function syncUpsert(message: ChatMessage, userId: string | null) {
  if (!userId) return;
  upsertMessageRow(message, userId).catch((error) => console.warn("[useChatStore] upsert failed", error));
}

function createMessageId(role: "user" | "ai" | "seed"): string {
  return `message-${role}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const AUTO_MODE_ACTION_TYPES: StructuredAction["type"][] = ["CREATE_TASK", "UPDATE_TASK", "BREAKDOWN_TASK"];

type PendingAction = { action: StructuredAction; label: string; taskIds?: string[] };

// Single-slot "undo the most recent action" (taxonomy 6.2). A create is
// undone by deleting the task(s) it made; anything else is undone by
// restoring a snapshot of the task taken right before the mutation.
type UndoEntry =
  | { kind: "create"; taskIds: string[] }
  | { kind: "restore"; snapshots: { taskId: string; before: Task | null }[] };

type ChatStore = {
  messages: ChatMessage[];
  isAiTyping: boolean;
  recentlyMentionedTaskIds: string[];
  pendingActions: PendingAction[];
  lastUndo: UndoEntry | null;
  redirectToNext: { minutes: number } | null;
  syncUserId: string | null;
  hydrateFromSupabase: (userId: string) => Promise<void>;
  subscribeToRealtime: (userId: string) => void;
  unsubscribeFromRealtime: () => void;
  sendMessage: (text: string, attachments?: ChatAttachment[], contextTaskId?: string) => string;
  seedMessage: (text: string, relatedTaskId?: string) => void;
  updateMessageAttachments: (messageId: string, attachments: ChatAttachment[]) => void;
  updateMessageText: (messageId: string, text: string) => void;
  updatePendingDraft: (actionIndex: number, draftIndex: number, patch: Partial<ExtractedTaskDraft>) => void;
  confirmPendingActions: () => void;
  confirmPendingDraft: (actionIndex: number, draftIndex: number) => void;
  confirmAllPendingDrafts: () => void;
  dismissPendingDraft: (actionIndex: number, draftIndex: number) => void;
  cancelPendingActions: () => void;
  undoLastAction: () => void;
  clearRedirectToNext: () => void;
  clearHistory: () => Promise<void>;
  handleSignOut: () => Promise<void>;
};

// The chat screen shows the "welcome" message in the current app language
// (see ChatBubble), so switching language updates it too.
const initialMessages = (): ChatMessage[] => [
  {
    id: "welcome",
    role: "ai",
    text: translate().chat.welcome,
    createdAt: new Date().toISOString(),
  },
];

// Only used when the offline heuristic fallback produces a confirm-required
// action — the real AI path always has its own narrated "reply" instead.
// A bulk delete's confirmation also uses this on the real AI path — only the
// app can count exactly how many tasks it's about to remove.
function confirmationPrompt(action: StructuredAction, frozenTaskIds?: string[]): string {
  const t = translate();
  switch (action.type) {
    case "CREATE_TASK":
      return action.drafts.length === 1
        ? t.assistant.foundOne(action.drafts[0].title)
        : t.assistant.foundMany(action.drafts.length, action.drafts.map((d) => `"${d.title}"`).join(", "));
    case "DELETE_TASKS": {
      const count = frozenTaskIds?.length ?? tasksInScope(useTaskStore.getState().tasks, action.scope).length;
      return t.assistant.confirmBulkDelete(describeTaskCount(count, action.scope), action.scope === "all");
    }
    default:
      return t.assistant.goAhead;
  }
}

// What to snapshot before mutating, so undo can restore it verbatim.
// CREATE_TASK is handled separately (undo = delete the new task), and
// read-only/routing actions (QUERY, CLARIFY, UNKNOWN, REDIRECT_NEXT) never
// touch a task, so there's nothing to snapshot.
function snapshotBefore(
  action: StructuredAction,
  tasks: Task[],
  frozenTaskIds?: string[],
): { taskId: string; before: Task | null }[] {
  if (action.type === "DELETE_TASKS" || action.type === "COMPLETE_TASKS") {
    const scope = action.type === "DELETE_TASKS" ? action.scope : "pending";
    const ids = frozenTaskIds ?? tasksInScope(tasks, scope).map((task) => task.id);
    return ids.flatMap((taskId) => {
      const task = tasks.find((candidate) => candidate.id === taskId);
      return task ? [{ taskId, before: task }] : [];
    });
  }

  const taskId =
    action.type === "UPDATE_TASK" ||
    action.type === "COMPLETE_TASK" ||
    action.type === "DELETE_TASK" ||
    action.type === "ADD_TASK_CONTEXT" ||
    action.type === "RESCHEDULE_TASK" ||
    action.type === "SKIP_TASK" ||
    action.type === "BREAKDOWN_TASK"
      ? action.taskId
      : null;
  if (!taskId) return [];
  const task = tasks.find((t) => t.id === taskId);
  return task ? [{ taskId, before: task }] : [];
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => {
      const pushMessage = (message: ChatMessage) => {
        set((state) => ({ messages: [...state.messages, message] }));
        syncUpsert(message, get().syncUserId);
      };

      const rememberTask = (taskId?: string) => {
        if (!taskId) return;
        set((state) => ({
          recentlyMentionedTaskIds: [taskId, ...state.recentlyMentionedTaskIds.filter((id) => id !== taskId)].slice(
            0,
            RECENT_TASK_LIMIT,
          ),
        }));
      };

      const respondWith = (text: string, relatedTaskId?: string) => {
        pushMessage({
          id: createMessageId("ai"),
          role: "ai",
          text,
          createdAt: new Date().toISOString(),
          relatedTaskId,
        });
        rememberTask(relatedTaskId);
        set({ isAiTyping: false });
      };

      // Applies one action, and — unless it's a pure read/route — records
      // enough to undo it later as this turn's most recent mutation.
      const executeAction = (action: StructuredAction, frozenTaskIds?: string[]): { message: string; taskId?: string } => {
        if (action.type === "REDIRECT_NEXT") {
          set({ redirectToNext: { minutes: action.availableMinutes } });
          return useTaskStore.getState().applyStructuredAction(action);
        }

        const beforeSnapshots = snapshotBefore(action, useTaskStore.getState().tasks, frozenTaskIds);
        const actionToExecute =
          action.type === "DELETE_TASKS" && frozenTaskIds
            ? { ...action, taskIds: frozenTaskIds }
            : action;
        const result = useTaskStore.getState().applyStructuredAction(actionToExecute);

        if (action.type === "CREATE_TASK") {
          const ids = result.taskIds ?? (result.taskId ? [result.taskId] : []);
          if (ids.length > 0) set({ lastUndo: { kind: "create", taskIds: ids } });
        } else if (beforeSnapshots.length > 0) {
          set({ lastUndo: { kind: "restore", snapshots: beforeSnapshots } });
        }

        return result;
      };

      // A turn can carry several actions (compound messages) plus one
      // narrated "reply" covering all of them. Confirm-required actions are
      // queued together behind a single Yes/No; everything else applies now.
      const handleClassifiedActions = (actions: StructuredAction[], narratedReply: string | null) => {
        // A bulk delete that matches nothing has nothing to confirm — say so
        // instead of asking "delete 0 tasks?".
        // Same for "mark everything done" with nothing pending.
        const emptyBulkDeletes = actions.filter(
          (a) =>
            (a.type === "DELETE_TASKS" && tasksInScope(useTaskStore.getState().tasks, a.scope).length === 0) ||
            (a.type === "COMPLETE_TASKS" && tasksInScope(useTaskStore.getState().tasks, "pending").length === 0),
        );
        const actionable = actions.filter((a) => !emptyBulkDeletes.includes(a));
        // Auto mode (Settings) skips the preview for adding and updating
        // tasks. A bulk delete still always asks — one message can wipe out
        // every task.
        const autoMode = useSettingsStore.getState().aiAutoMode;
        const needsConfirmation = (a: StructuredAction) =>
          a.confirmationTier === "confirm-required" && !(autoMode && AUTO_MODE_ACTION_TYPES.includes(a.type));
        const confirmRequired = actionable.filter(needsConfirmation);
        const immediate = actionable.filter((a) => !needsConfirmation(a));

        let lastTaskId: string | undefined;
        const t = translate();
        const executedMessages: string[] = emptyBulkDeletes.map((a) =>
          a.type === "COMPLETE_TASKS"
            ? t.assistant.noPendingToComplete
            : a.type === "DELETE_TASKS" && a.scope !== "all"
              ? t.assistant.noScopedToDelete(a.scope)
              : t.assistant.noTasksToDelete,
        );
        for (const action of immediate) {
          const result = executeAction(action);
          executedMessages.push(result.message);
          if (result.taskId) lastTaskId = result.taskId;
        }

        if (confirmRequired.length > 0) {
          set({
            pendingActions: confirmRequired.map((action) => {
              const taskIds =
                action.type === "DELETE_TASKS"
                  ? tasksInScope(useTaskStore.getState().tasks, action.scope).map((task) => task.id)
                  : undefined;
              return { action, taskIds, label: narratedReply ?? confirmationPrompt(action, taskIds) };
            }),
          });
        }

        const fallbackMessage =
          [...executedMessages, ...confirmRequired.map((action) => confirmationPrompt(action))].join(" ") ||
          t.assistant.done;
        respondWith(emptyBulkDeletes.length > 0 ? fallbackMessage : narratedReply ?? fallbackMessage, lastTaskId);
      };

      return {
        messages: initialMessages(),
        isAiTyping: false,
        recentlyMentionedTaskIds: [],
        pendingActions: [],
        lastUndo: null,
        redirectToNext: null,
        syncUserId: null,

        // Supabase becomes the source of truth for a signed-in user, same
        // as useTaskStore — an empty remote result means this user has no
        // synced history yet, so the local welcome message stays put.
        hydrateFromSupabase: async (userId) => {
          set({ syncUserId: userId });
          try {
            const remoteMessages = await fetchMessages(userId);
            if (get().syncUserId === userId) {
              set({ messages: remoteMessages.length > 0 ? remoteMessages : initialMessages() });
            }
          } catch (error) {
            console.warn("[useChatStore] hydrate failed", error);
          }
        },

        subscribeToRealtime: (userId) => {
          if (realtimeChannel) return;
          realtimeChannel = subscribeToMessages(userId, (message) => {
            set((state) => {
              if (state.messages.some((m) => m.id === message.id)) {
                return { messages: state.messages.map((m) => (m.id === message.id ? message : m)) };
              }
              const insertAt = state.messages.findIndex((m) => m.createdAt > message.createdAt);
              const messages = [...state.messages];
              messages.splice(insertAt === -1 ? messages.length : insertAt, 0, message);
              return { messages };
            });
          });
        },

        unsubscribeFromRealtime: () => {
          realtimeChannel?.unsubscribe();
          realtimeChannel = null;
        },

        updateMessageAttachments: (messageId, attachments) => {
          set((state) => ({
            messages: state.messages.map((m) =>
              m.id === messageId ? { ...m, attachments, attachment: undefined } : m,
            ),
          }));
          const updated = get().messages.find((m) => m.id === messageId);
          if (updated) syncUpsert(updated, get().syncUserId);
        },

        updateMessageText: (messageId, text) => {
          set((state) => ({
            messages: state.messages.map((m) => (m.id === messageId ? { ...m, text } : m)),
          }));
          const updated = get().messages.find((m) => m.id === messageId);
          if (updated) syncUpsert(updated, get().syncUserId);
        },

        sendMessage: (text, attachments = [], contextTaskId) => {
          const trimmed = text.trim();
          if (!trimmed && attachments.length === 0) return "";

          const userMessage: ChatMessage = {
            id: createMessageId("user"),
            role: "user",
            // Only what the user typed. An attachment speaks for itself in the
            // bubble (a thumbnail for an image), so no file name stands in for
            // it — an image-only message is simply a bubble with no text.
            text: trimmed,
            createdAt: new Date().toISOString(),
            attachments: attachments.length > 0 ? attachments : undefined,
            relatedTaskId: contextTaskId,
          };
          const historyBeforeThisMessage = get().messages;
          set((state) => ({ messages: [...state.messages, userMessage], isAiTyping: true }));
          syncUpsert(userMessage, get().syncUserId);

          const generation = signOutGeneration;

          (async () => {
            // Each photo/voice note/document is read to plain text first, then
            // that text and whatever the user typed go through the exact same
            // pipeline as a typed message — see ATTACHED FILES in
            // TASK_MANAGER_SYSTEM_PROMPT, which is written against the shape
            // composeAttachmentMessage() produces.
            let effectiveText = trimmed;
            if (attachments.length > 0) {
              const extracted = await extractAttachmentsText(attachments, {
                language: getLanguage(),
                userInstruction: trimmed,
              });
              if (generation !== signOutGeneration) return;

              if (extracted.length === 0) {
                // Nothing readable came back. If they also wrote something,
                // that message is still worth answering on its own.
                if (!trimmed) {
                  set({ pendingActions: [] });
                  respondWith(translate().chat.attachmentReplies[attachments[0].kind]);
                  return;
                }
              } else {
                effectiveText = composeAttachmentMessage(extracted, trimmed);
                // A voice note or document has nothing to show in a bubble, so
                // what was heard/read stands in for it — but only when the user
                // didn't write their own message, which is what the bubble
                // should keep showing. An image always shows itself, so it
                // never overwrites anything.
                if (!trimmed && !attachments.some(isImageAttachment)) {
                  get().updateMessageText(userMessage.id, extracted.map((item) => item.text).join("\n\n"));
                }
              }
            }

            if (UNDO_PATTERN.test(effectiveText)) {
              get().undoLastAction();
              return;
            }

            const { pendingActions } = get();
            if (pendingActions.length > 0) {
              if (YES_PATTERN.test(effectiveText)) {
                get().confirmPendingActions();
                return;
              }
              if (NO_PATTERN.test(effectiveText)) {
                get().cancelPendingActions();
                return;
              }
              set({ pendingActions: [] });
            }

            const history = historyBeforeThisMessage.slice(-HISTORY_TURNS).map((message) => ({
              role: message.role,
              text: message.text,
            }));

            const { actions, reply } = await classifyIntent({
              text: effectiveText,
              now: new Date(),
              currentTaskId: contextTaskId,
              recentTaskIds: get().recentlyMentionedTaskIds,
              tasks: useTaskStore.getState().tasks,
              history,
            });

            if (generation !== signOutGeneration) return; // signed out / reset mid-request
            handleClassifiedActions(actions, reply);
          })().catch((error) => {
            // Nothing above is expected to reject — classifyIntent and
            // extractAttachmentsText both absorb their own failures — but this
            // is fire-and-forget, so anything that did would surface as an
            // unhandled rejection *and* leave isAiTyping stuck on, spinning the
            // typing bubble for the rest of the session.
            console.warn("[useChatStore] sendMessage failed", error);
            if (generation !== signOutGeneration) return;
            respondWith(translate().common.aiUnreachable);
          });

          return userMessage.id;
        },

        seedMessage: (text, relatedTaskId) => {
          pushMessage({
            id: createMessageId("seed"),
            role: "ai",
            text,
            createdAt: new Date().toISOString(),
            relatedTaskId,
          });
        },

        // "Edit details" on a TaskConfirmationCard writes straight back into
        // the queued draft, so confirming adds exactly what's on screen.
        updatePendingDraft: (actionIndex, draftIndex, patch) => {
          set((state) => ({
            pendingActions: state.pendingActions.map((pending, index) => {
              if (index !== actionIndex || pending.action.type !== "CREATE_TASK") return pending;
              return {
                ...pending,
                action: {
                  ...pending.action,
                  drafts: pending.action.drafts.map((draft, i) => (i === draftIndex ? { ...draft, ...patch } : draft)),
                },
              };
            }),
          }));
        },

        confirmPendingActions: () => {
          const { pendingActions } = get();
          if (pendingActions.length === 0) return;
          set({ pendingActions: [] });
          let lastTaskId: string | undefined;
          const messages = pendingActions.map(({ action, taskIds }) => {
            const result = executeAction(action, taskIds);
            if (result.taskId) lastTaskId = result.taskId;
            return result.message;
          });
          respondWith(messages.join(" "), lastTaskId);
        },

        // "Add Task" on one card adds only that card's draft — the other
        // drafts stay queued so they can still be added or dismissed.
        confirmPendingDraft: (actionIndex, draftIndex) => {
          const pending = get().pendingActions[actionIndex];
          if (!pending || pending.action.type !== "CREATE_TASK") return;
          const draft = pending.action.drafts[draftIndex];
          if (!draft) return;

          const remainingDrafts = pending.action.drafts.filter((_, i) => i !== draftIndex);
          set((state) => ({
            pendingActions: state.pendingActions.flatMap((item, index) => {
              if (index !== actionIndex || item.action.type !== "CREATE_TASK") return [item];
              return remainingDrafts.length > 0 ? [{ ...item, action: { ...item.action, drafts: remainingDrafts } }] : [];
            }),
          }));

          const result = executeAction({ type: "CREATE_TASK", drafts: [draft], confirmationTier: "confirm-required" });
          respondWith(result.message, result.taskId);
        },

        // "Add all tasks" — every queued draft at once. Any non-task action
        // in the same turn (e.g. a bulk delete) keeps its own Yes/Cancel.
        confirmAllPendingDrafts: () => {
          const { pendingActions } = get();
          const drafts = pendingActions.flatMap((pending) =>
            pending.action.type === "CREATE_TASK" ? pending.action.drafts : [],
          );
          if (drafts.length === 0) return;
          set({ pendingActions: pendingActions.filter((pending) => pending.action.type !== "CREATE_TASK") });

          const result = executeAction({ type: "CREATE_TASK", drafts, confirmationTier: "confirm-required" });
          respondWith(result.message, result.taskId);
        },

        // "Cancel" on one card drops only that card's draft — the other
        // drafts stay queued.
        dismissPendingDraft: (actionIndex, draftIndex) => {
          set((state) => ({
            pendingActions: state.pendingActions.flatMap((item, index) => {
              if (index !== actionIndex || item.action.type !== "CREATE_TASK") return [item];
              const remainingDrafts = item.action.drafts.filter((_, i) => i !== draftIndex);
              return remainingDrafts.length > 0 ? [{ ...item, action: { ...item.action, drafts: remainingDrafts } }] : [];
            }),
          }));
        },

        cancelPendingActions: () => {
          if (get().pendingActions.length === 0) return;
          set({ pendingActions: [] });
          respondWith(translate().assistant.wontChange);
        },

        undoLastAction: () => {
          const { lastUndo } = get();
          if (!lastUndo) {
            respondWith(translate().assistant.nothingToUndo);
            return;
          }
          set({ lastUndo: null });
          if (lastUndo.kind === "create") {
            lastUndo.taskIds.forEach((id) => useTaskStore.getState().restoreTaskSnapshot(id, null));
          } else {
            lastUndo.snapshots.forEach(({ taskId, before }) => useTaskStore.getState().restoreTaskSnapshot(taskId, before));
          }
          respondWith(translate().assistant.undone);
        },

        clearRedirectToNext: () => set({ redirectToNext: null }),

        // Wipes the conversation (locally and in Supabase, or hydrate would
        // bring it straight back) but leaves the user signed in and their
        // tasks untouched.
        clearHistory: async () => {
          signOutGeneration += 1; // drop any AI reply still in flight
          set({
            messages: initialMessages(),
            isAiTyping: false,
            recentlyMentionedTaskIds: [],
            pendingActions: [],
            lastUndo: null,
            redirectToNext: null,
          });
          const userId = get().syncUserId;
          if (userId) await deleteAllMessages(userId);
        },

        handleSignOut: async () => {
          signOutGeneration += 1;
          realtimeChannel?.unsubscribe();
          realtimeChannel = null;
          set({
            messages: initialMessages(),
            isAiTyping: false,
            recentlyMentionedTaskIds: [],
            pendingActions: [],
            lastUndo: null,
            redirectToNext: null,
            syncUserId: null,
          });
          await AsyncStorage.removeItem("nexdo-chat");
        },
      };
    },
    {
      name: "nexdo-chat",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ messages: state.messages }),
    },
  ),
);
