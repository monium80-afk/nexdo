import { Feather } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { BreakdownSheetHeader } from "@/components/BreakdownSheetHeader";
import { AppIcon } from "@/components/icons/AppIcons";
import { PaperSheet } from "@/components/PaperSheet";
import { ReportAiButton } from "@/components/ReportAiButton";
import { shadow } from "@/constants/shadow";
import { colors, listItemEntering, listItemLayout } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import type { PlanStep } from "@/lib/ai/types";
import type { StepDraft, Task } from "@/types/task";

const P = colors.palette;
const ROW_SHADOW = shadow("0 4px 14px rgba(34, 28, 23, 0.05)", 2);
const EDIT_SHADOW = shadow("0 8px 20px rgba(242, 106, 46, 0.16)", 4, "#F26A2E");
const CHECK_SHADOW = shadow("0 4px 10px rgba(242, 106, 46, 0.35)", 4, "#F26A2E");

// A step added by hand, until the task's steps say otherwise (as addSubtask).
const NEW_STEP_MINUTES = 10;

function newStepId(index = 0): string {
  return `subtask-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 6)}`;
}

/** The task's steps as they are now, in order — where the draft starts. */
function draftOf(task: Task): StepDraft[] {
  return (task.subtasks ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((subtask) => ({
      id: subtask.id,
      label: subtask.label,
      estimatedMinutes: subtask.estimatedMinutes,
      completed: subtask.status === "completed",
    }));
}

/**
 * The AI's steps in place of the unfinished ones it was shown; the ones
 * already done stay, first. A step added while it worked (not in `sentIds`)
 * is the user's own and stays too, after the AI's.
 */
function withNewSteps(draft: StepDraft[], steps: PlanStep[], sentIds: Set<string>): StepDraft[] {
  return [
    ...draft.filter((step) => step.completed),
    ...steps.map((step, index) => ({
      id: newStepId(index),
      label: step.title,
      estimatedMinutes: step.estimatedMinutes,
      completed: false,
    })),
    ...draft.filter((step) => !step.completed && !sentIds.has(step.id)),
  ];
}

type Editing = { id: string; text: string } | null;

/** The draft with the step being edited written in — or dropped, if it was emptied. */
function withEdit(steps: StepDraft[], editing: Editing): StepDraft[] {
  if (!editing) return steps;
  const label = editing.text.trim();
  return label
    ? steps.map((step) => (step.id === editing.id ? { ...step, label } : step))
    : steps.filter((step) => step.id !== editing.id);
}

/** A step's number in its peach dot — solid orange while it's edited, a tick once done. */
function StepNumber({ index, done, editing }: { index: number; done: boolean; editing: boolean }) {
  return (
    <View
      style={{
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: editing ? P.accent : P.peach,
      }}
    >
      {done && !editing ? (
        <AppIcon name="check" size={14} strokeWidth={3} color={P.accentInk} />
      ) : (
        <Text style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 15, color: editing ? "#FFFFFF" : P.accentInk, includeFontPadding: false }}>
          {index + 1}
        </Text>
      )}
    </View>
  );
}

/**
 * "Your plan" (the user's screenshot, 2026-11-10): the AI's steps, numbered,
 * each one renamed with the pencil (the row turns white with an orange edge
 * and a round tick to keep it) or removed with the bin; "Add a step" under
 * them; then Regenerate and "Start step 1".
 *
 * Everything here is a draft until that button (the user's call,
 * 2026-10-08): closing the sheet any other way — ✕, the scrim, Back — leaves
 * the task's steps exactly as they were.
 */
export function BreakdownSheet({
  visible,
  task,
  status,
  autoGenerate,
  onGenerate,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  task: Task;
  status: "idle" | "loading" | "error";
  /** Ask the AI for steps straight away. */
  autoGenerate: boolean;
  /** New steps from the AI for the work this draft has left (useTaskAiAssist), or null. */
  onGenerate: (draft: StepDraft[]) => Promise<PlanStep[] | null>;
  /** The steps to save. */
  onConfirm: (steps: StepDraft[]) => void;
  /** Closed without confirming: nothing is saved. */
  onClose: () => void;
}) {
  const t = useTranslation();
  const rtl = useRtlText();
  // A new sheet starts from the task as it is (mounted fresh each time it opens).
  const [steps, setSteps] = useState(() => draftOf(task));
  const [editing, setEditing] = useState<Editing>(null);
  // The steps the AI wrote last, for its Report link — none until it has.
  const [aiSteps, setAiSteps] = useState<PlanStep[]>([]);
  const isLoading = status === "loading";

  const generate = async () => {
    const draft = withEdit(steps, editing);
    setEditing(null);
    setSteps(draft);
    const sentIds = new Set(draft.map((step) => step.id));
    const next = await onGenerate(draft);
    if (!next) return;
    setAiSteps(next);
    setSteps((current) => withNewSteps(current, next, sentIds));
  };

  // Once, as the sheet opens.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoGenerate || autoStarted.current) return;
    autoStarted.current = true;
    void generate();
  });

  /** Keeps whatever is being edited, then edits `id` (or nothing). */
  const editStep = (id: string | null) => {
    const kept = withEdit(steps, editing);
    setSteps(kept);
    const step = id ? kept.find((entry) => entry.id === id) : undefined;
    setEditing(step ? { id: step.id, text: step.label } : null);
  };

  const handleAdd = () => {
    const kept = withEdit(steps, editing);
    const id = newStepId(kept.length);
    setSteps([...kept, { id, label: "", estimatedMinutes: NEW_STEP_MINUTES, completed: false }]);
    setEditing({ id, text: "" });
  };

  const handleDelete = (id: string) => {
    if (editing?.id === id) setEditing(null);
    setSteps((current) => current.filter((step) => step.id !== id));
  };

  // What would be saved now — a step still being edited counts, as written.
  const final = withEdit(steps, editing).filter((step) => step.label.trim());
  const firstOpen = final.findIndex((step) => !step.completed);
  const confirmLabel = firstOpen >= 0 ? t.breakdown.startStep(firstOpen + 1) : t.breakdown.confirm;
  const handleConfirm = () => onConfirm(final);

  const shownCount = steps.filter((step) => step.label.trim() || step.id === editing?.id).length;
  const title = shownCount === 0 && isLoading ? t.breakdown.breakingDown : t.breakdown.smallSteps(shownCount);

  return (
    <PaperSheet visible={visible} onClose={onClose} blur>
      <BreakdownSheetHeader
        eyebrow={t.breakdown.planEyebrow}
        title={title}
        subtitle={task.title}
        closeLabel={t.breakdown.close}
        onClose={onClose}
      />

      {status === "error" ? (
        <Text style={[{ marginTop: 10, fontFamily: "SpaceGrotesk-Medium", fontSize: 14, color: P.alert }, rtl]}>{t.common.aiUnreachable}</Text>
      ) : null}

      <ScrollView
        // Shrinks so a long list scrolls inside the sheet instead of pushing
        // the buttons past its foot.
        style={{ flexGrow: 0, flexShrink: 1, marginTop: 16 }}
        contentContainerStyle={{ gap: 8, paddingBottom: 2 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {steps.length === 0 && isLoading ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 24 }}>
            <ActivityIndicator size="small" color={P.accent} />
          </View>
        ) : null}

        {steps.map((step, index) => {
          const isEditing = editing?.id === step.id;
          return (
            <Animated.View key={step.id} entering={listItemEntering(index)} layout={listItemLayout()}>
              {isEditing ? (
                <View
                  style={[
                    {
                      minHeight: 56,
                      borderRadius: 22,
                      borderWidth: 2,
                      borderColor: P.accent,
                      backgroundColor: "#FFFFFF",
                      paddingLeft: 14,
                      paddingRight: 8,
                      paddingVertical: 6,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                    },
                    EDIT_SHADOW,
                  ]}
                >
                  <StepNumber index={index} done={step.completed} editing />
                  <TextInput
                    value={editing.text}
                    onChangeText={(text) => setEditing({ id: step.id, text })}
                    autoFocus
                    multiline
                    blurOnSubmit
                    returnKeyType="done"
                    onSubmitEditing={() => editStep(null)}
                    placeholder={t.breakdown.stepPlaceholder}
                    placeholderTextColor={P.paperFaint}
                    selectionColor={P.accent}
                    cursorColor={P.accent}
                    style={[
                      { flex: 1, padding: 0, paddingVertical: 8, fontFamily: "SpaceGrotesk-Medium", fontSize: 16, lineHeight: 22, color: P.ink },
                      rtl,
                    ]}
                  />
                  <AnimatedPressable
                    onPress={() => editStep(null)}
                    scaleTo={0.9}
                    accessibilityRole="button"
                    accessibilityLabel={t.breakdown.saveStep}
                    style={[
                      { width: 40, height: 40, borderRadius: 20, backgroundColor: P.accent, alignItems: "center", justifyContent: "center" },
                      CHECK_SHADOW,
                    ]}
                  >
                    <AppIcon name="check" size={18} strokeWidth={3} color="#FFFFFF" />
                  </AnimatedPressable>
                </View>
              ) : (
                <View
                  style={[
                    {
                      minHeight: 56,
                      borderRadius: 22,
                      backgroundColor: P.paperCard,
                      paddingLeft: 14,
                      paddingRight: 6,
                      paddingVertical: 8,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                    },
                    ROW_SHADOW,
                  ]}
                >
                  <StepNumber index={index} done={step.completed} editing={false} />
                  <AnimatedPressable onPress={() => editStep(step.id)} scaleTo={0.99} accessibilityRole="button" style={{ flex: 1 }}>
                    <Text
                      style={[
                        {
                          fontFamily: "SpaceGrotesk-Medium",
                          fontSize: 16,
                          lineHeight: 22,
                          color: step.completed ? P.inkMuted : P.ink,
                          textDecorationLine: step.completed ? "line-through" : "none",
                        },
                        rtl,
                      ]}
                    >
                      {step.label}
                    </Text>
                  </AnimatedPressable>
                  <AnimatedPressable
                    onPress={() => editStep(step.id)}
                    scaleTo={0.9}
                    hitSlop={4}
                    accessibilityRole="button"
                    accessibilityLabel={t.breakdown.editStep(step.label)}
                    style={{ width: 38, height: 38, alignItems: "center", justifyContent: "center" }}
                  >
                    <Feather name="edit-2" size={17} color={P.inkMuted} />
                  </AnimatedPressable>
                  <AnimatedPressable
                    onPress={() => handleDelete(step.id)}
                    scaleTo={0.9}
                    hitSlop={4}
                    accessibilityRole="button"
                    accessibilityLabel={t.taskDetail.deleteSubtask(step.label)}
                    style={{ width: 38, height: 38, alignItems: "center", justifyContent: "center" }}
                  >
                    <Feather name="trash-2" size={17} color={P.paperFaint} />
                  </AnimatedPressable>
                </View>
              )}
            </Animated.View>
          );
        })}

        {/* Add a step: a dashed row, the same size as the steps. */}
        <AnimatedPressable
          onPress={handleAdd}
          scaleTo={0.98}
          accessibilityRole="button"
          style={{
            minHeight: 56,
            borderRadius: 22,
            borderWidth: 1.5,
            borderStyle: "dashed",
            borderColor: P.ring,
            paddingHorizontal: 14,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}
        >
          <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: P.chip, alignItems: "center", justifyContent: "center" }}>
            <Feather name="plus" size={16} color={P.inkMuted} />
          </View>
          <Text style={{ fontFamily: "SpaceGrotesk-Medium", fontSize: 16, color: P.inkMuted }}>{t.breakdown.addAStep}</Text>
        </AnimatedPressable>

        {aiSteps.length > 0 ? <ReportAiButton content={aiSteps.map((step) => step.title).join("\n")} beforeOpen={onClose} /> : null}
      </ScrollView>

      {/* Regenerate · Start step 1. */}
      <View style={{ marginTop: 16, flexDirection: "row", alignItems: "center", gap: 10 }}>
        <AnimatedPressable
          onPress={() => void generate()}
          disabled={isLoading}
          scaleTo={0.92}
          accessibilityRole="button"
          accessibilityLabel={isLoading ? t.breakdown.generating : t.breakdown.regenerate}
          style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: P.chip, alignItems: "center", justifyContent: "center" }}
        >
          {isLoading ? <ActivityIndicator size="small" color={P.accent} /> : <Feather name="refresh-cw" size={21} color={P.ink} />}
        </AnimatedPressable>
        <AnimatedPressable
          onPress={handleConfirm}
          disabled={isLoading || final.length === 0}
          scaleTo={0.97}
          accessibilityRole="button"
          style={{
            flex: 1,
            height: 56,
            borderRadius: 28,
            backgroundColor: P.ink,
            alignItems: "center",
            justifyContent: "center",
            opacity: isLoading || final.length === 0 ? 0.45 : 1,
          }}
        >
          <Text numberOfLines={1} style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 17, color: "#FFFFFF", includeFontPadding: false }}>
            {confirmLabel}
          </Text>
        </AnimatedPressable>
      </View>
    </PaperSheet>
  );
}
