import { useEffect, useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { useTranslation } from "@/hooks/useTranslation";

const CODE_LENGTH = 6;

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
          <View className="card--cream-elevated gap-5 rounded-t-2xl p-6 pb-10">
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

            <Pressable
              onPress={() => inputRef.current?.focus()}
              className="flex-row justify-center gap-2"
            >
              {Array.from({ length: CODE_LENGTH }).map((_, index) => (
                <View
                  key={index}
                  className={`h-14 w-11 items-center justify-center rounded-2xl border bg-cream-50 ${
                    error
                      ? "border-overdue-500"
                      : index < code.length
                        ? "border-orange-500"
                        : "border-cream-300"
                  }`}
                >
                  <Text className="font-grotesk-bold text-xl text-ink-cream">
                    {code[index] ?? ""}
                  </Text>
                </View>
              ))}
            </Pressable>

            {error ? (
              <Text className="text-center text-sm font-grotesk-medium text-overdue-500">
                {error}
              </Text>
            ) : null}

            <TextInput
              ref={inputRef}
              value={code}
              onChangeText={handleChange}
              keyboardType="number-pad"
              maxLength={CODE_LENGTH}
              editable={!verifying}
              className="absolute h-px w-px opacity-0"
            />

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
