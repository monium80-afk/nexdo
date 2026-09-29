import type { ReactNode } from "react";
import { TextInput, View, type StyleProp, type TextInputProps, type TextStyle } from "react-native";

import { useRtlText } from "@/hooks/useRtlText";
import { useColors } from "@/hooks/useTheme";

type TextFieldProps = Omit<TextInputProps, "style" | "className" | "placeholderTextColor"> & {
  /** Red edge while the value needs fixing. */
  error?: boolean;
  /** Inside the field after the text: a unit ("min") or a send button. */
  trailing?: ReactNode;
  /** Layout from the caller, e.g. flex-1 beside a button. */
  className?: string;
  /** Input-only styles, e.g. a taller minHeight for notes. */
  inputStyle?: StyleProp<TextStyle>;
};

/** Every text input on a cream screen or sheet — one shape, one type size. */
export function TextField({ error = false, trailing, className = "", inputStyle, multiline, ...inputProps }: TextFieldProps) {
  const colors = useColors();
  const rtl = useRtlText();
  return (
    <View
      className={`input min-h-[44px] flex-row gap-2 px-4 ${error ? "border-overdue-500" : "border-cream-200"} ${multiline ? "items-end py-1" : "items-center"} ${className}`}
    >
      <TextInput
        {...inputProps}
        multiline={multiline}
        placeholderTextColor={colors.ink.creamMuted}
        style={[multiline ? { textAlignVertical: "top" } : null, rtl, inputStyle]}
        // px-0: the box already pads; Android would add its own on top.
        className="flex-1 px-0 py-2.5 font-grotesk-regular text-sm text-ink-cream"
      />
      {trailing}
    </View>
  );
}
