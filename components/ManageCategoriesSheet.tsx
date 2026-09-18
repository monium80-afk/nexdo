import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { ColorSwatchPicker } from "@/components/ColorSwatchPicker";
import {
  CATEGORY_COLOR_OPTIONS,
  getCategoryTint,
  isBuiltInCategoryId,
  isEditableCategoryId,
} from "@/constants/categories";
import { colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/useTranslation";
import { useCategoryStore } from "@/store/useCategoryStore";
import { useTaskStore } from "@/store/useTaskStore";
import type { Category, CategoryColor } from "@/types/category";

/** Name + color picker, shared by "Add New Category" and editing an existing row. */
function CategoryForm({
  initialLabel = "",
  initialColor,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initialLabel?: string;
  initialColor: CategoryColor;
  submitLabel: string;
  /** Returns an error message to show, or null once the change is saved. */
  onSubmit: (label: string, color: CategoryColor) => string | null;
  onCancel?: () => void;
}) {
  const t = useTranslation();
  const [label, setLabel] = useState(initialLabel);
  const [color, setColor] = useState<CategoryColor>(initialColor);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    const message = onSubmit(label, color);
    setError(message);
    if (!message && !onCancel) setLabel("");
  };

  return (
    <View className="gap-4">
      <TextInput
        value={label}
        onChangeText={(text) => {
          setLabel(text);
          setError(null);
        }}
        placeholder={t.manageCategories.namePlaceholder}
        placeholderTextColor={colors.ink.creamSubtle}
        maxLength={24}
        returnKeyType="done"
        onSubmitEditing={handleSubmit}
        className="rounded-2xl border border-cream-300 bg-cream-50 px-4 py-3.5 font-grotesk-regular text-base text-ink-cream"
      />

      <View className="gap-3">
        <Text className="font-grotesk-semibold text-[15px] text-ink-cream-muted">{t.manageCategories.colorTheme}</Text>
        <ColorSwatchPicker selected={color} onSelect={setColor} />
      </View>

      {error ? <Text className="font-grotesk-medium text-sm text-overdue-500">{error}</Text> : null}

      <View className="flex-row items-center justify-end gap-4">
        {onCancel ? (
          <AnimatedPressable onPress={onCancel} hitSlop={8} accessibilityRole="button" className="px-2 py-3">
            <Text className="font-grotesk-semibold text-[15px] text-ink-cream-muted">{t.common.cancel}</Text>
          </AnimatedPressable>
        ) : null}
        <AnimatedPressable
          onPress={handleSubmit}
          accessibilityRole="button"
          className={onCancel ? "btn btn--primary flex-row gap-2 px-5 py-3" : "btn btn--primary flex-1 flex-row gap-2 py-3.5"}
        >
          <Feather name={onCancel ? "check" : "plus"} size={17} color={colors.cream[50]} />
          <Text className="font-grotesk-bold text-[15px] text-cream-50">{submitLabel}</Text>
        </AnimatedPressable>
      </View>
    </View>
  );
}

/** Settings → Task categories: rename, recolor, add, delete. */
export function ManageCategoriesSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTranslation();
  const categories = useCategoryStore((state) => state.categories);
  const addCategory = useCategoryStore((state) => state.addCategory);
  const updateCategory = useCategoryStore((state) => state.updateCategory);
  const deleteCategory = useCategoryStore((state) => state.deleteCategory);
  const tasks = useTaskStore((state) => state.tasks);
  // Only the listed rows skip "Other" — name and color checks below still see every category.
  const editableCategories = categories.filter((category) => isEditableCategoryId(category.id));

  const [editingId, setEditingId] = useState<string | null>(null);
  // Remounts the add form after a successful add so it starts fresh.
  const [addFormKey, setAddFormKey] = useState(0);

  const validate = (label: string, exceptId?: string): string | null => {
    const trimmed = label.trim();
    if (!trimmed) return t.manageCategories.nameRequired;
    const duplicate = categories.some(
      (category) => category.id !== exceptId && category.label.toLowerCase() === trimmed.toLowerCase(),
    );
    return duplicate ? t.manageCategories.duplicate(trimmed) : null;
  };

  // Where orphaned tasks go — "Other", under whatever name it has right now.
  const fallbackLabel = categories.find((category) => category.id === "other")?.label ?? t.categories.defaults.other;

  const handleAdd = (label: string, color: CategoryColor) => {
    const error = validate(label);
    if (error) return error;
    addCategory(label, color);
    setAddFormKey((key) => key + 1);
    return null;
  };

  const handleUpdate = (id: string, label: string, color: CategoryColor) => {
    const error = validate(label, id);
    if (error) return error;
    updateCategory(id, { label, color });
    setEditingId(null);
    return null;
  };

  const handleDelete = (category: Category) => {
    const taskCount = tasks.filter((task) => task.category === category.id).length;
    Alert.alert(
      t.manageCategories.deleteTitle(category.label),
      taskCount > 0
        ? t.manageCategories.deleteBodyTasks(taskCount, fallbackLabel)
        : t.manageCategories.deleteBodyEmpty,
      [
        { text: t.common.cancel, style: "cancel" },
        { text: t.common.delete, style: "destructive", onPress: () => deleteCategory(category.id) },
      ],
    );
  };

  const usedColors = categories.map((category) => category.color);
  const suggestedColor = CATEGORY_COLOR_OPTIONS.find((option) => !usedColors.includes(option.value))?.value ?? "terracotta";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="scrim flex-1 justify-center px-4 py-10" onPress={onClose}>
        {/* flexShrink (not a % maxHeight) is what caps the sheet at the screen's
            height — the list below can only scroll once the sheet can't outgrow it. */}
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flexShrink: 1 }}>
          <Pressable
            onPress={() => {}}
            className="overflow-hidden rounded-3xl border border-cream-300 bg-cream-50"
            style={{ flexShrink: 1 }}
          >
          <View className="flex-row items-start gap-4 px-6 pt-7">
            <View className="flex-1 gap-1.5">
              <Text className="font-grotesk-bold text-[26px] leading-tight tracking-tight text-ink-cream">
                {t.manageCategories.title}
              </Text>
              <Text className="font-grotesk-regular text-base text-ink-cream-muted">{t.manageCategories.subtitle}</Text>
            </View>
            <AnimatedPressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t.common.close}
              className="pt-2"
            >
              <Feather name="x" size={24} color={colors.ink.creamMuted} />
            </AnimatedPressable>
          </View>
          <View className="mx-6 mt-5 h-px bg-cream-300" />

          <ScrollView
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 24, paddingBottom: 28 }}
            keyboardShouldPersistTaps="handled"
          >
            <Text className="font-grotesk-bold text-[15px] tracking-[0.04em] text-ink-cream">
              {t.manageCategories.activeHeading(editableCategories.length)}
            </Text>

            <View className="mt-4 gap-3">
              {editableCategories.map((category) => {
                const tint = getCategoryTint(category.color);
                const canDelete = categories.length > 1 && !isBuiltInCategoryId(category.id);

                if (editingId === category.id) {
                  return (
                    <View key={category.id} className="rounded-2xl border border-cream-300 bg-cream-100 p-4">
                      <CategoryForm
                        initialLabel={category.label}
                        initialColor={category.color}
                        submitLabel={t.common.save}
                        onSubmit={(label, color) => handleUpdate(category.id, label, color)}
                        onCancel={() => setEditingId(null)}
                      />
                    </View>
                  );
                }

                return (
                  <View
                    key={category.id}
                    className="flex-row items-center gap-3 rounded-2xl border border-cream-300 bg-cream-100 py-3.5 pl-3.5 pr-2"
                  >
                    <View
                      className="shrink flex-row items-center gap-2 rounded-full border px-3.5 py-2"
                      style={{ backgroundColor: tint[100], borderColor: `${tint[500]}59` }}
                    >
                      <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tint[500] }} />
                      <Text numberOfLines={1} className="shrink font-grotesk-semibold text-base text-ink-cream">
                        {category.label}
                      </Text>
                    </View>

                    {/* Keeps the edit/delete buttons pinned to the right. */}
                    <View className="flex-1" />

                    <View className="flex-row items-center">
                      <AnimatedPressable
                        onPress={() => setEditingId(category.id)}
                        accessibilityRole="button"
                        accessibilityLabel={t.manageCategories.edit(category.label)}
                        className="h-9 w-9 items-center justify-center"
                      >
                        <Feather name="edit-2" size={19} color={colors.ink.creamMuted} />
                      </AnimatedPressable>
                      <AnimatedPressable
                        onPress={() => handleDelete(category)}
                        disabled={!canDelete}
                        accessibilityRole="button"
                        accessibilityLabel={t.manageCategories.delete(category.label)}
                        className="h-9 w-9 items-center justify-center"
                        style={canDelete ? undefined : { opacity: 0.35 }}
                      >
                        <Feather name="trash-2" size={19} color={colors.ink.creamMuted} />
                      </AnimatedPressable>
                    </View>
                  </View>
                );
              })}
            </View>

            <View className="mt-6 gap-4 rounded-2xl border border-cream-300 bg-cream-200/60 p-5">
              <View className="flex-row items-center gap-2.5">
                <Feather name="plus" size={20} color={colors.orange[500]} />
                <Text className="font-grotesk-semibold text-[17px] text-ink-cream">{t.manageCategories.addNew}</Text>
              </View>
              <CategoryForm
                key={addFormKey}
                initialColor={suggestedColor}
                submitLabel={t.manageCategories.addCategory}
                onSubmit={handleAdd}
              />
            </View>
          </ScrollView>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}
