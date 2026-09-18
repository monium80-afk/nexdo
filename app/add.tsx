import { useAuth } from "@clerk/expo";
import { Feather, Ionicons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { ColorSwatchPicker } from "@/components/ColorSwatchPicker";
import { GemLogo } from "@/components/GemLogo";
import {
    CategoryPicker,
    computeDeadlineDate,
    DEADLINE_OPTIONS,
    DeadlineChip,
    DeadlineDatePicker,
    DURATION_OPTIONS,
    DurationChip,
    PriorityCard,
    SectionHeader,
    type DeadlineValue,
} from "@/components/TaskFormFields";
import { CATEGORY_COLOR_OPTIONS, resolveCategoryId } from "@/constants/categories";
import { colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/useTranslation";
import { useVoiceTranscription } from "@/hooks/useVoiceTranscription";
import { posthog } from "@/lib/posthog";
import { useCategoryStore } from "@/store/useCategoryStore";
import { useTaskStore } from "@/store/useTaskStore";
import type { CategoryColor } from "@/types/category";
import type { TaskCategory, TaskPriorityLevel } from "@/types/task";

const PRIORITY_OPTIONS: TaskPriorityLevel[] = ["high", "medium", "low"];

// Steps have no time of their own — the task's duration is split between them on save.
type StepDraft = { id: string; label: string };

function createStepId(): string {
  return `step-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function defaultCustomDeadline(): Date {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(18, 0, 0, 0);
  return date;
}

export default function Add() {
  const t = useTranslation();
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const addTask = useTaskStore((state) => state.addTask);
  const categories = useCategoryStore((state) => state.categories);
  const addCategory = useCategoryStore((state) => state.addCategory);

  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [category, setCategory] = useState<TaskCategory>(() => {
    const { categories, defaultCategoryId } = useCategoryStore.getState();
    return resolveCategoryId(categories, defaultCategoryId);
  });

  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [newCategoryLabel, setNewCategoryLabel] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState<CategoryColor>("terracotta");
  const [newCategoryError, setNewCategoryError] = useState<string | null>(null);

  const [durationMinutes, setDurationMinutes] = useState(45);
  const [customDurationOpen, setCustomDurationOpen] = useState(false);
  const [customDurationText, setCustomDurationText] = useState("");
  const [customDurationError, setCustomDurationError] = useState(false);

  const [deadlineValue, setDeadlineValue] = useState<DeadlineValue>("tomorrow");
  const [customDeadlineOpen, setCustomDeadlineOpen] = useState(false);
  const [customDeadline, setCustomDeadline] = useState<Date>(defaultCustomDeadline);

  const [priorityLevel, setPriorityLevel] = useState<TaskPriorityLevel>("high");

  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [stepDraftLabel, setStepDraftLabel] = useState("");

  // What was said lands in the step input, so it can be checked before adding.
  const voice = useVoiceTranscription((transcript) =>
    setStepDraftLabel((current) => (current.trim() ? `${current.trimEnd()} ${transcript}` : transcript)),
  );

  const [notes, setNotes] = useState("");

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/onboarding" />;

  const handleCustomDurationChange = (text: string) => {
    setCustomDurationText(text);
    const parsed = /^\d+$/.test(text.trim()) ? Number.parseInt(text, 10) : undefined;
    setDurationMinutes(parsed && parsed > 0 ? parsed : 0);
    setCustomDurationError(false);
  };

  const handleToggleNewCategory = () => {
    if (!newCategoryOpen) {
      // Suggest a color no category uses yet.
      const usedColors = categories.map((item) => item.color);
      const unused = CATEGORY_COLOR_OPTIONS.find((option) => !usedColors.includes(option.value));
      setNewCategoryColor(unused?.value ?? "terracotta");
    }
    setNewCategoryOpen((open) => !open);
    setNewCategoryError(null);
  };

  const handleAddCategory = () => {
    const label = newCategoryLabel.trim();
    if (!label) {
      setNewCategoryError(t.manageCategories.nameRequired);
      return;
    }
    if (categories.some((item) => item.label.toLowerCase() === label.toLowerCase())) {
      setNewCategoryError(t.manageCategories.duplicate(label));
      return;
    }
    const id = addCategory(label, newCategoryColor);
    if (id) setCategory(id);
    setNewCategoryLabel("");
    setNewCategoryOpen(false);
  };

  const handleToggleCustomDeadline = () => {
    if (!customDeadlineOpen) setCustomDeadline(computeDeadlineDate(deadlineValue) ?? defaultCustomDeadline());
    setCustomDeadlineOpen((open) => !open);
  };

  const handleAddStep = () => {
    const label = stepDraftLabel.trim();
    if (!label) return;
    setSteps((current) => [...current, { id: createStepId(), label }]);
    setStepDraftLabel("");
  };

  const handleRemoveStep = (id: string) => {
    setSteps((current) => current.filter((step) => step.id !== id));
  };

  // Guards against landing here with no history underneath (a stale deep
  // link, restored session, etc.) — router.back()/dismissTo() have nothing
  // to go back to in that case, so fall back to replacing straight to tabs.
  const handleClose = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/tasks");
    }
  };

  const handleOpenAiChat = () => {
    if (router.canGoBack()) {
      router.dismissTo("/(tabs)/ai-chat");
    } else {
      router.replace("/(tabs)/ai-chat");
    }
  };

  const handleSubmit = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setTitleTouched(true);
      return;
    }

    const estimatedMinutes = customDurationOpen && /^\d+$/.test(customDurationText.trim())
      ? Number.parseInt(customDurationText, 10)
      : durationMinutes;
    if (
      !Number.isInteger(estimatedMinutes) ||
      estimatedMinutes <= 0 ||
      (steps.length > 0 && estimatedMinutes < steps.length)
    ) {
      setCustomDurationError(true);
      return;
    }

    const dueDate = (customDeadlineOpen ? customDeadline : computeDeadlineDate(deadlineValue))?.toISOString();

    // Subtasks still need minutes behind the scenes (the remaining-time math
    // runs on them), so the task's duration is shared out evenly.
    const minutesPerStep = steps.length > 0 ? Math.floor(estimatedMinutes / steps.length) : 0;
    const remainderMinutes = steps.length > 0 ? estimatedMinutes % steps.length : 0;

    addTask({
      title: trimmedTitle,
      category,
      estimatedMinutes,
      dueDate,
      priorityLevel,
      notes,
      steps: steps.map((step, index) => ({
        ...step,
        estimatedMinutes: minutesPerStep + (index < remainderMinutes ? 1 : 0),
      })),
    });

    posthog.capture("task_created", {
      task_category: category,
      priority_level: priorityLevel,
      estimated_minutes: estimatedMinutes,
      has_deadline: Boolean(dueDate),
      step_count: steps.length,
    });

    if (router.canGoBack()) {
      router.dismissTo("/(tabs)/tasks");
    } else {
      router.replace("/(tabs)/tasks");
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.charcoal[900] }} edges={["top"]}>
      <View style={{ flex: 1, paddingTop: 28 }}>
        <View className="flex-1 overflow-hidden rounded-t-[28px] bg-cream-50">
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View className="flex-row items-start justify-between px-6 pb-5 pt-6">
              <View className="flex-row items-center gap-3">
                <GemLogo size={32} />
                <View>
                  <Text className="eyebrow text-orange-500">{t.form.eyebrow}</Text>
                  <Text className="text-title text-ink-cream">{t.form.title}</Text>
                </View>
              </View>
              <AnimatedPressable onPress={handleClose} hitSlop={8} className="h-9 w-9 items-center justify-center">
                <Feather name="x" size={22} color={colors.ink.creamMuted} />
              </AnimatedPressable>
            </View>
            <View className="border-b border-cream-300" />

            <ScrollView
              className="flex-1"
              contentContainerStyle={{ padding: 24, gap: 24 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View className="gap-2">
                <View className="flex-row items-center gap-1">
                  <Text className="eyebrow text-ink-cream">{t.form.taskTitle}</Text>
                  <Text className="eyebrow text-orange-500">*</Text>
                </View>
                <TextInput
                  value={title}
                  onChangeText={(text) => {
                    setTitle(text);
                    if (titleTouched) setTitleTouched(false);
                  }}
                  placeholder={t.form.titlePlaceholder}
                  placeholderTextColor={colors.ink.creamMuted}
                  className={
                    titleTouched
                      ? "rounded-2xl border border-overdue-500 bg-cream-50 px-4 py-3.5 font-grotesk-regular text-sm text-ink-cream"
                      : "rounded-2xl border border-cream-300 bg-cream-50 px-4 py-3.5 font-grotesk-regular text-sm text-ink-cream"
                  }
                />
                {titleTouched ? (
                  <Text className="font-grotesk-medium text-xs text-overdue-500">{t.form.titleRequired}</Text>
                ) : null}
              </View>

              <View className="gap-3">
                <SectionHeader
                  icon={<Feather name="tag" size={14} color={colors.orange[500]} />}
                  label={t.form.category}
                  action={{ label: newCategoryOpen ? t.common.cancel : `+ ${t.form.newCategory}`, onPress: handleToggleNewCategory }}
                />
                <CategoryPicker selectedId={category} onSelect={setCategory} compact />
                {newCategoryOpen ? (
                  <View className="gap-3 rounded-2xl border border-cream-300 bg-cream-100 p-4">
                    <TextInput
                      value={newCategoryLabel}
                      onChangeText={(text) => {
                        setNewCategoryLabel(text);
                        setNewCategoryError(null);
                      }}
                      placeholder={t.manageCategories.namePlaceholder}
                      placeholderTextColor={colors.ink.creamMuted}
                      maxLength={24}
                      autoFocus
                      returnKeyType="done"
                      onSubmitEditing={handleAddCategory}
                      className="rounded-2xl border border-cream-300 bg-cream-50 px-4 py-3 font-grotesk-regular text-sm text-ink-cream"
                    />
                    <ColorSwatchPicker selected={newCategoryColor} onSelect={setNewCategoryColor} />
                    {newCategoryError ? (
                      <Text className="font-grotesk-medium text-xs text-overdue-500">{newCategoryError}</Text>
                    ) : null}
                    <AnimatedPressable onPress={handleAddCategory} className="btn btn--primary flex-row gap-2 py-3">
                      <Feather name="plus" size={16} color={colors.cream[50]} />
                      <Text className="font-grotesk-bold text-sm text-cream-50">{t.manageCategories.addCategory}</Text>
                    </AnimatedPressable>
                  </View>
                ) : null}
              </View>

              <View className="gap-3">
                <SectionHeader
                  icon={<Feather name="clock" size={14} color={colors.orange[500]} />}
                  label={t.form.duration}
                  action={{ label: t.form.customDuration, onPress: () => setCustomDurationOpen((open) => !open) }}
                />
                <View className="flex-row flex-wrap gap-2">
                  {DURATION_OPTIONS.map((minutes) => (
                    <DurationChip
                      key={minutes}
                      label={t.form.durationOptions[minutes]}
                      selected={!customDurationOpen && durationMinutes === minutes}
                      onPress={() => {
                        setDurationMinutes(minutes);
                        setCustomDurationOpen(false);
                      }}
                    />
                  ))}
                </View>
                {customDurationOpen ? (
                  <View className="flex-row items-center gap-2 rounded-2xl border border-cream-300 bg-cream-50 px-4 py-3">
                    <TextInput
                      value={customDurationText}
                      onChangeText={handleCustomDurationChange}
                      placeholder={t.form.minutesPlaceholder}
                      placeholderTextColor={colors.ink.creamMuted}
                      keyboardType="number-pad"
                      className="flex-1 font-grotesk-regular text-sm text-ink-cream"
                    />
                    <Text className="font-grotesk-medium text-xs text-ink-cream-muted">{t.form.minutesUnit}</Text>
                  </View>
                ) : null}
                {customDurationError ? (
                  <Text className="font-grotesk-medium text-xs text-overdue-500">{t.form.durationError}</Text>
                ) : null}
              </View>

              <View className="gap-3">
                <SectionHeader
                  icon={<Feather name="calendar" size={14} color={colors.orange[500]} />}
                  label={t.form.deadline}
                  action={{ label: t.form.pickDate, onPress: handleToggleCustomDeadline }}
                />
                <View className="flex-row flex-wrap gap-2">
                  {DEADLINE_OPTIONS.map((value) => (
                    <DeadlineChip
                      key={value}
                      label={t.form.deadlines[value]}
                      selected={!customDeadlineOpen && deadlineValue === value}
                      onPress={() => {
                        setDeadlineValue(value);
                        setCustomDeadlineOpen(false);
                      }}
                    />
                  ))}
                </View>
                {customDeadlineOpen ? (
                  <DeadlineDatePicker value={customDeadline} onChange={setCustomDeadline} />
                ) : null}
              </View>

              <View className="gap-3">
                <SectionHeader
                  icon={<Ionicons name="flame" size={15} color={colors.orange[500]} />}
                  label={t.form.priority}
                />
                <View className="flex-row gap-3">
                  {PRIORITY_OPTIONS.map((level) => (
                    <PriorityCard
                      key={level}
                      level={level}
                      title={t.form.priorities[level]}
                      selected={priorityLevel === level}
                      onPress={() => setPriorityLevel(level)}
                    />
                  ))}
                </View>
              </View>

              <View className="gap-3 rounded-2xl border border-cream-300 bg-cream-100 p-4">
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center gap-2">
                    <Feather name="check-square" size={14} color={colors.ink.cream} />
                    <Text className="font-grotesk-bold text-sm text-ink-cream">{t.form.planSteps(steps.length)}</Text>
                  </View>
                  <Text className="font-grotesk-medium text-xs text-ink-cream-muted">{t.form.optionalPlan}</Text>
                </View>

                <View className="flex-row items-center gap-2">
                  {voice.isRecording || voice.isTranscribing ? (
                    <View className="flex-1 flex-row items-center gap-2 rounded-2xl border border-cream-300 bg-cream-50 px-4 py-3">
                      {voice.isRecording ? <View className="h-2 w-2 rounded-full bg-overdue-500" /> : null}
                      <Text className="font-grotesk-medium text-sm text-ink-cream-muted">
                        {voice.isRecording ? t.chat.recording(voice.durationLabel) : t.chat.transcribing}
                      </Text>
                    </View>
                  ) : (
                    <TextInput
                      value={stepDraftLabel}
                      onChangeText={setStepDraftLabel}
                      onSubmitEditing={handleAddStep}
                      returnKeyType="done"
                      placeholder={t.form.stepPlaceholder}
                      placeholderTextColor={colors.ink.creamMuted}
                      className="flex-1 rounded-2xl border border-cream-300 bg-cream-50 px-4 py-3 font-grotesk-regular text-sm text-ink-cream"
                    />
                  )}
                  <AnimatedPressable
                    onPress={voice.toggleRecording}
                    disabled={voice.isTranscribing}
                    accessibilityRole="button"
                    accessibilityLabel={voice.isRecording ? t.chat.stopRecording : t.chat.recordVoice}
                    className={
                      voice.isRecording
                        ? "h-11 w-11 items-center justify-center rounded-2xl border border-overdue-500 bg-overdue-100"
                        : "h-11 w-11 items-center justify-center rounded-2xl border border-cream-300 bg-cream-50"
                    }
                    style={{ opacity: voice.isTranscribing ? 0.4 : 1 }}
                  >
                    <Feather
                      name={voice.isRecording ? "square" : "mic"}
                      size={voice.isRecording ? 15 : 18}
                      color={voice.isRecording ? colors.overdue[500] : colors.ink.cream}
                    />
                  </AnimatedPressable>
                  <AnimatedPressable
                    onPress={handleAddStep}
                    disabled={!stepDraftLabel.trim()}
                    className="h-11 w-11 items-center justify-center rounded-2xl"
                    style={{ backgroundColor: stepDraftLabel.trim() ? colors.orange[500] : colors.cream[200] }}
                  >
                    <Feather
                      name="plus"
                      size={18}
                      color={stepDraftLabel.trim() ? colors.cream[50] : colors.ink.creamMuted}
                    />
                  </AnimatedPressable>
                </View>

                {steps.length > 0 ? (
                  <View className="gap-2">
                    {steps.map((step, index) => (
                      <View
                        key={step.id}
                        className="flex-row items-center gap-2 rounded-2xl border border-cream-300 bg-cream-50 px-4 py-2.5"
                      >
                        <Text className="font-grotesk-bold text-xs text-ink-cream-muted">{index + 1}.</Text>
                        <Text className="flex-1 font-grotesk-medium text-sm text-ink-cream" numberOfLines={1}>
                          {step.label}
                        </Text>
                        <AnimatedPressable onPress={() => handleRemoveStep(step.id)} hitSlop={8}>
                          <Feather name="x" size={14} color={colors.ink.creamMuted} />
                        </AnimatedPressable>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>

              <View className="gap-2">
                <View className="flex-row items-center gap-2">
                  <Feather name="align-left" size={14} color={colors.ink.cream} />
                  <Text className="eyebrow text-ink-cream">{t.form.notesTitle}</Text>
                </View>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder={t.form.notesPlaceholder}
                  placeholderTextColor={colors.ink.creamMuted}
                  multiline
                  style={{ textAlignVertical: "top", minHeight: 90 }}
                  className="rounded-2xl border border-cream-300 bg-cream-50 px-4 py-3.5 font-grotesk-regular text-sm text-ink-cream"
                />
              </View>
            </ScrollView>

            <View
              className="gap-4 border-t border-cream-300 bg-cream-50 px-6 pt-4"
              style={{ paddingBottom: insets.bottom + 24 }}
            >
              <AnimatedPressable onPress={handleOpenAiChat} className="flex-row items-center justify-center gap-2">
                <Feather name="message-circle" size={16} color={colors.orange[500]} />
                <Text className="font-grotesk-semibold text-sm text-orange-500">{t.form.openAiChat}</Text>
              </AnimatedPressable>
              <View className="flex-row items-center gap-4">
                <AnimatedPressable onPress={handleClose} hitSlop={8} className="px-2 py-3.5">
                  <Text className="font-grotesk-semibold text-base text-ink-cream-muted">{t.common.cancel}</Text>
                </AnimatedPressable>
                <AnimatedPressable onPress={handleSubmit} className="btn btn--primary flex-1 flex-row gap-2">
                  <Feather name="plus" size={18} color={colors.cream[50]} />
                  <Text className="font-grotesk-bold text-lg text-cream-50">{t.form.addTask}</Text>
                </AnimatedPressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </View>
    </SafeAreaView>
  );
}
