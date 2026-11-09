import { Feather, Ionicons } from "@expo/vector-icons";
import { RecordingPresets, requestRecordingPermissionsAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { BottomSheet } from "@/components/BottomSheet";
import type { FeatherIconName } from "@/components/Button";
import { IconTile } from "@/components/IconTile";
import { MOTION } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { extractAttachmentText } from "@/lib/ai/media";
import { AiConsentError } from "@/lib/aiConsent";
import { composeFileNote } from "@/lib/contextFile";
import { getLanguage } from "@/lib/i18n";
import { showPlanLimit } from "@/lib/paywall";
import { pickContextDocument, pickContextPhoto, takeContextPhoto, type PickOutcome } from "@/lib/pickContextFile";
import { PlanLimitError } from "@/lib/plan";
import { beginRecording, endRecording } from "@/lib/recordingMode";
import { useTaskStore } from "@/store/useTaskStore";
import type { ContextAttachment } from "@/store/useReassessStore";
import type { Task } from "@/types/task";

type Phase =
  | { kind: "choose" }
  | { kind: "recording" }
  | { kind: "reading"; what: "photo" | "document" | "voice" }
  | { kind: "error"; message: string };

/** One way to show Nexdo the task: a tile, what it is, and a line on what it's for. */
function OptionRow({
  icon,
  label,
  hint,
  onPress,
  disabled,
}: {
  icon: FeatherIconName;
  label: string;
  hint?: string;
  onPress: () => void;
  disabled: boolean;
}) {
  const colors = useColors();
  const rtl = useRtlText();
  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      scaleTo={0.98}
      accessibilityRole="button"
      className={`card card--cream-inset min-h-[56px] flex-row items-center gap-3 px-3 py-2.5 ${disabled ? "opacity-40" : ""}`}
    >
      <IconTile icon={icon} />
      <View className="flex-1 gap-0.5">
        <Text className="font-grotesk-semibold text-[15px] text-ink-cream" style={rtl}>
          {label}
        </Text>
        {hint ? (
          <Text className="font-grotesk-medium text-[13px] leading-[18px] text-ink-cream-muted" style={rtl}>
            {hint}
          </Text>
        ) : null}
      </View>
      <Feather name="chevron-right" size={16} color={colors.ink.creamSubtle} />
    </AnimatedPressable>
  );
}

/**
 * Before a breakdown, the one thing that makes it worth having: what the task
 * really is (the user's point, 2026-10-28 — "finish the math homework" alone
 * gets generic steps). A photo of the sheet, a file, or a sentence said out
 * loud is read once and kept as one of the task's context notes, so this
 * breakdown — and every later one — works from it. Or skip, and the steps come
 * from what the task already says.
 *
 * `onContinue` is called once there's nothing more to add: the caller closes
 * this and opens AI Breakdown, which drafts the steps straight away.
 */
export function BreakdownContextSheet({
  visible,
  task,
  onClose,
  onContinue,
}: {
  visible: boolean;
  task: Task;
  onClose: () => void;
  onContinue: () => void;
}) {
  const colors = useColors();
  const t = useTranslation();
  const rtl = useRtlText();
  const setContextNotes = useTaskStore((state) => state.setContextNotes);
  const [phase, setPhase] = useState<Phase>({ kind: "choose" });
  // Bumped when the sheet closes, so a reading still on its way is dropped.
  const run = useRef(0);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 500);

  // Closing — ✕, the scrim, Back — stops a recording and forgets a reading.
  const stopRecorder = () => {
    try {
      if (recorder.isRecording) recorder.stop().catch(() => {});
    } catch {
      // Already released along with the sheet.
    }
    endRecording("voiceNote");
  };
  useEffect(() => () => stopRecorder(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = () => {
    run.current += 1;
    stopRecorder();
    onClose();
  };

  const busy = phase.kind === "recording" || phase.kind === "reading";

  /** What was read, kept on the task as a context note — then on to the breakdown. */
  const keepAndContinue = (note: string) => {
    const current = useTaskStore.getState().tasks.find((entry) => entry.id === task.id) ?? task;
    setContextNotes(task.id, [...current.aiContext.notes, note]);
    onContinue();
  };

  const failed = (error: unknown, readFailed: string) => {
    if (error instanceof AiConsentError) {
      setPhase({ kind: "choose" });
      return;
    }
    if (error instanceof PlanLimitError) {
      // The plans can't open under this sheet: it goes first.
      handleClose();
      setTimeout(() => showPlanLimit(error.meter), MOTION.duration.screen + 50);
      return;
    }
    console.warn("[BreakdownContextSheet] couldn't read it", error);
    setPhase({ kind: "error", message: readFailed });
  };

  const readFile = async (file: ContextAttachment) => {
    const id = ++run.current;
    setPhase({ kind: "reading", what: file.kind });
    try {
      const text = await extractAttachmentText(file, { language: getLanguage(), forTask: { title: task.title } });
      if (id !== run.current) return;
      if (!text) {
        setPhase({
          kind: "error",
          message: file.kind === "photo" ? t.taskDetail.attach.emptyPhoto : t.taskDetail.attach.emptyDocument,
        });
        return;
      }
      keepAndContinue(composeFileNote(file.kind, text));
    } catch (error) {
      if (id === run.current) failed(error, t.taskDetail.attach.readFailed);
    }
  };

  const handlePick = async (pick: () => Promise<PickOutcome>) => {
    try {
      const outcome = await pick();
      if (outcome.status === "picked") void readFile(outcome.file);
      else if (outcome.status === "tooBig") setPhase({ kind: "error", message: t.taskDetail.attach.tooBig });
      else if (outcome.status === "unsupported") setPhase({ kind: "error", message: t.taskDetail.attach.unsupported });
      else if (outcome.status === "denied") setPhase({ kind: "error", message: t.taskDetail.attach.cameraDenied });
    } catch (error) {
      console.warn("[BreakdownContextSheet] couldn't pick a file", error);
      setPhase({ kind: "error", message: t.taskDetail.attach.pickFailed });
    }
  };

  const startRecording = async () => {
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setPhase({ kind: "error", message: t.live.problems.permission });
        return;
      }
      await beginRecording("voiceNote");
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase({ kind: "recording" });
    } catch (error) {
      console.warn("[BreakdownContextSheet] couldn't start recording", error);
      endRecording("voiceNote");
      setPhase({ kind: "error", message: t.breakdown.couldntHear });
    }
  };

  const stopAndRead = async () => {
    const id = ++run.current;
    const seconds = Math.max(1, Math.round(recorderState.durationMillis / 1000));
    setPhase({ kind: "reading", what: "voice" });
    try {
      await recorder.stop();
      endRecording("voiceNote");
      const uri = recorder.uri;
      if (!uri) throw new Error("no recording");
      const text = await extractAttachmentText(
        { kind: "voice", label: "voice", uri, durationSeconds: seconds, mimeType: "audio/aac" },
        { language: getLanguage(), forTask: { title: task.title } },
      );
      if (id !== run.current) return;
      if (!text) {
        setPhase({ kind: "error", message: t.breakdown.couldntHear });
        return;
      }
      keepAndContinue(text);
    } catch (error) {
      endRecording("voiceNote");
      if (id === run.current) failed(error, t.breakdown.couldntHear);
    }
  };

  const readingLabel =
    phase.kind === "reading"
      ? phase.what === "photo"
        ? t.taskDetail.attach.readingPhoto
        : phase.what === "document"
          ? t.taskDetail.attach.readingDocument
          : t.breakdown.writingItDown
      : "";

  return (
    <BottomSheet
      visible={visible}
      onClose={handleClose}
      title={t.breakdown.contextTitle}
      titleIcon={<Ionicons name="sparkles" size={14} color={colors.orange[500]} />}
      closeLabel={t.breakdown.close}
    >
      <View className="gap-3">
        <View className="gap-1">
          <Text className="font-grotesk-bold text-[19px] leading-[24px] text-ink-cream" style={rtl}>
            {t.breakdown.contextHeadline}
          </Text>
          <Text className="text-body text-ink-cream-muted" style={rtl}>
            {t.breakdown.contextBody}
          </Text>
        </View>

        {phase.kind === "reading" ? (
          <View className="card card--cream-inset flex-row items-center gap-3 px-4 py-4" accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" color={colors.orange[500]} />
            <Text className="flex-1 font-grotesk-semibold text-sm text-ink-cream" style={rtl}>
              {readingLabel}
            </Text>
          </View>
        ) : phase.kind === "recording" ? (
          // Listening: the one thing to do is stop, which reads what was said.
          <AnimatedPressable
            onPress={() => void stopAndRead()}
            scaleTo={0.98}
            accessibilityRole="button"
            accessibilityLabel={t.breakdown.stopListening}
            className="min-h-[56px] flex-row items-center gap-3 rounded-[16px] border border-orange-500 bg-orange-100 px-4 py-3"
          >
            <View className="h-[12px] w-[12px] rounded-full bg-overdue-500" />
            <Text className="flex-1 font-grotesk-semibold text-[15px] text-orange-600" style={rtl}>
              {t.breakdown.listening}
            </Text>
            <Feather name="square" size={16} color={colors.orange[600]} />
          </AnimatedPressable>
        ) : (
          <View className="gap-2">
            <OptionRow
              icon="camera"
              label={t.taskDetail.attach.takePhoto}
              hint={t.breakdown.photoHint}
              onPress={() => void handlePick(takeContextPhoto)}
              disabled={busy}
            />
            <OptionRow icon="image" label={t.taskDetail.attach.addPhoto} onPress={() => void handlePick(pickContextPhoto)} disabled={busy} />
            <OptionRow
              icon="paperclip"
              label={t.taskDetail.attach.addDocument}
              hint={t.breakdown.fileHint}
              onPress={() => void handlePick(pickContextDocument)}
              disabled={busy}
            />
            <OptionRow icon="mic" label={t.breakdown.sayIt} hint={t.breakdown.sayItHint} onPress={() => void startRecording()} disabled={busy} />
          </View>
        )}

        {phase.kind === "error" ? (
          <Text className="font-grotesk-medium text-sm text-overdue-500" style={rtl}>
            {phase.message}
          </Text>
        ) : null}

        {/* Straight to the steps, from what the task already says. */}
        <AnimatedPressable
          onPress={() => {
            run.current += 1;
            stopRecorder();
            onContinue();
          }}
          disabled={phase.kind === "reading"}
          hitSlop={8}
          accessibilityRole="button"
          className={`flex-row items-center justify-center gap-1.5 self-center py-2 ${phase.kind === "reading" ? "opacity-40" : ""}`}
        >
          <Text className="font-grotesk-bold text-[15px] text-orange-600">{t.breakdown.skipContext}</Text>
          <Feather name="arrow-right" size={15} color={colors.orange[600]} />
        </AnimatedPressable>
      </View>
    </BottomSheet>
  );
}
