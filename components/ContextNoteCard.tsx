import { useImperativeHandle, useState, type Ref } from "react";
import { Text, View } from "react-native";

import { IconButton, PrimaryButton, TextButton } from "@/components/Button";
import { TextField } from "@/components/TextField";
import { useRtlText } from "@/hooks/useRtlText";
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
  disabled = false,
  ref,
}: {
  note: string;
  /** Saving an edit sends it for reassessment, like a new note. */
  onSave: (note: string) => void;
  onDelete: () => void;
  /** While Nexdo is reassessing the task: the notes stay as they are until it's done. */
  disabled?: boolean;
  ref?: Ref<ContextNoteCardHandle>;
}) {
  const t = useTranslation();
  const rtl = useRtlText();
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
      <View className="gap-2.5">
        <TextField
          value={draft}
          onChangeText={setDraft}
          placeholder={t.taskDetail.notePlaceholder}
          multiline
          autoFocus
          inputStyle={{ maxHeight: 140 }}
        />
        <View className="flex-row items-center justify-end gap-5">
          <TextButton label={t.common.cancel} onPress={() => setEditing(false)} />
          <PrimaryButton label={t.common.save} onPress={handleSave} disabled={disabled || !draft.trim()} />
        </View>
      </View>
    );
  }

  return (
    <View className="card card--cream-inset flex-row items-start gap-1 py-1.5 pl-[14px] pr-1">
      <Text className="flex-1 py-1.5 text-body text-ink-cream" style={rtl}>
        {note}
      </Text>
      <IconButton icon="edit-2" onPress={handleStartEdit} disabled={disabled} accessibilityLabel={t.taskDetail.editNote} />
      <IconButton icon="trash-2" onPress={onDelete} disabled={disabled} accessibilityLabel={t.taskDetail.deleteNote} />
    </View>
  );
}
