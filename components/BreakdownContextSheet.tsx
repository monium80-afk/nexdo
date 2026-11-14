import { Feather } from "@expo/vector-icons";
import { RecordingPresets, requestRecordingPermissionsAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { BreakdownSheetHeader } from "@/components/BreakdownSheetHeader";
import type { FeatherIconName } from "@/components/Button";
import { PaperSheet } from "@/components/PaperSheet";
import { shadow } from "@/constants/shadow";
import { MOTION, colors } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
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

const P = colors.palette;
const CARD_SHADOW = shadow("0 6px 20px rgba(34, 28, 23, 0.07)", 3);
const SEND_SHADOW = shadow("0 6px 14px rgba(242, 106, 46, 0.35)", 5, "#F26A2E");

/**
 * Before a breakdown, the one thing that makes it worth having: what the task
 * really is (the user's point, 2026-10-28 — "finish the math homework" alone
 * gets generic steps). Typed or pasted, a photo of the sheet, a file, or a
 * sentence said out loud — read once and kept as one of the task's context
 * notes, so this breakdown and every later one works from it. Or skip, and
 * the steps come from what the task already says. The look is the user's
 * screenshot (2026-11-10): the page blurred behind, one note card with round
 * buttons under it.
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
  const t = useTranslation();
  const rtl = useRtlText();
  const setContextNotes = useTaskStore((state) => state.setContextNotes);
  const [phase, setPhase] = useState<Phase>({ kind: "choose" });
  const [note, setNote] = useState("");
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

  const recording = phase.kind === "recording";
  const reading = phase.kind === "reading";

  // The orange arrow: what was typed is kept as the task's context, then on
  // to the steps. With nothing typed it simply goes on.
  const handleSend = () => {
    if (recording) {
      void stopAndRead();
      return;
    }
    const typed = note.trim();
    run.current += 1;
    if (typed) keepAndContinue(typed);
    else onContinue();
  };

  return (
    <PaperSheet visible={visible} onClose={handleClose} blur>
      <BreakdownSheetHeader eyebrow={t.breakdown.contextTitle} title={task.title} closeLabel={t.breakdown.close} onClose={handleClose} />

      {/* The note: typed, pasted — or a photo, a file, a voice note. */}
      <View
        style={[
          { marginTop: 18, borderRadius: 26, backgroundColor: P.paperCard, paddingTop: 16, paddingHorizontal: 18, paddingBottom: 14 },
          CARD_SHADOW,
        ]}
      >
        {reading ? (
          <View style={{ minHeight: 64, flexDirection: "row", alignItems: "center", gap: 12 }} accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" color={P.accent} />
            <Text style={[{ flex: 1, fontFamily: "SpaceGrotesk-Medium", fontSize: 16, color: P.ink }, rtl]}>{readingLabel}</Text>
          </View>
        ) : recording ? (
          // Listening: stopping reads what was said.
          <AnimatedPressable
            onPress={() => void stopAndRead()}
            scaleTo={0.98}
            accessibilityRole="button"
            accessibilityLabel={t.breakdown.stopListening}
            style={{ minHeight: 64, flexDirection: "row", alignItems: "center", gap: 12 }}
          >
            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: P.alert }} />
            <Text style={[{ flex: 1, fontFamily: "SpaceGrotesk-Medium", fontSize: 16, color: P.accentInk }, rtl]}>{t.breakdown.listening}</Text>
          </AnimatedPressable>
        ) : (
          <TextInput
            value={note}
            onChangeText={setNote}
            multiline
            placeholder={t.breakdown.contextPlaceholder}
            placeholderTextColor={P.paperFaint}
            accessibilityLabel={t.breakdown.contextPlaceholder}
            style={[
              { minHeight: 64, maxHeight: 160, padding: 0, fontFamily: "SpaceGrotesk-Regular", fontSize: 16, lineHeight: 24, color: P.ink, textAlignVertical: "top" },
              rtl,
            ]}
          />
        )}

        <View style={{ marginTop: 14, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <RoundTool icon="camera" label={t.taskDetail.attach.takePhoto} onPress={() => void handlePick(takeContextPhoto)} disabled={busy} />
          <RoundTool icon="image" label={t.taskDetail.attach.addPhoto} onPress={() => void handlePick(pickContextPhoto)} disabled={busy} />
          <RoundTool icon="paperclip" label={t.taskDetail.attach.addDocument} onPress={() => void handlePick(pickContextDocument)} disabled={busy} />
          <RoundTool
            icon={recording ? "square" : "mic"}
            label={recording ? t.breakdown.stopListening : t.breakdown.sayIt}
            onPress={recording ? () => void stopAndRead() : () => void startRecording()}
            disabled={reading}
            active={recording}
          />
          <View style={{ flex: 1 }} />
          <AnimatedPressable
            onPress={handleSend}
            disabled={reading}
            scaleTo={0.92}
            accessibilityRole="button"
            accessibilityLabel={t.breakdown.send}
            style={[
              { width: 48, height: 48, borderRadius: 24, backgroundColor: P.accent, alignItems: "center", justifyContent: "center", opacity: reading ? 0.5 : 1 },
              SEND_SHADOW,
            ]}
          >
            <Feather name="arrow-up" size={22} color="#FFFFFF" />
          </AnimatedPressable>
        </View>
      </View>

      {phase.kind === "error" ? (
        <Text style={[{ marginTop: 10, fontFamily: "SpaceGrotesk-Medium", fontSize: 14, color: P.alert }, rtl]}>{phase.message}</Text>
      ) : null}

      {/* Straight to the steps, from what the task already says. */}
      <AnimatedPressable
        onPress={() => {
          run.current += 1;
          stopRecorder();
          onContinue();
        }}
        disabled={reading}
        hitSlop={8}
        scaleTo={0.97}
        accessibilityRole="button"
        style={{ alignSelf: "center", marginTop: 18, paddingVertical: 8, opacity: reading ? 0.4 : 1 }}
      >
        <Text style={{ fontFamily: "SpaceGrotesk-SemiBold", fontSize: 15, color: P.inkMuted }}>{t.breakdown.skipAndBreak}</Text>
      </AnimatedPressable>
    </PaperSheet>
  );
}

/** One of the note's round buttons: camera, photo, file, mic. */
function RoundTool({
  icon,
  label,
  onPress,
  disabled,
  active = false,
}: {
  icon: FeatherIconName;
  label: string;
  onPress: () => void;
  disabled: boolean;
  /** The mic while it listens. */
  active?: boolean;
}) {
  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      scaleTo={0.92}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        width: 42,
        height: 42,
        borderRadius: 21,
        backgroundColor: active ? P.accent : P.chip,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Feather name={icon} size={active ? 16 : 19} color={active ? "#FFFFFF" : P.ink} />
    </AnimatedPressable>
  );
}
