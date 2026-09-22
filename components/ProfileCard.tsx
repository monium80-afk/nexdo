import { useUser } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { ActivityIndicator, Image, Text, TextInput, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/useTranslation";

/**
 * Photo and name live on the Clerk user, not in local storage, so they follow
 * the account to every device it signs in on.
 */
export function ProfileCard() {
  const t = useTranslation();
  const { user } = useUser();
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [username, setUsername] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayName = user?.fullName?.trim();

  const handleChangePhoto = async () => {
    if (!user) return;
    setUploadingPhoto(true);
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

      // Clerk accepts the image as a base64 data URL on React Native.
      await user.setProfileImage({ file: `data:${asset.mimeType ?? "image/jpeg"};base64,${asset.base64}` });
      await user.reload();
    } catch (uploadError) {
      console.warn("[ProfileCard] photo upload failed", uploadError);
      setError(t.profile.photoError);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleStartEditName = () => {
    setUsername(displayName ?? "");
    setError(null);
    setEditingName(true);
  };

  const handleSaveName = async () => {
    if (!user) return;
    if (!username.trim()) {
      setError(t.profile.nameRequired);
      return;
    }
    setSavingName(true);
    setError(null);
    try {
      // The username is kept in Clerk's firstName — it works on every Clerk
      // instance, unlike the `username` attribute which must be enabled first.
      await user.update({ firstName: username.trim(), lastName: "" });
      setEditingName(false);
    } catch (saveError) {
      console.warn("[ProfileCard] name update failed", saveError);
      setError(t.profile.nameError);
    } finally {
      setSavingName(false);
    }
  };

  return (
    <View className="card card--charcoal gap-4 p-4">
      <View className="flex-row items-center gap-4">
        <AnimatedPressable
          onPress={handleChangePhoto}
          disabled={uploadingPhoto}
          accessibilityRole="button"
          accessibilityLabel={t.profile.changePhoto}
          className="h-16 w-16"
        >
          {user?.hasImage ? (
            <Image source={{ uri: user.imageUrl }} className="h-16 w-16 rounded-full" />
          ) : (
            <View className="h-16 w-16 items-center justify-center rounded-full bg-charcoal-600">
              <Feather name="user" size={24} color={colors.ink.charcoal} />
            </View>
          )}
          <View className="absolute -bottom-0.5 -right-0.5 h-6 w-6 items-center justify-center rounded-full border-2 border-charcoal-800 bg-orange-500">
            {uploadingPhoto ? (
              <ActivityIndicator size="small" color={colors.onAccent} />
            ) : (
              <Feather name="camera" size={11} color={colors.onAccent} />
            )}
          </View>
        </AnimatedPressable>

        <View className="flex-1 gap-0.5">
          <Text
            numberOfLines={1}
            className={
              displayName
                ? "font-grotesk-semibold text-base text-ink-charcoal"
                : "font-grotesk-semibold text-base text-ink-charcoal-muted"
            }
          >
            {displayName || t.profile.addName}
          </Text>
          <Text numberOfLines={1} className="font-grotesk-regular text-sm text-ink-charcoal-muted">
            {user?.primaryEmailAddress?.emailAddress ?? ""}
          </Text>
        </View>

        {editingName ? null : (
          <AnimatedPressable onPress={handleStartEditName} hitSlop={8} accessibilityRole="button" accessibilityLabel={t.profile.editName}>
            <Feather name="edit-2" size={16} color={colors.ink.charcoalMuted} />
          </AnimatedPressable>
        )}
      </View>

      {editingName ? (
        <View className="card card--charcoal-inset gap-3 p-3.5">
          <TextInput
            value={username}
            onChangeText={setUsername}
            placeholder={t.profile.username}
            placeholderTextColor={colors.ink.charcoalMuted}
            autoFocus
            autoCapitalize="none"
            autoComplete="username"
            className="rounded-xl border border-charcoal-600 bg-charcoal-900 px-3.5 py-2.5 font-grotesk-medium text-sm text-ink-charcoal"
          />
          <View className="flex-row items-center justify-end gap-4">
            <AnimatedPressable onPress={() => setEditingName(false)} hitSlop={8} accessibilityRole="button">
              <Text className="font-grotesk-semibold text-sm text-ink-charcoal-muted">{t.common.cancel}</Text>
            </AnimatedPressable>
            <AnimatedPressable
              onPress={handleSaveName}
              disabled={savingName}
              accessibilityRole="button"
              className="rounded-full bg-orange-500 px-4 py-2"
              style={savingName ? { opacity: 0.6 } : undefined}
            >
              <Text className="font-grotesk-bold text-sm text-on-accent">{savingName ? t.profile.saving : t.common.save}</Text>
            </AnimatedPressable>
          </View>
        </View>
      ) : null}

      {error ? <Text className="font-grotesk-medium text-sm text-overdue-500">{error}</Text> : null}
    </View>
  );
}
