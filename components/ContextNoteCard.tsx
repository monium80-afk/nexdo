import { Feather } from "@expo/vector-icons";
import { useImperativeHandle, useState, type Ref } from "react";
import { Text, TextInput, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/useTranslation";

/** Lets Task Details' "Save Changes" button pick up an edit that wasn't saved on the card. */
export type ContextNoteCardHandle = {
  /** The edited text while the card is open for editing, otherwise null. */
  pendingNote: () => string | null;
};

/** One note the AI reads when it advises on or breaks down this task. */
export function ContextNoteCard({
  note,
  onSave,
  onDelete,
  ref,
}: {
  note: string;
  onSave: (note: string) => void;
  onDelete: () => void;
  ref?: Ref<ContextNoteCardHandle>;
}) {
  const t = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note);

  useImperativeHandle(ref, () => ({
    pendingNote: () => (editing && draft.trim() ? draft.trim() : null),
  }));

  const handleStartEdit = () => {
    setDraft(note);
    setEditing(true);
  };

  const handleSave = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (trimmed !== note) onSave(trimmed);
    setEditing(false);
  };

  if (editing) {
    return (
      <View className="gap-2.5 rounded-xl border border-orange-500 bg-cream-50 p-3">
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={t.taskDetail.notePlaceholder}
          placeholderTextColor={colors.ink.creamMuted}
          multiline
          autoFocus
          style={{ textAlignVertical: "top", maxHeight: 140 }}
          className="font-grotesk-regular text-sm text-ink-cream"
        />
        <View className="flex-row items-center justify-end gap-4">
          <AnimatedPressable onPress={() => setEditing(false)} hitSlop={8} accessibilityRole="button">
            <Text className="font-grotesk-semibold text-xs text-ink-cream-muted">{t.common.cancel}</Text>
          </AnimatedPressable>
          <AnimatedPressable
            onPress={handleSave}
            disabled={!draft.trim()}
            accessibilityRole="button"
            className="rounded-full bg-orange-500 px-3.5 py-1.5"
          >
            <Text className="font-grotesk-semibold text-xs text-cream-50">{t.common.save}</Text>
          </AnimatedPressable>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-row items-start gap-3 rounded-xl border border-cream-300 bg-cream-100 py-3 pl-3.5 pr-3">
      <Text className="flex-1 text-body text-ink-cream">{note}</Text>
      <View className="flex-row items-center gap-3.5 pt-0.5">
        <AnimatedPressable onPress={handleStartEdit} hitSlop={8} accessibilityRole="button" accessibilityLabel={t.taskDetail.editNote}>
          <Feather name="edit-2" size={14} color={colors.ink.creamMuted} />
        </AnimatedPressable>
        <AnimatedPressable onPress={onDelete} hitSlop={8} accessibilityRole="button" accessibilityLabel={t.taskDetail.deleteNote}>
          <Feather name="trash-2" size={14} color={colors.ink.creamMuted} />
        </AnimatedPressable>
      </View>
    </View>
  );
}
