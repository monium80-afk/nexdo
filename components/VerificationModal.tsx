import { useEffect, useRef, useState, type RefObject } from "react";
import {
  AppState,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Text,
  TextInput,
  View,
} from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { useTranslation } from "@/hooks/useTranslation";

const CODE_LENGTH = 6;

// Over the boxes and the same size, its own text and background invisible —
// the boxes draw the digits. Not opacity 0: a fully transparent view can stop
// taking touches.
const CODE_INPUT_STYLE = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  color: "transparent",
  backgroundColor: "transparent",
  opacity: 0.02,
  fontSize: 1,
} as const;

/** Drop the field's focus and take it again, which brings the keyboard back up. */
function refocus(ref: RefObject<TextInput | null>) {
  const input = ref.current;
  if (!input) return;
  if (input.isFocused()) input.blur();
  setTimeout(() => ref.current?.focus(), 60);
}

type VerificationModalProps = {
  visible: boolean;
  email: string;
  onClose: () => void;
  onVerify: (code: string) => Promise<string | void>;
};

export function VerificationModal({
  visible,
  email,
  onClose,
  onVerify,
}: VerificationModalProps) {
  const t = useTranslation();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setCode("");
      setError(null);
    }
  }

  useEffect(() => {
    if (!visible) return;

    const focusTimeout = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(focusTimeout);
  }, [visible]);

  // Leaving the app to read the code hides the keyboard, but Android still
  // counts the field as focused — so focus() alone did nothing and there was
  // no way to bring the keyboard back. Coming back, it's dropped and taken
  // again, which brings the keyboard up.
  useEffect(() => {
    if (!visible) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refocus(inputRef);
    });
    return () => subscription.remove();
  }, [visible]);

  const handleChange = async (text: string) => {
    const digitsOnly = text.replace(/[^0-9]/g, "").slice(0, CODE_LENGTH);
    setCode(digitsOnly);
    setError(null);

    if (digitsOnly.length === CODE_LENGTH) {
      Keyboard.dismiss();
      setVerifying(true);
      let errorMessage: string | void;
      try {
        errorMessage = await onVerify(digitsOnly);
      } catch {
        errorMessage = t.auth.somethingWrong;
      } finally {
        setVerifying(false);
      }

      if (errorMessage) {
        setError(errorMessage);
        setCode("");
      }
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View className="scrim flex-1 justify-end">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View className="card--cream-elevated gap-5 rounded-t-[30px] p-6 pb-10">
            <View className="items-center gap-2">
              <Text className="text-card-title text-center text-ink-cream">
                {t.auth.checkEmail}
              </Text>
              <Text className="text-body px-4 text-center text-ink-cream-muted">
                {t.auth.codeSentTo}{"\n"}
                <Text className="font-grotesk-semibold text-ink-cream">
                  {email}
                </Text>
              </Text>
            </View>

            {/* The real field lies over the boxes, invisible, so a tap lands
                on it — and Android always opens the keyboard for a tapped
                field, even one it still thinks is focused. A long press
                pastes a copied code the same way. */}
            <View className="self-center">
              <View pointerEvents="none" className="flex-row justify-center gap-2">
                {Array.from({ length: CODE_LENGTH }).map((_, index) => (
                  <View
                    key={index}
                    className={`input h-14 w-11 items-center justify-center ${
                      error
                        ? "border-overdue-500"
                        : index < code.length
                          ? "border-orange-500"
                          : "border-cream-200"
                    }`}
                  >
                    <Text className="font-grotesk-bold text-xl text-ink-cream">
                      {code[index] ?? ""}
                    </Text>
                  </View>
                ))}
              </View>
              <TextInput
                ref={inputRef}
                value={code}
                onChangeText={handleChange}
                keyboardType="number-pad"
                maxLength={CODE_LENGTH}
                editable={!verifying}
                caretHidden
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                accessibilityLabel={t.auth.checkEmail}
                style={CODE_INPUT_STYLE}
              />
            </View>

            {error ? (
              <Text className="text-center text-sm font-grotesk-medium text-overdue-500">
                {error}
              </Text>
            ) : null}

            <AnimatedPressable onPress={onClose} className="items-center">
              <Text className="font-grotesk-semibold text-sm text-ink-cream-muted">
                {t.common.cancel}
              </Text>
            </AnimatedPressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
