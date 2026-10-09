import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Text, View } from "react-native";

import { IconButton, TextButton } from "@/components/Button";
import { TextField } from "@/components/TextField";
import { useRtlText } from "@/hooks/useRtlText";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { showAlert } from "@/lib/alert";
import { pickContextDocument, pickContextPhoto, type PickOutcome } from "@/lib/pickContextFile";
import type { ContextAttachment } from "@/store/useReassessStore";

/**
 * "Add context for AI": a note, a photo or a document — or a photo with a
 * note about it — that Nexdo reassesses the task for (useReassessStore).
 * One file at a time. Controlled, so Task Details' Save Changes can send
 * what's still in it. Used on Task Details and in a focus session's sheet.
 */
export function ContextComposer({
  value,
  onChangeText,
  file,
  onChangeFile,
  onSend,
  placeholder,
  disabled = false,
}: {
  value: string;
  onChangeText: (text: string) => void;
  file: ContextAttachment | null;
  onChangeFile: (file: ContextAttachment | null) => void;
  onSend: () => void;
  placeholder: string;
  /** While Nexdo is still working on the last one. */
  disabled?: boolean;
}) {
  const t = useTranslation();
  const colors = useColors();
  const rtl = useRtlText();
  const canSend = !disabled && (value.trim().length > 0 || file !== null);

  const handlePick = async (pick: () => Promise<PickOutcome>) => {
    try {
      const outcome = await pick();
      if (outcome.status === "picked") onChangeFile(outcome.file);
      else if (outcome.status === "tooBig") showAlert(t.taskDetail.attach.tooBig);
      else if (outcome.status === "unsupported") showAlert(t.taskDetail.attach.unsupported);
    } catch (error) {
      console.warn("[ContextComposer] couldn't pick a file", error);
      showAlert(t.taskDetail.attach.pickFailed);
    }
  };

  return (
    <View className="gap-2.5">
      {file ? (
        <View className="card card--cream-inset flex-row items-center gap-3 py-2 pl-2 pr-1">
          {file.kind === "photo" ? (
            <Image source={{ uri: file.uri }} style={{ width: 44, height: 44, borderRadius: 10 }} contentFit="cover" />
          ) : (
            <View className="h-[44px] w-[44px] items-center justify-center rounded-[10px] bg-cream-200">
              <Feather name="file-text" size={20} color={colors.orange[600]} />
            </View>
          )}
          <View className="flex-1 gap-0.5">
            <Text numberOfLines={1} className="font-grotesk-semibold text-sm text-ink-cream" style={rtl}>
              {file.kind === "photo" ? t.taskDetail.attach.photo : (file.name ?? t.taskDetail.attach.document)}
            </Text>
            <Text numberOfLines={2} className="font-grotesk-medium text-[12px] leading-4 text-ink-cream-muted" style={rtl}>
              {t.taskDetail.attach.hint}
            </Text>
          </View>
          <IconButton icon="x" onPress={() => onChangeFile(null)} disabled={disabled} accessibilityLabel={t.taskDetail.attach.remove} />
        </View>
      ) : null}

      <View className="flex-row items-end gap-2">
        <TextField
          className="flex-1"
          value={value}
          onChangeText={onChangeText}
          placeholder={file ? t.taskDetail.attach.notePlaceholder : placeholder}
          multiline
          inputStyle={{ maxHeight: 120 }}
        />
        <IconButton icon="send" variant="primary" onPress={onSend} disabled={!canSend} accessibilityLabel={t.common.save} />
      </View>

      {/* One file per note: the buttons step aside while one is attached. */}
      {file ? null : (
        <View className="flex-row flex-wrap items-center gap-x-5 gap-y-2">
          <TextButton
            icon="image"
            label={t.taskDetail.attach.addPhoto}
            tone="accent"
            onPress={() => void handlePick(pickContextPhoto)}
            disabled={disabled}
          />
          <TextButton
            icon="paperclip"
            label={t.taskDetail.attach.addDocument}
            tone="accent"
            onPress={() => void handlePick(pickContextDocument)}
            disabled={disabled}
          />
        </View>
      )}
    </View>
  );
}
