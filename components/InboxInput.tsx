import { Feather } from "@expo/vector-icons";
import {
    RecordingPresets,
    requestRecordingPermissionsAsync,
    useAudioRecorder,
    useAudioRecorderState,
} from "expo-audio";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { Alert, Text, TextInput, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { AttachmentPreviewRow } from "@/components/AttachmentPreviewRow";
import { useRtlText } from "@/hooks/useRtlText";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { beginRecording, endRecording } from "@/lib/recordingMode";
import type { ChatAttachment } from "@/types/chat";

export type AttachmentKind = "photo" | "voice" | "document";

type InboxInputProps = {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  /** A batch, because the document picker can return several files at once. */
  onAttachment: (attachments: ChatAttachment[]) => void;
  /** Staged but not sent yet — previewed above the input so text can be added to them. */
  attachments: ChatAttachment[];
  onRemoveAttachment: (index: number) => void;
  /** A voice note is being turned into text for the input box (auto mode off). */
  isTranscribing?: boolean;
};

function formatDurationLabel(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// The assistant works off text it can read out of an attachment — a photo, a
// voice note, a document. There's nothing it can do with a video, and they're
// large to upload, so they're turned away here. The camera never produces one
// (it's locked to stills below); the file picker is the way one gets in.
const VIDEO_EXTENSIONS = /\.(mp4|mov|m4v|avi|mkv|webm|3gp|wmv|flv|mpg|mpeg)$/i;

function isVideoFile(asset: { mimeType?: string | null; name?: string | null }): boolean {
  if (asset.mimeType?.startsWith("video/")) return true;
  return Boolean(asset.name && VIDEO_EXTENSIONS.test(asset.name));
}

export function InboxInput({
  value,
  onChangeText,
  onSend,
  onAttachment,
  attachments,
  onRemoveAttachment,
  isTranscribing = false,
}: InboxInputProps) {
  const colors = useColors();
  const t = useTranslation();
  const rtl = useRtlText();
  // Recording state (isRecording, durationMillis) is polled by this hook, not stored locally —
  // the recorder instance itself is the source of truth.
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder, 250);
  const isRecording = recorderState.isRecording;
  // A staged photo is a message on its own — text alongside it is optional.
  const canSend = value.trim().length > 0 || attachments.length > 0;

  // Leaving the Assistant mid-recording (another tab, or Live voice opening
  // over it) drops the note — otherwise the phone stays in record mode and
  // iOS keeps playback quiet for whatever plays next.
  useFocusEffect(
    useCallback(
      () => () => {
        try {
          if (audioRecorder.isRecording) audioRecorder.stop().catch(() => {});
        } catch {
          // Already released along with the screen.
        }
        endRecording("voiceNote");
      },
      [audioRecorder],
    ),
  );

  const handleMicPress = async () => {
    if (isRecording) {
      const seconds = Math.max(1, Math.round(recorderState.durationMillis / 1000));
      try {
        await audioRecorder.stop();
      } catch (error) {
        console.warn("[InboxInput] recording stop failed", error);
        return;
      } finally {
        // Back out of record mode once the recorder is done with it.
        endRecording("voiceNote");
      }
      const uri = audioRecorder.uri;
      if (uri) {
        onAttachment([
          {
            kind: "voice",
            label: t.chat.voiceNoteLabel(formatDurationLabel(seconds)),
            uri,
            durationSeconds: seconds,
            mimeType: "audio/aac",
          },
        ]);
      }
      return;
    }

    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t.chat.micPermissionTitle, t.chat.micPermissionBody);
      return;
    }

    try {
      await beginRecording("voiceNote");
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
    } catch (error) {
      console.warn("[InboxInput] recording start failed", error);
      endRecording("voiceNote");
      Alert.alert(t.chat.couldntTranscribe, t.chat.attachmentReplies.voice);
    }
  };

  const handleCameraPress = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t.chat.cameraPermissionTitle, t.chat.cameraPermissionBody);
      return;
    }

    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.6 });
    if (result.canceled) return;
    const asset = result.assets[0];
    onAttachment([
      {
        kind: "photo",
        label: t.chat.photoLabel,
        uri: asset.uri,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
      },
    ]);
  };

  const handleAttachPress = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true });
    if (result.canceled) return;

    // Videos are dropped rather than the whole batch refused: picking four
    // files and one clip should still attach the four.
    const files = result.assets.filter((asset) => !isVideoFile(asset));
    if (files.length < result.assets.length) {
      Alert.alert(t.chat.videoNotSupportedTitle, t.chat.videoNotSupportedBody);
    }
    if (files.length === 0) return;

    onAttachment(
      files.map((asset) => ({
        kind: "document" as const,
        label: asset.name,
        uri: asset.uri,
        mimeType: asset.mimeType,
        name: asset.name,
        size: asset.size,
      })),
    );
  };

  return (
    <View className="rounded-2xl border border-cream-300 bg-cream-50">
      {/* Recording takes the whole bar over, so previews would have nothing
          to attach to until it stops. */}
      {isRecording ? null : <AttachmentPreviewRow attachments={attachments} onRemove={onRemoveAttachment} />}
      <View className="flex-row items-center gap-1 py-1.5 pl-2.5 pr-1.5">
        <AnimatedPressable
          onPress={handleMicPress}
          accessibilityRole="button"
          accessibilityLabel={isRecording ? t.chat.stopRecording : t.chat.recordVoice}
          disabled={isTranscribing}
          hitSlop={8}
          style={{ opacity: isTranscribing ? 0.35 : 1 }}
          className="h-9 w-9 items-center justify-center"
        >
          <Feather name="mic" size={19} color={isRecording ? colors.overdue[500] : colors.ink.creamMuted} />
        </AnimatedPressable>
        <AnimatedPressable
          onPress={handleCameraPress}
          accessibilityRole="button"
          accessibilityLabel={t.chat.takePhoto}
          disabled={isRecording}
          hitSlop={8}
          style={{ opacity: isRecording ? 0.35 : 1 }}
          className="h-9 w-9 items-center justify-center"
        >
          <Feather name="camera" size={19} color={colors.ink.creamMuted} />
        </AnimatedPressable>
        <AnimatedPressable
          onPress={handleAttachPress}
          accessibilityRole="button"
          accessibilityLabel={t.chat.attachDocument}
          disabled={isRecording}
          hitSlop={8}
          style={{ opacity: isRecording ? 0.35 : 1 }}
          className="h-9 w-9 items-center justify-center"
        >
          <Feather name="paperclip" size={19} color={colors.ink.creamMuted} />
        </AnimatedPressable>

        {isRecording ? (
          <View className="flex-1 flex-row items-center gap-2 py-2.5">
            <View className="h-2 w-2 rounded-full bg-overdue-500" />
            <Text className="font-grotesk-medium text-sm text-ink-cream">
              {t.chat.recording(formatDurationLabel(Math.round(recorderState.durationMillis / 1000)))}
            </Text>
          </View>
        ) : isTranscribing ? (
          <View className="flex-1 py-2.5">
            <Text className="font-grotesk-medium text-sm text-ink-cream-muted">{t.chat.transcribing}</Text>
          </View>
        ) : (
          <TextInput
            value={value}
            onChangeText={onChangeText}
            // With something staged, the box is for instructions about it
            // ("pull out the deadlines"), not for the task itself.
            placeholder={attachments.length > 0 ? t.chat.attachmentPlaceholder : t.chat.inputPlaceholder}
            placeholderTextColor={colors.ink.creamMuted}
            multiline
            style={[{ textAlignVertical: "center", maxHeight: 100, paddingVertical: 8 }, rtl]}
            className="flex-1 font-grotesk-regular text-sm text-ink-cream"
          />
        )}

        <AnimatedPressable
          onPress={isRecording ? handleMicPress : onSend}
          accessibilityRole="button"
          accessibilityLabel={isRecording ? t.chat.stopRecording : t.chat.send}
          disabled={isTranscribing || (!isRecording && !canSend)}
          hitSlop={4}
          style={{ opacity: !isRecording && !canSend ? 0.4 : 1 }}
          className="mr-2 h-11 w-11 items-center justify-center rounded-2xl bg-orange-500"
        >
          <Feather name={isRecording ? "square" : "send"} size={isRecording ? 15 : 17} color={colors.onAccent} />
        </AnimatedPressable>
      </View>
    </View>
  );
}
