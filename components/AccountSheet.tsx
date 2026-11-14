import { useClerk, useUser } from "@clerk/expo";
import * as ImagePicker from "expo-image-picker";
import { useRef, useState, type ComponentRef } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { SheetIcon } from "@/components/addSheet/SheetParts";
import { PaperSheet } from "@/components/PaperSheet";
import { colors } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import type { DeleteAccountResponseBody } from "@/app/api/delete-account+api";
import { showAlert } from "@/lib/alert";
import { apiPost } from "@/lib/api";
import { posthog } from "@/lib/posthog";
import { resetPurchaser } from "@/lib/purchases";
import { useIsPro } from "@/store/useSubscriptionStore";
import { useTaskStore } from "@/store/useTaskStore";
import { shadow } from "@/constants/shadow";

const P = colors.palette;
const MIN_PASSWORD_LENGTH = 8;

/** How long the keyboard takes to open, roughly — on Android the sheet only moves once it has. */
const KEYBOARD_SETTLE_MS = 320;

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
  const t = useTranslation();
  const rtl = useRtlText();
  const { user } = useUser();
  const { signOut } = useClerk();
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

  // With the keyboard up the sheet sits on top of it and shrinks
  // (BottomSheet), so the field being typed in is scrolled into what's left:
  // the name at the top, the password fields at the foot. After a beat, once
  // the keyboard — and the sheet with it — has moved.
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const revealNameField = () => setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: true }), KEYBOARD_SETTLE_MS);
  const revealPasswordFields = () => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), KEYBOARD_SETTLE_MS);

  // Reopening the sheet starts from whatever the account holds now, and drops
  // any half-finished edit from last time: derived-from-props state, no
  // effect needed.
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
  const handleSaveName = async (): Promise<boolean> => {
    if (!user) return false;
    const trimmed = name.trim();
    if (trimmed === (user.fullName ?? "")) return true;
    if (!trimmed) {
      setError(t.account.nameRequired);
      setName(user.fullName ?? "");
      return false;
    }

    setNameStatus("saving");
    setError(null);
    try {
      // The whole name goes in Clerk's firstName — it works on every Clerk
      // instance, unlike the `username` attribute which must be enabled first.
      await user.update({ firstName: trimmed, lastName: "" });
      setNameStatus("saved");
      return true;
    } catch (saveError) {
      console.warn("[AccountSheet] name update failed", saveError);
      setError(t.account.nameError);
      setNameStatus(null);
      return false;
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
          try {
            await apiPost<DeleteAccountResponseBody>("/api/delete-account", {}, undefined, DELETE_ACCOUNT_TIMEOUT_MS);
            // Only once it's gone, so a failed deletion isn't counted as one.
            posthog.capture("account_deleted");
            posthog.reset();
          } catch (deleteError) {
            console.warn("[AccountSheet] account deletion failed", deleteError);
            // The server deletes one table after another, so it may have got partway.
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
            Promise.resolve().then(() => handleTaskSignOut({ accountDeleted: true })),
            resetPurchaser(),
          ]);
        },
      },
    ]);
  };

  // Save keeps the name (and a new password, when one is being set), then closes.
  const handleSave = async () => {
    if (!(await handleSaveName())) return;
    if (editingPassword) {
      await handleSavePassword();
      return;
    }
    onClose();
  };

  const fieldStyle = {
    height: 49,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#EADFD1",
    backgroundColor: P.paperCard,
    paddingHorizontal: 17,
    fontFamily: "SpaceGrotesk-Regular",
    fontSize: 16,
    color: P.ink,
  } as const;
  const label = (text: string) => (
    <Text style={{ fontFamily: "SpaceMono-Bold", fontSize: 10, letterSpacing: 2, color: P.inkMuted, marginBottom: 9 }}>{text}</Text>
  );
  const passwordField = (value: string, onChange: (text: string) => void, placeholder: string) => (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={P.paperFaint}
      secureTextEntry
      autoCapitalize="none"
      onFocus={revealPasswordFields}
      selectionColor={P.accent}
      style={[fieldStyle, rtl]}
    />
  );
  const fullName = user?.fullName?.trim() || "";
  const initials = (fullName.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 1).join("") + (fullName.split(/\s+/).length > 1 ? fullName.split(/\s+/).slice(-1)[0][0] : "")).toUpperCase();

  return (
    <PaperSheet visible={visible} onClose={onClose}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <Text accessibilityRole="header" style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 22, letterSpacing: -0.3, color: P.ink }}>
          {t.account.title}
        </Text>
        <AnimatedPressable
          onPress={onClose}
          scaleTo={0.92}
          accessibilityRole="button"
          accessibilityLabel={t.account.close}
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: P.chip, alignItems: "center", justifyContent: "center" }}
        >
          <SheetIcon name="close" size={16} color={P.ink} strokeWidth={2.2} />
        </AnimatedPressable>
      </View>
      <ScrollView
        ref={scrollRef}
        style={{ flexGrow: 0, flexShrink: 1 }}
        contentContainerStyle={{ paddingBottom: 4 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <AnimatedPressable
          onPress={handleChangePhoto}
          disabled={uploadingPhoto}
          scaleTo={0.98}
          accessibilityRole="button"
          accessibilityLabel={t.account.changePhoto}
          style={{ flexDirection: "row", alignItems: "center", gap: 14 }}
        >
          <View style={{ width: 64, height: 64, borderRadius: 32, overflow: "hidden", backgroundColor: P.accent, alignItems: "center", justifyContent: "center" }}>
            {user?.hasImage ? (
              <Image source={{ uri: user.imageUrl }} style={{ width: 64, height: 64 }} />
            ) : (
              <Text style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 22, letterSpacing: -0.4, color: "#FFFFFF" }}>{initials || "?"}</Text>
            )}
            {uploadingPhoto ? (
              <View className="scrim items-center justify-center" style={StyleSheet.absoluteFill}>
                <ActivityIndicator size="small" color="#FFFFFF" />
              </View>
            ) : null}
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[{ fontFamily: "SpaceGrotesk-SemiBold", fontSize: 14.5, color: P.accentInk }, rtl]}>{t.redesign.changePhoto}</Text>
            <Text style={[{ fontFamily: "SpaceGrotesk-Regular", fontSize: 13, color: P.inkMuted }, rtl]}>{t.redesign.photoHint}</Text>
          </View>
        </AnimatedPressable>

        <View style={{ marginTop: 22 }}>
          {label(t.redesign.name)}
          <TextInput
            value={name}
            onChangeText={(value) => {
              setName(value);
              setNameStatus(null);
            }}
            onFocus={revealNameField}
            returnKeyType="done"
            placeholder={t.account.namePlaceholder}
            placeholderTextColor={P.paperFaint}
            selectionColor={P.accent}
            style={[fieldStyle, rtl]}
          />
          {nameStatus === "saving" ? (
            <Text style={{ marginTop: 6, fontFamily: "SpaceGrotesk-Medium", fontSize: 13, color: P.inkMuted }}>{t.account.saving}</Text>
          ) : null}
        </View>

        <View style={{ marginTop: 18 }}>
          {label(t.redesign.email)}
          {/* Read-only: changing the sign-in email needs its own verification flow. */}
          <View style={[fieldStyle, { backgroundColor: "#F2E9DE", flexDirection: "row", alignItems: "center", gap: 10 }]}>
            <Text numberOfLines={1} style={{ flex: 1, fontFamily: "SpaceGrotesk-Regular", fontSize: 16, color: P.inkMuted }}>
              {user?.primaryEmailAddress?.emailAddress ?? t.account.noEmail}
            </Text>
            <SheetIcon name="lock" size={16} color={P.inkFaint} />
          </View>
        </View>

        {error ? (
          <Text style={[{ marginTop: 12, fontFamily: "SpaceGrotesk-Medium", fontSize: 13, color: P.alert }, rtl]}>{error}</Text>
        ) : null}

        {editingPassword ? (
          <View style={{ marginTop: 18, gap: 10 }}>
            {user?.passwordEnabled ? passwordField(currentPassword, setCurrentPassword, t.account.currentPassword) : null}
            {passwordField(newPassword, setNewPassword, t.account.newPassword)}
            {passwordField(confirmPassword, setConfirmPassword, t.account.confirmPassword)}
            <Text style={[{ fontFamily: "SpaceGrotesk-Medium", fontSize: 13, color: passwordError ? P.alert : P.inkMuted }, rtl]}>
              {passwordError ?? t.account.passwordHint}
            </Text>
          </View>
        ) : null}

        <View style={{ marginTop: 22, flexDirection: "row", gap: 10 }}>
          <AnimatedPressable
            onPress={() => {
              setPasswordStatus(null);
              setPasswordError(null);
              setEditingPassword(!editingPassword);
            }}
            scaleTo={0.97}
            accessibilityRole="button"
            style={{ flex: 1, height: 54, borderRadius: 27, backgroundColor: P.chip, alignItems: "center", justifyContent: "center" }}
          >
            <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: "SpaceGrotesk-SemiBold", fontSize: 16, color: P.ink }}>
              {editingPassword ? t.common.cancel : t.account.changePassword}
            </Text>
          </AnimatedPressable>
          <AnimatedPressable
            onPress={handleSave}
            disabled={savingPassword || nameStatus === "saving"}
            scaleTo={0.97}
            accessibilityRole="button"
            style={{ width: 120, height: 54, borderRadius: 27, backgroundColor: P.accent, alignItems: "center", justifyContent: "center", ...shadow("0 8px 20px rgba(242, 106, 46, 0.3)", 6, "#F26A2E") }}
          >
            <Text style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 16, color: "#FFFFFF" }}>
              {savingPassword ? t.account.saving : t.redesign.save}
            </Text>
          </AnimatedPressable>
        </View>

        {passwordStatus ? (
          <Text style={{ marginTop: 10, textAlign: "center", fontFamily: "SpaceGrotesk-Medium", fontSize: 13, color: P.inkMuted }}>{passwordStatus}</Text>
        ) : null}

        <AnimatedPressable
          onPress={handleDeleteAccount}
          disabled={deleting}
          scaleTo={0.96}
          accessibilityRole="button"
          style={{ marginTop: 20, alignSelf: "center", paddingVertical: 6 }}
        >
          <Text style={{ fontFamily: "SpaceGrotesk-SemiBold", fontSize: 15, color: P.alert, opacity: deleting ? 0.5 : 1 }}>
            {deleting ? t.account.deleting : t.account.deleteAccount}
          </Text>
        </AnimatedPressable>
      </ScrollView>
    </PaperSheet>
  );
}
