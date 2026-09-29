import { useAuth } from "@clerk/expo";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { AddItemField } from "@/components/AddItemField";
import { IconButton, PrimaryButton, TextButton } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { RecurrencePicker } from "@/components/RecurrencePicker";
import { ScreenHeader } from "@/components/ScreenHeader";
import { SectionHeader } from "@/components/SectionHeader";
import {
    computeDeadline,
    DEADLINE_OPTIONS,
    DeadlineDatePicker,
    deadlineToDraft,
    draftToDeadline,
    DURATION_OPTIONS,
    PriorityCard,
    type DeadlineDraft,
    type DeadlineValue,
} from "@/components/TaskFormFields";
import { TextField } from "@/components/TextField";
import { listItemEntering, listItemLayout } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { posthog } from "@/lib/posthog";
import type { RuleInput } from "@/lib/recurrence";
import { useTaskStore } from "@/store/useTaskStore";
import type { TaskPriorityLevel } from "@/types/task";

const PRIORITY_OPTIONS: TaskPriorityLevel[] = ["high", "medium", "low"];

// Steps have no time of their own — the task's duration is split between them on save.
type StepDraft = { id: string; label: string };

function createStepId(): string {
  return `step-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export default function Add() {
  const colors = useColors();
  const t = useTranslation();
  const rtl = useRtlText();
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const addTask = useTaskStore((state) => state.addTask);

  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);

  const [durationMinutes, setDurationMinutes] = useState(45);
  const [customDurationOpen, setCustomDurationOpen] = useState(false);
  const [customDurationText, setCustomDurationText] = useState("");
  const [customDurationError, setCustomDurationError] = useState(false);

  const [deadlineValue, setDeadlineValue] = useState<DeadlineValue>("tomorrow");
  const [customDeadlineOpen, setCustomDeadlineOpen] = useState(false);
  const [customDeadline, setCustomDeadline] = useState<DeadlineDraft>(() => deadlineToDraft(undefined));

  // Medium by default: most tasks aren't urgent, and starting on "High"
  // pushed every new task to the top of the Next queue unless the user
  // remembered to change it.
  const [priorityLevel, setPriorityLevel] = useState<TaskPriorityLevel>("medium");

  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [stepDraftLabel, setStepDraftLabel] = useState("");

  const [notes, setNotes] = useState("");

  // Doesn't repeat by default.
  const [recurrence, setRecurrence] = useState<RuleInput | null>(null);

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/onboarding" />;

  const handleCustomDurationChange = (text: string) => {
    setCustomDurationText(text);
    const parsed = /^\d+$/.test(text.trim()) ? Number.parseInt(text, 10) : undefined;
    setDurationMinutes(parsed && parsed > 0 ? parsed : 0);
    setCustomDurationError(false);
  };

  const handleToggleCustomDeadline = () => {
    if (!customDeadlineOpen) setCustomDeadline(deadlineToDraft(computeDeadline(deadlineValue)));
    setCustomDeadlineOpen((open) => !open);
  };

  // A chip is a day with no time; the calendar adds one only when asked.
  const chosenDeadline = customDeadlineOpen ? draftToDeadline(customDeadline) : computeDeadline(deadlineValue);

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

    // Subtasks still need minutes behind the scenes (the remaining-time math
    // runs on them), so the task's duration is shared out evenly.
    const minutesPerStep = steps.length > 0 ? Math.floor(estimatedMinutes / steps.length) : 0;
    const remainderMinutes = steps.length > 0 ? estimatedMinutes % steps.length : 0;

    addTask({
      title: trimmedTitle,
      estimatedMinutes,
      deadline: chosenDeadline,
      priorityLevel,
      notes,
      steps: steps.map((step, index) => ({
        ...step,
        estimatedMinutes: minutesPerStep + (index < remainderMinutes ? 1 : 0),
      })),
      recurrence: recurrence ?? undefined,
    });

    posthog.capture("task_created", {
      priority_level: priorityLevel,
      estimated_minutes: estimatedMinutes,
      has_deadline: Boolean(chosenDeadline),
      step_count: steps.length,
      recurrence: recurrence?.frequency ?? "none",
    });

    if (router.canGoBack()) {
      router.dismissTo("/(tabs)/tasks");
    } else {
      router.replace("/(tabs)/tasks");
    }
  };

  // Charcoal at the top, as on the Tasks page. The header covers the modal's
  // own cream (app/_layout.tsx), so nothing lighter shows as it slides up.
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.charcoal[900] }} edges={["top"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScreenHeader
          title={t.form.title}
          actions={<IconButton icon="x" variant="header" onPress={handleClose} accessibilityLabel={t.common.close} />}
        />

        <ScrollView
          style={{ backgroundColor: colors.cream[100] }}
          contentContainerStyle={{ paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View className="gap-6 px-6 pt-4">
            <View className="gap-2">
              <SectionHeader label={t.form.taskTitle} required />
              <TextField
                value={title}
                onChangeText={(text) => {
                  setTitle(text);
                  if (titleTouched) setTitleTouched(false);
                }}
                placeholder={t.form.titlePlaceholder}
                error={titleTouched}
              />
              {titleTouched ? (
                <Text className="font-grotesk-medium text-sm text-overdue-500">{t.form.titleRequired}</Text>
              ) : null}
            </View>

            <View className="gap-3">
              <SectionHeader
                icon="clock"
                label={t.form.duration}
                action={{ label: t.form.customDuration, onPress: () => setCustomDurationOpen((open) => !open) }}
              />
              <View className="flex-row flex-wrap gap-2">
                {DURATION_OPTIONS.map((minutes) => (
                  <Chip
                    key={minutes}
                    label={t.form.durationOptions[minutes]}
                    selected={!customDurationOpen && durationMinutes === minutes}
                    accessibilityRole="radio"
                    onPress={() => {
                      setDurationMinutes(minutes);
                      setCustomDurationOpen(false);
                    }}
                  />
                ))}
              </View>
              {customDurationOpen ? (
                <TextField
                  value={customDurationText}
                  onChangeText={handleCustomDurationChange}
                  placeholder={t.form.minutesPlaceholder}
                  keyboardType="number-pad"
                  error={customDurationError}
                  trailing={<Text className="font-grotesk-medium text-sm text-ink-cream-muted">{t.form.minutesUnit}</Text>}
                />
              ) : null}
              {customDurationError ? (
                <Text className="font-grotesk-medium text-sm text-overdue-500">{t.form.durationError}</Text>
              ) : null}
            </View>

            <View className="gap-3">
              <SectionHeader
                icon="calendar"
                label={t.form.deadline}
                action={{ label: t.form.pickDate, onPress: handleToggleCustomDeadline }}
              />
              <View className="flex-row flex-wrap gap-2">
                {DEADLINE_OPTIONS.map((value) => (
                  <Chip
                    key={value}
                    label={t.form.deadlines[value]}
                    selected={!customDeadlineOpen && deadlineValue === value}
                    accessibilityRole="radio"
                    onPress={() => {
                      setDeadlineValue(value);
                      setCustomDeadlineOpen(false);
                    }}
                  />
                ))}
              </View>
              {customDeadlineOpen ? <DeadlineDatePicker value={customDeadline} onChange={setCustomDeadline} /> : null}
            </View>

            <RecurrencePicker value={recurrence} onChange={setRecurrence} deadline={chosenDeadline} />

            <View className="gap-3">
              <SectionHeader icon={<Ionicons name="flame" size={14} color={colors.ink.creamMuted} />} label={t.form.priority} />
              <View className="flex-row gap-2">
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

            <View className="gap-3">
              <SectionHeader icon="check-square" label={t.form.planSteps(steps.length)} hint={t.form.optionalPlan} />
              <AddItemField
                value={stepDraftLabel}
                onChangeText={setStepDraftLabel}
                onAdd={handleAddStep}
                placeholder={t.form.stepPlaceholder}
                addLabel={t.breakdown.addStep}
              />
              {steps.length > 0 ? (
                <View className="gap-2">
                  {steps.map((step, index) => (
                    <Animated.View key={step.id} entering={listItemEntering(index)} layout={listItemLayout()}>
                      {/* A step-to-be: the checklist row's card, numbered instead of ticked. */}
                      <View className="card card--cream-soft min-h-[46px] flex-row items-center gap-3 pl-[16px] pr-1.5">
                        <Text className="w-[22px] font-grotesk-bold text-sm text-ink-cream-muted">{index + 1}.</Text>
                        <Text className="flex-1 font-grotesk-semibold text-base text-ink-cream" numberOfLines={1} style={rtl}>
                          {step.label}
                        </Text>
                        <IconButton icon="x" onPress={() => handleRemoveStep(step.id)} accessibilityLabel={t.common.delete} />
                      </View>
                    </Animated.View>
                  ))}
                </View>
              ) : null}
            </View>

            <View className="gap-3">
              <SectionHeader icon="align-left" label={t.form.notesTitle} />
              <TextField
                value={notes}
                onChangeText={setNotes}
                placeholder={t.form.notesPlaceholder}
                multiline
                inputStyle={{ minHeight: 90 }}
              />
            </View>
          </View>
        </ScrollView>

        <View
          className="gap-3 border-t border-cream-200 bg-cream-50 px-6 pt-3"
          style={{ paddingBottom: insets.bottom + 21 }}
        >
          <TextButton
            icon="message-circle"
            label={t.form.openAiChat}
            onPress={handleOpenAiChat}
            tone="accent"
            className="self-center py-1"
          />
          <View className="flex-row items-center gap-5">
            <TextButton label={t.common.cancel} onPress={handleClose} className="py-3" />
            <PrimaryButton icon="plus" size="lg" label={t.form.addTask} onPress={handleSubmit} className="flex-1" />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
