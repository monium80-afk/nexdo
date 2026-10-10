import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { Keyboard, ScrollView, Text, View } from "react-native";

import { BottomSheet } from "@/components/BottomSheet";
import { ContextComposer } from "@/components/ContextComposer";
import { HighlightedText } from "@/components/HighlightedText";
import { ReassessmentNotice } from "@/components/ReassessmentNotice";
import { SectionHeader } from "@/components/SectionHeader";
import { useRtlText } from "@/hooks/useRtlText";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { showPlanLimit } from "@/lib/paywall";
import { useReassessStore, type ContextAttachment } from "@/store/useReassessStore";
import type { Task } from "@/types/task";

/**
 * A focus session's "Add context": the same box as Task Details' Add context
 * for AI — a note, a photo of the instructions, a document — for when the
 * user is in the middle of the task and wants Nexdo's help with it. Nexdo
 * reads it, updates the task (its steps show in the session at once) and its
 * advice, which shows here once it's done. Shares Task Details' state
 * (useReassessStore), so either place shows how the last one went.
 */
export function ContextSheet({ visible, task, onClose }: { visible: boolean; task: Task; onClose: () => void }) {
  const t = useTranslation();
  const colors = useColors();
  const rtl = useRtlText();
  const reassess = useReassessStore((state) => state.byTask[task.id]);
  const submit = useReassessStore((state) => state.submit);
  const retry = useReassessStore((state) => state.retry);
  const dismiss = useReassessStore((state) => state.dismiss);
  const [text, setText] = useState("");
  const [file, setFile] = useState<ContextAttachment | null>(null);
  const running = reassess?.status === "running";

  // Out of this month's notes, or photos and documents: the plans, once.
  const limitMeter = reassess?.status === "error" && reassess.reason === "limit" ? (reassess.meter ?? "chat") : null;
  const hadLimit = useRef(limitMeter !== null);
  useEffect(() => {
    if (limitMeter && !hadLimit.current) showPlanLimit(limitMeter, true);
    hadLimit.current = limitMeter !== null;
  }, [limitMeter]);

  const handleSend = () => {
    const trimmed = text.trim();
    if ((!trimmed && !file) || running) return;
    setText("");
    setFile(null);
    Keyboard.dismiss();
    void submit(task.id, { text: trimmed, file: file ?? undefined });
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t.taskDetail.contextTitle}
      titleIcon={<Ionicons name="sparkles" size={14} color={colors.orange[500]} />}
      closeLabel={t.common.close}
    >
      <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View className="gap-3">
          <Text className="text-body text-ink-cream-muted" style={rtl}>
            {t.session.contextIntro}
          </Text>
          {reassess ? (
            <ReassessmentNotice state={reassess} onDismiss={() => dismiss(task.id)} onRetry={() => void retry(task.id)} />
          ) : null}
          {/* What it changed is above; how to go about the task now is the help itself. */}
          {reassess?.status === "done" && task.aiContext.advice ? (
            <View className="card card--cream-soft gap-2 p-[16px]">
              <SectionHeader icon={<Ionicons name="sparkles" size={14} color={colors.orange[500]} />} label={t.taskDetail.adviceTitle} />
              <HighlightedText
                text={task.aiContext.advice}
                className="text-body text-ink-cream"
                highlightClassName="font-grotesk-semibold text-orange-600"
              />
            </View>
          ) : null}
          <ContextComposer
            value={text}
            onChangeText={setText}
            file={file}
            onChangeFile={setFile}
            onSend={handleSend}
            placeholder={reassess?.status === "clarify" ? t.taskDetail.reassess.answerPlaceholder : t.taskDetail.contextPlaceholder}
            disabled={running}
          />
        </View>
      </ScrollView>
    </BottomSheet>
  );
}
