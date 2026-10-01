import { create } from "zustand";

import { requestReassessment, type ContextSubmission } from "@/lib/ai/reassessTask";
import { PlanLimitError } from "@/lib/plan";
import { applyReassessment, type NoteEdit, type ReassessmentReport } from "@/lib/reassessment";
import { useTaskStore } from "@/store/useTaskStore";

/** A note on its way in: what goes to the AI, and the note that's saved once it's done. */
export type PendingContext = {
  submission: ContextSubmission;
  /** The note as it will be saved — a note and the answer to Nexdo's question about it are saved as one. */
  noteText: string;
};

/**
 * Where one task's latest note stands. Kept here rather than in the screen so
 * it survives leaving Task Details: a reassessment that finishes after the
 * user has gone still has its report waiting when they come back.
 */
export type ReassessState =
  | { status: "running"; pending: PendingContext }
  | { status: "done"; report: ReassessmentReport }
  | { status: "clarify"; pending: PendingContext; question: string }
  // "limit": the month's AI messages are used up (lib/plan.ts) — the note waits, as with any other failure.
  | { status: "error"; pending: PendingContext; reason: "ai" | "save" | "limit" };

type ReassessStore = {
  byTask: Record<string, ReassessState>;
  /**
   * New context for a task from Task Details — a note, an edited note
   * (`replacesNote`), or the answer to a question Nexdo just asked. Nexdo
   * reassesses the whole task for it, saves the result and the note
   * together, and reports what changed. Ignored while one is already running
   * for the task, so a double tap can't send it twice.
   */
  submit: (taskId: string, input: { text: string; replacesNote?: string }) => Promise<void>;
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
  const run = async (taskId: string, pending: PendingContext) => {
    const base = useTaskStore.getState().tasks.find((task) => task.id === taskId);
    if (!base) return setState(taskId, null);
    setState(taskId, { status: "running", pending });

    let proposal: Awaited<ReturnType<typeof requestReassessment>>;
    try {
      proposal = await requestReassessment(base, pending.submission);
    } catch (error) {
      if (error instanceof PlanLimitError) return setState(taskId, { status: "error", pending, reason: "limit" });
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
      if (!text || previous?.status === "running") return;

      // An answer to Nexdo's question goes back together with the note it was
      // about. Editing some other note instead drops the question.
      if (previous?.status === "clarify" && input.replacesNote === undefined) {
        const { noteText, submission } = previous.pending;
        return run(taskId, {
          submission: {
            text,
            replacesNote: submission.replacesNote,
            clarification: { note: noteText, question: previous.question },
          },
          noteText: `${noteText}\n${text}`,
        });
      }
      return run(taskId, { submission: { text, replacesNote: input.replacesNote }, noteText: text });
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
