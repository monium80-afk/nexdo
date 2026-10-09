import { create } from "zustand";

import { extractAttachmentText } from "@/lib/ai/media";
import { requestReassessment, type ContextSubmission } from "@/lib/ai/reassessTask";
import { composeFileNote, parseContextNote, withNoteText, type ContextFileKind } from "@/lib/contextFile";
import { getLanguage } from "@/lib/i18n";
import { PlanLimitError, type Meter } from "@/lib/plan";
import { applyReassessment, type NoteEdit, type ReassessmentReport } from "@/lib/reassessment";
import { useTaskStore } from "@/store/useTaskStore";
import type { ChatAttachment } from "@/types/chat";

/** A photo or document given as context for a task, still on the phone. */
export type ContextAttachment = ChatAttachment & { kind: ContextFileKind };

/** A note on its way in: what goes to the AI, and the note that's saved once it's done. */
export type PendingContext = {
  submission: ContextSubmission;
  /** The note as it will be saved — a note and the answer to Nexdo's question about it are saved as one. */
  noteText: string;
  /**
   * A photo or document still to be read. Once the AI has read it, what it
   * read is in `submission` and `noteText` (lib/contextFile.ts) and this is
   * gone — so a retry after that point doesn't read the file a second time.
   */
  file?: ContextAttachment;
};

/**
 * Where one task's latest note stands. Kept here rather than in the screen so
 * it survives leaving Task Details: a reassessment that finishes after the
 * user has gone still has its report waiting when they come back.
 */
export type ReassessState =
  // While `pending.file` is set, the file is still being read.
  | { status: "running"; pending: PendingContext }
  | { status: "done"; report: ReassessmentReport }
  | { status: "clarify"; pending: PendingContext; question: string }
  // "limit": a month's allowance is used up (lib/plan.ts) — context notes, or
  // photos and documents for a file — and the note waits, as with any other
  // failure. "file": the file couldn't be read; "empty": nothing in it could.
  | { status: "error"; pending: PendingContext; reason: "ai" | "save" | "limit" | "file" | "empty"; meter?: Meter };

type ReassessStore = {
  byTask: Record<string, ReassessState>;
  /**
   * New context for a task from Task Details or a focus session — a note, a
   * photo or document (with or without words), an edited note
   * (`replacesNote`), or the answer to a question Nexdo just asked. Nexdo
   * reads the file if there is one, reassesses the whole task for it, saves
   * the result and the note together, and reports what changed. Ignored
   * while one is already running for the task, so a double tap can't send it
   * twice.
   */
  submit: (taskId: string, input: { text: string; replacesNote?: string; file?: ContextAttachment }) => Promise<void>;
  /** Sends a failed note again. */
  retry: (taskId: string) => Promise<void>;
  /** Hides the report — or drops a note that failed or is waiting for an answer. Never touches the task. */
  dismiss: (taskId: string) => void;
};

export const useReassessStore = create<ReassessStore>()((set, get) => {
  const setState = (taskId: string, state: ReassessState | null) =>
    set((current) => {
      const byTask = { ...current.byTask };
      if (state) byTask[taskId] = state;
      else delete byTask[taskId];
      return { byTask };
    });

  // Nothing about the task changes until the AI has answered AND the save has
  // gone through: a failure at either point leaves the task exactly as it was
  // and the note waiting to be tried again.
  const run = async (taskId: string, given: PendingContext) => {
    let pending = given;
    const task = useTaskStore.getState().tasks.find((entry) => entry.id === taskId);
    if (!task) return setState(taskId, null);
    setState(taskId, { status: "running", pending });

    // A file is read first: what the AI reads in it becomes the note, after
    // the user's own words, which also tell the reading what to look for.
    if (pending.file) {
      let fileText: string;
      try {
        fileText = await extractAttachmentText(pending.file, {
          language: getLanguage(),
          userInstruction: pending.noteText,
          forTask: { title: task.title },
        });
      } catch (error) {
        if (error instanceof PlanLimitError) {
          return setState(taskId, { status: "error", pending, reason: "limit", meter: error.meter });
        }
        console.warn("[useReassessStore] reading the file failed", error);
        return setState(taskId, { status: "error", pending, reason: "file" });
      }
      if (!fileText) return setState(taskId, { status: "error", pending, reason: "empty" });
      const note = composeFileNote(pending.file.kind, fileText, pending.noteText);
      pending = { submission: { ...pending.submission, text: note }, noteText: note };
      setState(taskId, { status: "running", pending });
    }

    // Read now, not before the file: the task may have changed while it was read.
    const base = useTaskStore.getState().tasks.find((entry) => entry.id === taskId);
    if (!base) return setState(taskId, null);

    let proposal: Awaited<ReturnType<typeof requestReassessment>>;
    try {
      proposal = await requestReassessment(base, pending.submission);
    } catch (error) {
      if (error instanceof PlanLimitError) {
        return setState(taskId, { status: "error", pending, reason: "limit", meter: error.meter });
      }
      console.warn("[useReassessStore] reassessment failed", error);
      return setState(taskId, { status: "error", pending, reason: "ai" });
    }

    // Too unclear to act on: ask, and change nothing — not even the note,
    // which is saved with the answer.
    if (proposal.outcome === "clarify") {
      return setState(taskId, { status: "clarify", pending, question: proposal.question });
    }

    const { replacesNote } = pending.submission;
    const note: NoteEdit =
      replacesNote !== undefined
        ? { kind: "replace", previous: replacesNote, text: pending.noteText }
        : { kind: "add", text: pending.noteText };
    // Set by the last build: saveTaskNow may rebuild on a newer version of the task.
    let report = null as ReassessmentReport | null;
    try {
      const saved = await useTaskStore.getState().saveTaskNow(taskId, (current) => {
        const applied = applyReassessment({
          base,
          current,
          proposal,
          note,
          now: new Date(),
          allTasks: useTaskStore.getState().tasks,
        });
        report = applied.report;
        return applied.task;
      });
      // Deleted while Nexdo worked: there's no task left to report on.
      if (!saved.ok && saved.reason === "missing") return setState(taskId, null);
      if (!saved.ok || !report) return setState(taskId, { status: "error", pending, reason: "save" });
    } catch (error) {
      console.warn("[useReassessStore] saving the reassessment failed", error);
      return setState(taskId, { status: "error", pending, reason: "save" });
    }
    // Only now, with the change saved, is the user told about it.
    if (report) setState(taskId, { status: "done", report });
  };

  return {
    byTask: {},

    submit: async (taskId, input) => {
      const text = input.text.trim();
      const previous = get().byTask[taskId];
      if ((!text && !input.file) || previous?.status === "running") return;

      // An answer to Nexdo's question goes back together with the note it was
      // about — its words joined to the note's own, ahead of any file it
      // carries. Editing some other note, or sending a file, drops the question.
      if (previous?.status === "clarify" && input.replacesNote === undefined && !input.file) {
        const { noteText, submission } = previous.pending;
        return run(taskId, {
          submission: {
            text,
            replacesNote: submission.replacesNote,
            clarification: { note: noteText, question: previous.question },
          },
          noteText: withNoteText(noteText, `${parseContextNote(noteText).text}\n${text}`),
        });
      }
      return run(taskId, {
        submission: { text, replacesNote: input.replacesNote },
        noteText: text,
        ...(input.file ? { file: input.file } : {}),
      });
    },

    retry: async (taskId) => {
      const state = get().byTask[taskId];
      if (state?.status === "error") await run(taskId, state.pending);
    },

    dismiss: (taskId) => {
      if (get().byTask[taskId]?.status !== "running") setState(taskId, null);
    },
  };
});
