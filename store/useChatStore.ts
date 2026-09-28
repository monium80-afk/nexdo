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
import { describeConfirmation, describeScopeQuestion } from "@/lib/operationMessages";
import { deleteAllMessages, fetchMessages, subscribeToMessages, upsertMessageRow } from "@/lib/supabaseSync";
import { bulkRecurrenceScope, needsRecurrenceScope, resolveTarget, type TaskOperation } from "@/lib/taskOperations";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTaskStore } from "@/store/useTaskStore";
import type { ChatAttachment, ChatMessage } from "@/types/chat";
import type { Task } from "@/types/task";

const RECENT_TASK_LIMIT = 5;
const HISTORY_TURNS = 6;
// English, French, Spanish and German replies are all understood, whatever the app language.
// A letter lookahead rather than \b, which doesn't treat accented letters as part of a word.
const YES_PATTERN =
  /^(yes|yep|yeah|sure|do it|confirm|ok|okay|go ahead|oui|ouais|d'accord|vas-y|allez-y|confirme|confirmer|s[íi]|claro|vale|dale|de acuerdo|adelante|hazlo|confirma|confirmar|ja|jap|jep|klar|gerne?|genau|passt|einverstanden|los|mach (?:das|es|schon)|mach's|best[äa]tigen?)(?![a-zà-ÿ])/i;
const NO_PATTERN =
  /^(no|nope|cancel|never ?mind|don'?t|non|annule|annuler|laisse tomber|pas maintenant|cancela|cancelar|d[ée]jalo|olv[íi]dalo|mejor no|ahora no|nein|n[öo]|abbrechen|brich ab|lass (?:es|das)|lieber nicht|jetzt nicht|vergiss es)(?![a-zà-ÿ])/i;
// Literal "undo" is intercepted here rather than sent to the AI — see
// TASK_MANAGER_SYSTEM_PROMPT §6.2, which is written assuming this.
const UNDO_PATTERN =
  /^(undo( (that|it))?|revert( (that|it))?|d[ée]faire( [çc]a)?|d[ée]fais( [çc]a)?|deshacer( eso)?|deshazlo|deshaz( eso)?|r[üu]ckg[äa]ngig( machen)?|mach (?:das |es )?r[üu]ckg[äa]ngig|mach's r[üu]ckg[äa]ngig)[.!]?$/i;

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

type PendingAction = { action: StructuredAction; label: string };

// Single-slot "undo the most recent action" (taxonomy 6.2): every task the
// action touched, as it was just before — null for one it created, so undoing
// a create (or the next occurrence a completion brought in) removes it again.
type UndoEntry = { snapshots: { taskId: string; before: Task | null }[] };

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
  /**
   * `attachments` are what the message stores and syncs (storage paths once
   * uploaded). `localAttachments` are the same files, in the same order, still
   * on this device — what actually gets read for extraction, since a storage
   * path isn't a file the device can open. Defaults to `attachments`.
   */
  sendMessage: (
    text: string,
    attachments?: ChatAttachment[],
    contextTaskId?: string,
    localAttachments?: ChatAttachment[],
  ) => string;
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

// The question under a create or breakdown preview when the model didn't
// narrate one (the offline heuristic never does).
function confirmationPrompt(action: StructuredAction): string {
  const t = translate();
  if (action.type === "CREATE_TASK") {
    return action.drafts.length === 1
      ? t.assistant.foundOne(action.drafts[0].title)
      : t.assistant.foundMany(action.drafts.length, action.drafts.map((d) => `"${d.title}"`).join(", "));
  }
  return t.assistant.goAhead;
}

// Undo for the single-task actions that don't come back from the store with
// their own list of touched tasks (task operations and creates do).
function snapshotBefore(action: StructuredAction, tasks: Task[]): { taskId: string; before: Task | null }[] {
  const taskId =
    action.type === "ADD_TASK_CONTEXT" || action.type === "SKIP_TASK" || action.type === "BREAKDOWN_TASK"
      ? action.taskId
      : null;
  const task = taskId ? tasks.find((t) => t.id === taskId) : undefined;
  return task ? [{ taskId: task.id, before: task }] : [];
}

// The model's reply is kept for what it's good at — answers, questions,
// previews of new tasks — but never for a change to existing tasks: that
// message is written from what the change actually did.
const MODEL_REPLY_TYPES: StructuredAction["type"][] = ["CREATE_TASK", "BREAKDOWN_TASK", "ADD_TASK_CONTEXT", "SKIP_TASK", "REDIRECT_NEXT"];

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
      const executeAction = (action: StructuredAction): { message: string; taskId?: string } => {
        if (action.type === "REDIRECT_NEXT") {
          set({ redirectToNext: { minutes: action.availableMinutes } });
          return useTaskStore.getState().applyStructuredAction(action);
        }

        const beforeSnapshots = snapshotBefore(action, useTaskStore.getState().tasks);
        const result = useTaskStore.getState().applyStructuredAction(action);
        const undo = result.undo ?? beforeSnapshots;
        if (undo.length > 0) set({ lastUndo: { snapshots: undo } });
        return result;
      };

      // A turn can carry several actions (compound messages), each with the
      // model's own line about it. Changes to existing tasks are checked
      // against the whole list first: which tasks they really reach, whether a
      // repeating task needs "just this one or all of them?", and whether to
      // ask before going ahead. Everything that needs a yes is queued behind
      // one Yes/No; the rest applies now. The reply is assembled in order —
      // the model's words for answers and previews, the app's for changes.
      const handleClassifiedActions = (actions: StructuredAction[], replies: (string | null)[]) => {
        const t = translate();
        const now = new Date();
        // Auto mode (Settings) skips the preview for adding and updating
        // tasks. A delete that reaches more than one task still always asks —
        // one message can wipe out every task.
        const autoMode = useSettingsStore.getState().aiAutoMode;
        const parts: string[] = [];
        const toConfirm: PendingAction[] = [];
        let lastTaskId: string | undefined;

        const run = (action: StructuredAction, modelReply: string | null) => {
          const result = executeAction(action);
          parts.push(modelReply && MODEL_REPLY_TYPES.includes(action.type) ? modelReply : result.message);
          if (result.taskId) lastTaskId = result.taskId;
        };

        actions.forEach((action, index) => {
          const modelReply = replies[index] ?? null;

          if (action.type === "OPERATE") {
            const { operation } = action;
            const { tasks: targets, missingIds } = resolveTarget(
              useTaskStore.getState().tasks,
              operation.target,
              operation.kind,
              now,
            );
            // Nothing to act on: say so, rather than asking "delete 0 tasks?".
            if (targets.length === 0) {
              parts.push(missingIds.length > 0 ? t.ops.notFound : t.ops.nothingMatched);
              return;
            }
            if (needsRecurrenceScope(operation, targets)) {
              parts.push(describeScopeQuestion(operation, targets, t));
              rememberTask(targets[0].id);
              return;
            }
            // Frozen to the tasks it reaches right now, so the Yes confirms
            // exactly the list that was shown — and, for a bulk request, to
            // how the repeating tasks among them are treated.
            const taskIds = targets.map((task) => task.id);
            const frozenOperation: TaskOperation =
              operation.kind === "update" || operation.kind === "delete"
                ? { ...operation, target: { taskIds }, scope: bulkRecurrenceScope(operation, targets) }
                : { ...operation, target: { taskIds } };
            const frozen: StructuredAction = { ...action, operation: frozenOperation };
            const scopeDefaulted = "scope" in frozenOperation && !!frozenOperation.scope && !("scope" in operation && operation.scope);
            const reachesSeries = operation.kind === "delete" && operation.scope === "series" && targets.some((task) => task.recurrence);
            const mustConfirm =
              operation.kind === "delete"
                ? targets.length > 1 || reachesSeries
                : (targets.length > 1 || action.confirmationTier === "confirm-required") && !autoMode;
            if (mustConfirm) {
              const label = describeConfirmation(frozenOperation, targets, t, scopeDefaulted);
              toConfirm.push({ action: frozen, label });
              parts.push(label);
              return;
            }
            run(frozen, null);
            return;
          }

          if (action.type === "CREATE_TASK" || action.type === "BREAKDOWN_TASK") {
            if (autoMode) {
              run(action, null);
              return;
            }
            const label = modelReply ?? confirmationPrompt(action);
            toConfirm.push({ action, label });
            parts.push(label);
            return;
          }

          run(action, modelReply);
        });

        if (toConfirm.length > 0) set({ pendingActions: toConfirm });
        const separator = parts.some((part) => part.includes("\n")) ? "\n\n" : " ";
        respondWith(parts.join(separator).trim() || t.assistant.done, lastTaskId);
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

        sendMessage: (text, attachments = [], contextTaskId, localAttachments = attachments) => {
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
              const { extracted, failedCount } = await extractAttachmentsText(localAttachments, {
                language: getLanguage(),
                userInstruction: trimmed,
              });
              if (generation !== signOutGeneration) return;

              if (extracted.length === 0) {
                // Nothing readable came back. If they also wrote something,
                // that message is still worth answering on its own.
                if (!trimmed) {
                  set({ pendingActions: [] });
                  // A file that never got read is not a blurry photo — telling
                  // the user to retake it would only send the same failure again.
                  respondWith(
                    failedCount > 0
                      ? translate().chat.attachmentReadFailed
                      : translate().chat.attachmentReplies[attachments[0].kind],
                  );
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

            const { actions, replies } = await classifyIntent({
              text: effectiveText,
              now: new Date(),
              currentTaskId: contextTaskId,
              recentTaskIds: get().recentlyMentionedTaskIds,
              tasks: useTaskStore.getState().tasks,
              history,
            });

            if (generation !== signOutGeneration) return; // signed out / reset mid-request
            handleClassifiedActions(actions, replies);
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
          // Several changes confirmed at once are undone together.
          const undo: { taskId: string; before: Task | null }[] = [];
          const messages = pendingActions.map(({ action }) => {
            set({ lastUndo: null });
            const result = executeAction(action);
            if (result.taskId) lastTaskId = result.taskId;
            undo.push(...(get().lastUndo?.snapshots ?? []));
            return result.message;
          });
          // The earliest snapshot of each task is the one from before all of them.
          const firstSnapshots = new Map<string, Task | null>();
          undo.forEach(({ taskId, before }) => {
            if (!firstSnapshots.has(taskId)) firstSnapshots.set(taskId, before);
          });
          set({
            lastUndo:
              firstSnapshots.size > 0
                ? { snapshots: [...firstSnapshots].map(([taskId, before]) => ({ taskId, before })) }
                : null,
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
          useTaskStore.getState().restoreSnapshots(lastUndo.snapshots);
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
