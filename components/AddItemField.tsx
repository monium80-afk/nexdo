import { View } from "react-native";

import { IconButton, type FeatherIconName } from "@/components/Button";
import { TextField } from "@/components/TextField";

/**
 * A field with an orange button beside it, for adding one item at a time to
 * a list — a new task's plan steps, a task's subtasks, an AI breakdown's
 * steps, a note for the AI. The button stays grey until there's something
 * to add; on a single-line field, Return adds too.
 */
export function AddItemField({
  value,
  onChangeText,
  onAdd,
  placeholder,
  addLabel,
  icon = "plus",
  multiline = false,
  disabled = false,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onAdd: () => void;
  placeholder: string;
  /** Read out for the button. */
  addLabel: string;
  icon?: FeatherIconName;
  /** For longer text (a note): Return starts a new line, and the button sits level with the last one. */
  multiline?: boolean;
  /** Keeps the button idle whatever is typed — while the last item is still being handled. */
  disabled?: boolean;
}) {
  return (
    <View className={`flex-row gap-2 ${multiline ? "items-end" : "items-center"}`}>
      <TextField
        className="flex-1"
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        multiline={multiline}
        inputStyle={multiline ? { maxHeight: 120 } : undefined}
        {...(multiline ? {} : { onSubmitEditing: disabled ? undefined : onAdd, returnKeyType: "done" as const })}
      />
      <IconButton
        icon={icon}
        variant="primary"
        onPress={onAdd}
        disabled={disabled || !value.trim()}
        accessibilityLabel={addLabel}
      />
    </View>
  );
}
