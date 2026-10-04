import { useClerk, useUser } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { BottomSheet } from "@/components/BottomSheet";
import { PrimaryButton, SecondaryButton, TextButton } from "@/components/Button";
import { SectionHeader } from "@/components/SectionHeader";
import { TextField } from "@/components/TextField";
import { useRtlText } from "@/hooks/useRtlText";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import type { DeleteAccountResponseBody } from "@/app/api/delete-account+api";
import { showAlert } from "@/lib/alert";
import { apiPost } from "@/lib/api";
import { posthog } from "@/lib/posthog";
import { resetPurchaser } from "@/lib/purchases";
import { useChatStore } from "@/store/useChatStore";
import { useIsPro } from "@/store/useSubscriptionStore";
import { useTaskStore } from "@/store/useTaskStore";

const MIN_PASSWORD_LENGTH = 8;

/** Every file in the account's storage goes too, so this can take longer than an AI answer. */
const DELETE_ACCOUNT_TIMEOUT_MS = 60_000;

type AccountSheetProps = {
  visible: boolean;
  onClose: () => void;
};

/**
 * Everything about the account in one sheet: picture, name, email, password
 * and deletion. Name and photo live on the Clerk user, not in local storage,
 * so they follow the account to every device it signs in on.
 */
export function AccountSheet({ visible, onClose }: AccountSheetProps) {
  const colors = useColors();
  const t = useTranslation();
  const rtl = useRtlText();
  const { user } = useUser();
  const { signOut } = useClerk();
  const handleChatSignOut = useChatStore((state) => state.handleSignOut);
  const clearChatHistory = useChatStore((state) => state.clearHistory);
  const handleTaskSignOut = useTaskStore((state) => state.handleSignOut);
  const isPro = useIsPro();

  const [name, setName] = useState(user?.fullName ?? "");
  const [nameStatus, setNameStatus] = useState<"saving" | "saved" | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingPassword, setEditingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null);

  const [deleting, setDeleting] = useState(false);

  // Reopening the sheet starts from whatever the account holds now, and drops
  // any half-finished edit from last time. Same pattern as VerificationModal:
  // derived-from-props state, no effect needed.
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setName(user?.fullName ?? "");
      setNameStatus(null);
      setError(null);
      setEditingPassword(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordError(null);
      setPasswordStatus(null);
    }
  }

  const handleChangePhoto = async () => {
    if (!user) return;
    setError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
        base64: true,
      });
      const asset = result.canceled ? undefined : result.assets[0];
      if (!asset?.base64) return;

      // Only once there is something to upload — raised before the picker
      // opened, the spinner sat over the avatar for as long as the user was
      // browsing their gallery, and kept spinning if they cancelled.
      setUploadingPhoto(true);
      // Clerk accepts the image as a base64 data URL on React Native.
      await user.setProfileImage({ file: `data:${asset.mimeType ?? "image/jpeg"};base64,${asset.base64}` });
      await user.reload();
    } catch (uploadError) {
      console.warn("[AccountSheet] photo upload failed", uploadError);
      setError(t.account.photoError);
    } finally {
      setUploadingPhoto(false);
    }
  };

  // The name saves when the field is left, so the sheet keeps the design's
  // clean two-field layout instead of growing a Save button.
  const handleSaveName = async () => {
    if (!user) return;
    const trimmed = name.trim();
    if (trimmed === (user.fullName ?? "")) return;
    if (!trimmed) {
      setError(t.account.nameRequired);
      setName(user.fullName ?? "");
      return;
    }

    setNameStatus("saving");
    setError(null);
    try {
      // The whole name goes in Clerk's firstName — it works on every Clerk
      // instance, unlike the `username` attribute which must be enabled first.
      await user.update({ firstName: trimmed, lastName: "" });
      setNameStatus("saved");
    } catch (saveError) {
      console.warn("[AccountSheet] name update failed", saveError);
      setError(t.account.nameError);
      setNameStatus(null);
    }
  };

  const handleSavePassword = async () => {
    if (!user) return;
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(t.account.passwordHint);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t.account.passwordMismatch);
      return;
    }

    setSavingPassword(true);
    setPasswordError(null);
    try {
      await user.updatePassword({
        // Only an account that already has a password has to prove the old one.
        ...(user.passwordEnabled ? { currentPassword } : {}),
        newPassword,
        signOutOfOtherSessions: true,
      });
      setEditingPassword(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordStatus(t.account.passwordUpdated);
    } catch (updateError) {
      console.warn("[AccountSheet] password update failed", updateError);
      setPasswordError(t.account.passwordError);
    } finally {
      setSavingPassword(false);
    }
  };

  // The server deletes the account and everything stored for it
  // (app/api/delete-account+api.ts) — data first, the Clerk user last, with
  // its own keys, so neither the session nor Clerk's client-side settings can
  // leave the user signed in to an empty account. If it stops partway, the
  // account is still there and trying again finishes the job.
  const handleDeleteAccount = () => {
    // The store bills the subscription, not Nexdo — deleting the account
    // can't stop it, so a Pro user is told where to cancel.
    const body = isPro ? `${t.account.deleteBody}\n\n${t.account.deleteProNote}` : t.account.deleteBody;
    showAlert(t.account.deleteTitle, body, [
      { text: t.common.cancel, style: "cancel" },
      {
        text: t.account.deleteConfirm,
        style: "destructive",
        onPress: async () => {
          if (!user) return;
          setDeleting(true);
          setError(null);
          // As "Clear chat history" does: any message still uploading lands
          // first (so none arrives after the server's delete), and an AI
          // reply still on its way is dropped.
          try {
            await clearChatHistory();
          } catch (clearError) {
            console.warn("[AccountSheet] couldn't clear the chat before deleting", clearError);
            setError(t.account.deleteError);
            setDeleting(false);
            return;
          }
          try {
            await apiPost<DeleteAccountResponseBody>("/api/delete-account", {}, undefined, DELETE_ACCOUNT_TIMEOUT_MS);
            // Only once it's gone, so a failed deletion isn't counted as one.
            posthog.capture("account_deleted");
            posthog.reset();
          } catch (deleteError) {
            console.warn("[AccountSheet] account deletion failed", deleteError);
            // The chat is already gone, and the server may have got further.
            setError(t.account.deletePartialError);
            setDeleting(false);
            return;
          }

          // Past this line the account is gone, so the tabs redirect to
          // onboarding and take Settings — and this sheet — with them.
          // Nothing below touches component state for that reason, and a
          // failed sign-out still clears this phone's copy of the account.
          try {
            await signOut();
          } catch (signOutError) {
            console.warn("[AccountSheet] sign-out after deletion failed", signOutError);
          }
          await Promise.allSettled([
            Promise.resolve().then(() => handleChatSignOut()),
            Promise.resolve().then(() => handleTaskSignOut({ accountDeleted: true })),
            resetPurchaser(),
          ]);
        },
      },
    ]);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t.account.title} closeLabel={t.account.close}>
      <ScrollView
        // Shrinks so the sheet scrolls inside itself rather than growing past the screen.
        style={{ flexGrow: 0, flexShrink: 1 }}
        contentContainerStyle={{ gap: 20, paddingTop: 4 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row items-center gap-4">
          <AnimatedPressable
            onPress={handleChangePhoto}
            disabled={uploadingPhoto}
            accessibilityRole="button"
            accessibilityLabel={t.account.changePhoto}
            className="h-[64px] w-[64px] overflow-hidden rounded-full border border-cream-200"
          >
            {user?.hasImage ? (
              <Image source={{ uri: user.imageUrl }} className="h-full w-full rounded-full" />
            ) : (
              <View className="h-full w-full items-center justify-center rounded-full bg-cream-200">
                <Feather name="user" size={26} color={colors.ink.creamMuted} />
              </View>
            )}
            {uploadingPhoto ? (
              <View className="scrim items-center justify-center rounded-full" style={StyleSheet.absoluteFill}>
                <ActivityIndicator size="small" color={colors.onAccent} />
              </View>
            ) : null}
          </AnimatedPressable>

          <AnimatedPressable
            onPress={handleChangePhoto}
            disabled={uploadingPhoto}
            className="flex-1 gap-1"
            accessibilityRole="button"
            accessibilityLabel={t.account.changePhoto}
          >
            <Text className="font-grotesk-semibold text-base text-orange-600" style={rtl}>
              {t.account.changePhoto}
            </Text>
            <Text className="font-grotesk-medium text-sm text-ink-cream-muted" style={rtl}>
              {t.account.photoHint}
            </Text>
          </AnimatedPressable>
        </View>

        <View className="gap-2">
          <SectionHeader label={t.account.name} />
          <TextField
            value={name}
            onChangeText={(value) => {
              setName(value);
              setNameStatus(null);
            }}
            // Blur only: Done blurs a single-line field anyway, so handling
            // submit as well sent the same update twice.
            onBlur={handleSaveName}
            returnKeyType="done"
            placeholder={t.account.namePlaceholder}
          />
          {nameStatus ? (
            <Text className="font-grotesk-medium text-sm text-ink-cream-muted" style={rtl}>
              {nameStatus === "saving" ? t.account.saving : t.account.saved}
            </Text>
          ) : null}
        </View>

        <View className="gap-2">
          <SectionHeader label={t.account.email} />
          {/* Read-only: changing the sign-in email needs its own
              verification flow, which this sheet doesn't run. */}
          <View className="input min-h-[44px] justify-center border-cream-200 px-4">
            <Text numberOfLines={1} className="font-grotesk-regular text-sm text-ink-cream-muted" style={rtl}>
              {user?.primaryEmailAddress?.emailAddress ?? t.account.noEmail}
            </Text>
          </View>
        </View>

        {error ? (
          <Text className="font-grotesk-medium text-sm text-overdue-500" style={rtl}>
            {error}
          </Text>
        ) : null}

        <View className="h-px bg-cream-200" />

        {editingPassword ? (
          <View className="gap-3">
            {user?.passwordEnabled ? (
              <TextField
                value={currentPassword}
                onChangeText={setCurrentPassword}
                placeholder={t.account.currentPassword}
                secureTextEntry
                autoCapitalize="none"
              />
            ) : null}
            <TextField
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder={t.account.newPassword}
              secureTextEntry
              autoCapitalize="none"
            />
            <TextField
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder={t.account.confirmPassword}
              secureTextEntry
              autoCapitalize="none"
            />

            {passwordError ? (
              <Text className="font-grotesk-medium text-sm text-overdue-500" style={rtl}>
                {passwordError}
              </Text>
            ) : (
              <Text className="font-grotesk-medium text-sm text-ink-cream-muted" style={rtl}>
                {t.account.passwordHint}
              </Text>
            )}

            <View className="flex-row items-center gap-3">
              <SecondaryButton
                label={t.common.cancel}
                onPress={() => setEditingPassword(false)}
                size="lg"
                className="flex-1"
              />
              <PrimaryButton
                label={savingPassword ? t.account.saving : t.account.savePassword}
                onPress={handleSavePassword}
                disabled={savingPassword}
                size="lg"
                className="flex-1"
              />
            </View>
          </View>
        ) : (
          <SecondaryButton
            icon="lock"
            label={t.account.changePassword}
            onPress={() => {
              setPasswordStatus(null);
              setEditingPassword(true);
            }}
            size="lg"
          />
        )}

        {passwordStatus ? (
          <Text className="text-center font-grotesk-medium text-sm text-ink-cream-muted">{passwordStatus}</Text>
        ) : null}

        <TextButton
          label={deleting ? t.account.deleting : t.account.deleteAccount}
          onPress={handleDeleteAccount}
          disabled={deleting}
          tone="destructive"
          className="self-center py-1"
        />
      </ScrollView>
    </BottomSheet>
  );
}
