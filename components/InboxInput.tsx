import { Feather } from "@expo/vector-icons";
import {
    RecordingPresets,
    requestRecordingPermissionsAsync,
    setAudioModeAsync,
    useAudioRecorder,
    useAudioRecorderState,
} from "expo-audio";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Alert, Text, TextInput, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { AttachmentPreviewRow } from "@/components/AttachmentPreviewRow";
import { colors } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
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

export function InboxInput({
  value,
  onChangeText,
  onSend,
  onAttachment,
  attachments,
  onRemoveAttachment,
  isTranscribing = false,
}: InboxInputProps) {
  const t = useTranslation();
  const rtl = useRtlText();
  // Recording state (isRecording, durationMillis) is polled by this hook, not stored locally —
  // the recorder instance itself is the source of truth.
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder, 250);
  const isRecording = recorderState.isRecording;
  // A staged photo is a message on its own — text alongside it is optional.
  const canSend = value.trim().length > 0 || attachments.length > 0;

  const handleMicPress = async () => {
    if (isRecording) {
      const seconds = Math.max(1, Math.round(recorderState.durationMillis / 1000));
      await audioRecorder.stop();
      if (audioRecorder.uri) {
        onAttachment([
          {
            kind: "voice",
            label: t.chat.voiceNoteLabel(formatDurationLabel(seconds)),
            uri: audioRecorder.uri,
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

    await setAudioModeAsync({ allowsRecording: true });
    await audioRecorder.prepareToRecordAsync();
    audioRecorder.record();
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
    onAttachment(
      result.assets.map((asset) => ({
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
          <Feather name={isRecording ? "square" : "send"} size={isRecording ? 15 : 17} color={colors.cream[50]} />
        </AnimatedPressable>
      </View>
    </View>
  );
}
