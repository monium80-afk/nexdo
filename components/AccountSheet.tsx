import { useClerk, useUser } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { colors } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import { posthog } from "@/lib/posthog";
import { deleteAllAttachments } from "@/lib/supabaseStorage";
import { deleteAllMessages, deleteAllTasks } from "@/lib/supabaseSync";
import { useChatStore } from "@/store/useChatStore";
import { useTaskStore } from "@/store/useTaskStore";

const MIN_PASSWORD_LENGTH = 8;

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
  const t = useTranslation();
  const rtl = useRtlText();
  const { user } = useUser();
  const { signOut } = useClerk();
  const handleChatSignOut = useChatStore((state) => state.handleSignOut);
  const handleTaskSignOut = useTaskStore((state) => state.handleSignOut);

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

  // The synced data goes before the Clerk user does: deleting the user kills
  // the session token, and every Supabase row is behind an RLS policy that
  // matches that token's `sub`, so anything left here would be stranded in the
  // database for good. If a cleanup step fails the account is left intact, and
  // the deletes are all idempotent, so retrying is safe.
  const handleDeleteAccount = () => {
    Alert.alert(t.account.deleteTitle, t.account.deleteBody, [
      { text: t.common.cancel, style: "cancel" },
      {
        text: t.account.deleteConfirm,
        style: "destructive",
        onPress: async () => {
          if (!user) return;
          setDeleting(true);
          setError(null);
          try {
            await deleteAllAttachments(user.id);
            await deleteAllMessages(user.id);
            await deleteAllTasks(user.id);

            posthog.capture("account_deleted");
            posthog.reset();
            await user.delete();

            // Past this line the session is gone, so the tabs redirect to
            // onboarding and take Settings — and this sheet — with them.
            // Nothing below touches component state for that reason; only the
            // failure path, which leaves the sheet on screen, still does.
            await signOut();
            await Promise.allSettled([
              Promise.resolve().then(() => handleChatSignOut()),
              Promise.resolve().then(() => handleTaskSignOut()),
            ]);
          } catch (deleteError) {
            console.warn("[AccountSheet] account deletion failed", deleteError);
            setError(t.account.deleteError);
            setDeleting(false);
          }
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable className="scrim flex-1 justify-center px-5" onPress={onClose}>
          <Pressable
            onPress={() => {}}
            className="card--cream-elevated overflow-hidden rounded-3xl"
            style={{ maxHeight: "88%" }}
          >
            <ScrollView
              contentContainerStyle={{ gap: 20, padding: 24 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View className="flex-row items-center justify-between">
                <Text className="text-title text-ink-cream">{t.account.title}</Text>
                <AnimatedPressable
                  onPress={onClose}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel={t.account.close}
                >
                  <Feather name="x" size={24} color={colors.ink.creamMuted} />
                </AnimatedPressable>
              </View>

              <View className="h-px bg-cream-300" />

              <View className="flex-row items-center gap-4">
                <AnimatedPressable
                  onPress={handleChangePhoto}
                  disabled={uploadingPhoto}
                  accessibilityRole="button"
                  accessibilityLabel={t.account.changePhoto}
                  className="h-[72px] w-[72px] overflow-hidden rounded-full border-[3px] border-orange-500"
                >
                  {user?.hasImage ? (
                    <Image source={{ uri: user.imageUrl }} className="h-full w-full rounded-full" />
                  ) : (
                    <View className="h-full w-full items-center justify-center rounded-full bg-cream-200">
                      <Feather name="user" size={28} color={colors.ink.creamMuted} />
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
                  <Text className="font-grotesk-bold text-base text-orange-500" style={rtl}>
                    {t.account.changePhoto}
                  </Text>
                  <Text className="font-grotesk-regular text-sm text-ink-cream-muted" style={rtl}>
                    {t.account.photoHint}
                  </Text>
                </AnimatedPressable>
              </View>

              <View className="gap-2">
                <Text className="font-grotesk-bold text-[15px] text-ink-cream" style={rtl}>
                  {t.account.name}
                </Text>
                <TextInput
                  value={name}
                  onChangeText={(value) => {
                    setName(value);
                    setNameStatus(null);
                  }}
                  onBlur={handleSaveName}
                  onSubmitEditing={handleSaveName}
                  returnKeyType="done"
                  placeholder={t.account.namePlaceholder}
                  placeholderTextColor={colors.ink.creamSubtle}
                  style={[{ paddingVertical: 14 }, rtl]}
                  className="rounded-2xl border border-cream-300 bg-cream-100 px-4 font-grotesk-medium text-base text-ink-cream"
                />
                {nameStatus ? (
                  <Text className="font-grotesk-medium text-xs text-ink-cream-muted" style={rtl}>
                    {nameStatus === "saving" ? t.account.saving : t.account.saved}
                  </Text>
                ) : null}
              </View>

              <View className="gap-2">
                <Text className="font-grotesk-bold text-[15px] text-ink-cream" style={rtl}>
                  {t.account.email}
                </Text>
                {/* Read-only: changing the sign-in email needs its own
                    verification flow, which this sheet doesn't run. */}
                <View className="rounded-2xl border border-cream-300 bg-cream-100 px-4 py-3.5">
                  <Text numberOfLines={1} className="font-grotesk-medium text-base text-ink-cream-muted" style={rtl}>
                    {user?.primaryEmailAddress?.emailAddress ?? t.account.noEmail}
                  </Text>
                </View>
              </View>

              {error ? (
                <Text className="font-grotesk-medium text-sm text-overdue-500" style={rtl}>
                  {error}
                </Text>
              ) : null}

              <View className="h-px bg-cream-300" />

              {editingPassword ? (
                <View className="gap-3">
                  {user?.passwordEnabled ? (
                    <TextInput
                      value={currentPassword}
                      onChangeText={setCurrentPassword}
                      placeholder={t.account.currentPassword}
                      placeholderTextColor={colors.ink.creamSubtle}
                      secureTextEntry
                      autoCapitalize="none"
                      style={[{ paddingVertical: 14 }, rtl]}
                      className="rounded-2xl border border-cream-300 bg-cream-100 px-4 font-grotesk-medium text-base text-ink-cream"
                    />
                  ) : null}
                  <TextInput
                    value={newPassword}
                    onChangeText={setNewPassword}
                    placeholder={t.account.newPassword}
                    placeholderTextColor={colors.ink.creamSubtle}
                    secureTextEntry
                    autoCapitalize="none"
                    style={[{ paddingVertical: 14 }, rtl]}
                    className="rounded-2xl border border-cream-300 bg-cream-100 px-4 font-grotesk-medium text-base text-ink-cream"
                  />
                  <TextInput
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder={t.account.confirmPassword}
                    placeholderTextColor={colors.ink.creamSubtle}
                    secureTextEntry
                    autoCapitalize="none"
                    style={[{ paddingVertical: 14 }, rtl]}
                    className="rounded-2xl border border-cream-300 bg-cream-100 px-4 font-grotesk-medium text-base text-ink-cream"
                  />

                  {passwordError ? (
                    <Text className="font-grotesk-medium text-sm text-overdue-500" style={rtl}>
                      {passwordError}
                    </Text>
                  ) : (
                    <Text className="font-grotesk-regular text-xs text-ink-cream-muted" style={rtl}>
                      {t.account.passwordHint}
                    </Text>
                  )}

                  <View className="flex-row items-center gap-3">
                    <AnimatedPressable
                      onPress={() => setEditingPassword(false)}
                      className="btn btn--secondary-cream flex-1"
                      accessibilityRole="button"
                    >
                      <Text className="font-grotesk-bold text-base text-ink-cream">{t.common.cancel}</Text>
                    </AnimatedPressable>
                    <AnimatedPressable
                      onPress={handleSavePassword}
                      disabled={savingPassword}
                      className="btn btn--primary flex-1"
                      style={savingPassword ? { opacity: 0.6 } : undefined}
                      accessibilityRole="button"
                    >
                      <Text className="font-grotesk-bold text-base text-on-accent">
                        {savingPassword ? t.account.saving : t.account.savePassword}
                      </Text>
                    </AnimatedPressable>
                  </View>
                </View>
              ) : (
                <AnimatedPressable
                  onPress={() => {
                    setPasswordStatus(null);
                    setEditingPassword(true);
                  }}
                  accessibilityRole="button"
                  className="items-center rounded-2xl border border-cream-300 bg-cream-200 py-4"
                >
                  <Text className="font-grotesk-bold text-base text-ink-cream">{t.account.changePassword}</Text>
                </AnimatedPressable>
              )}

              {passwordStatus ? (
                <Text className="text-center font-grotesk-medium text-sm text-ink-cream-muted">{passwordStatus}</Text>
              ) : null}

              <AnimatedPressable
                onPress={handleDeleteAccount}
                disabled={deleting}
                accessibilityRole="button"
                className="items-center py-1"
                style={deleting ? { opacity: 0.6 } : undefined}
              >
                <Text className="font-grotesk-bold text-base text-overdue-500">
                  {deleting ? t.account.deleting : t.account.deleteAccount}
                </Text>
              </AnimatedPressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
