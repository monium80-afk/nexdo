import { Feather } from "@expo/vector-icons";
import { useImperativeHandle, useState, type Ref } from "react";
import { Text, View } from "react-native";

import { IconButton, PrimaryButton, TextButton } from "@/components/Button";
import { TextField } from "@/components/TextField";
import { useRtlText } from "@/hooks/useRtlText";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { parseContextNote, withNoteText } from "@/lib/contextFile";

/** Lets Task Details' "Save Changes" button pick up an edit that wasn't saved on the card. */
export type ContextNoteCardHandle = {
  /** The edited text while the card is open for editing, otherwise null. */
  pendingNote: () => string | null;
};

// Past about this many characters, what was read from a file starts folded.
const FOLD_AT = 220;

/**
 * One note the AI reads when it advises on or breaks down this task. A note
 * made from a photo or document says so, and shows what Nexdo read in it —
 * folded to a few lines — under the user's own words. Editing changes only
 * those words: what was read from the file stays (delete the note to drop it).
 */
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
  const colors = useColors();
  const rtl = useRtlText();
  const parsed = parseContextNote(note);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(parsed.text);
  const [expanded, setExpanded] = useState(false);

  // A note from a file can lose its words and still be a note: the file's text.
  const canSave = Boolean(draft.trim()) || Boolean(parsed.file);

  useImperativeHandle(ref, () => ({
    pendingNote: () => (editing && canSave ? withNoteText(note, draft) : null),
  }));

  const handleStartEdit = () => {
    setDraft(parsed.text);
    setEditing(true);
  };

  const handleSave = () => {
    if (!canSave) return;
    const edited = withNoteText(note, draft);
    if (edited !== note) onSave(edited);
    setEditing(false);
  };

  const source = parsed.file ? (
    <View className="flex-row items-center gap-1.5">
      <Feather name={parsed.file.kind === "photo" ? "image" : "file-text"} size={13} color={colors.orange[600]} />
      <Text className="font-grotesk-semibold text-[12px] text-ink-cream-muted">
        {parsed.file.kind === "photo" ? t.taskDetail.attach.fromPhoto : t.taskDetail.attach.fromDocument}
      </Text>
    </View>
  ) : null;

  if (editing) {
    return (
      <View className="gap-2.5">
        {source}
        <TextField
          value={draft}
          onChangeText={setDraft}
          placeholder={parsed.file ? t.taskDetail.attach.notePlaceholder : t.taskDetail.notePlaceholder}
          multiline
          autoFocus
          inputStyle={{ maxHeight: 140 }}
        />
        <View className="flex-row items-center justify-end gap-5">
          <TextButton label={t.common.cancel} onPress={() => setEditing(false)} />
          <PrimaryButton label={t.common.save} onPress={handleSave} disabled={disabled || !canSave} />
        </View>
      </View>
    );
  }

  const fileText = parsed.file?.text ?? "";
  const foldable = fileText.length > FOLD_AT;

  return (
    <View className="card card--cream-inset flex-row items-start gap-1 py-1.5 pl-[14px] pr-1">
      <View className="flex-1 gap-1.5 py-1.5">
        {source}
        {parsed.text ? (
          <Text className="text-body text-ink-cream" style={rtl}>
            {parsed.text}
          </Text>
        ) : null}
        {parsed.file ? (
          <>
            <Text numberOfLines={foldable && !expanded ? 4 : undefined} className="text-body text-ink-cream-muted" style={rtl}>
              {fileText}
            </Text>
            {foldable ? (
              <View className="self-start">
                <TextButton
                  label={expanded ? t.taskDetail.attach.showLess : t.taskDetail.attach.showMore}
                  tone="accent"
                  onPress={() => setExpanded((open) => !open)}
                />
              </View>
            ) : null}
          </>
        ) : null}
      </View>
      <IconButton icon="edit-2" onPress={handleStartEdit} disabled={disabled} accessibilityLabel={t.taskDetail.editNote} />
      <IconButton icon="trash-2" onPress={onDelete} disabled={disabled} accessibilityLabel={t.taskDetail.deleteNote} />
    </View>
  );
}
