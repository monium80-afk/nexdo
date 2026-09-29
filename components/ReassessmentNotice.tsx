import { Feather, Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import Animated from "react-native-reanimated";

import { IconButton, SecondaryButton, TextButton, type FeatherIconName } from "@/components/Button";
import { listItemEntering } from "@/constants/theme";
import { useRtlText } from "@/hooks/useRtlText";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { deadlineInstant } from "@/lib/deadline";
import { formatDuration } from "@/lib/formatDuration";
import type { Translations } from "@/lib/i18n";
import type { ReassessmentReport, SubtaskChangeSummary } from "@/lib/reassessment";
import { previewDueLabel } from "@/lib/taskMeta";
import type { ReassessState } from "@/store/useReassessStore";
import type { TaskDeadline } from "@/types/task";

type Copy = Translations["taskDetail"]["reassess"];

function subtaskParts(summary: SubtaskChangeSummary, r: Copy): string[] {
  const parts: string[] = [];
  if (summary.added) parts.push(r.subtaskParts.added(summary.added));
  if (summary.removed) parts.push(r.subtaskParts.removed(summary.removed));
  if (summary.completed) parts.push(r.subtaskParts.completed(summary.completed));
  if (summary.renamed) parts.push(r.subtaskParts.renamed(summary.renamed));
  if (summary.retimed) parts.push(r.subtaskParts.retimed(summary.retimed));
  if (summary.reordered) parts.push(r.subtaskParts.reordered);
  return parts;
}

/** One line per change the save actually made — worded here, so it follows the app language. */
function changeLines(report: ReassessmentReport, t: Translations): string[] {
  const r = t.taskDetail.reassess;
  const now = new Date();
  // A date-only deadline reads as its day — no time it never had.
  const deadline = (value: TaskDeadline | undefined) =>
    previewDueLabel(value ? deadlineInstant(value).toISOString() : undefined, !!value?.time, now, t);
  return report.changes.map((change) => {
    switch (change.field) {
      case "title":
        return r.title(change.from, change.to);
      case "description":
        return r.description[change.kind];
      case "deadline":
        return r.deadline(deadline(change.from), deadline(change.to));
      case "duration":
        return r.duration(formatDuration(change.from), formatDuration(change.to));
      case "priority":
        return r.priority(r.levels[change.from], r.levels[change.to]);
      case "score":
        return r.score(change.from, change.to);
      case "subtasks":
        return r.subtasks(subtaskParts(change.summary, r));
      case "advice":
        return r.advice[change.kind];
    }
  });
}

/** The inset card every state sits in, with its heading row and an optional close button. */
function NoticeCard({
  icon,
  title,
  onClose,
  closeLabel,
  children,
}: {
  icon: ReactNode;
  title: string;
  onClose?: () => void;
  closeLabel?: string;
  children?: ReactNode;
}) {
  const rtl = useRtlText();
  return (
    <View className="card card--cream-inset gap-2.5 py-3 pl-[14px] pr-1.5" accessibilityLiveRegion="polite">
      <View className="flex-row items-start gap-2.5">
        <View className="pt-[3px]">{icon}</View>
        <Text className="flex-1 pt-px font-grotesk-semibold text-sm text-ink-cream" style={rtl}>
          {title}
        </Text>
        {onClose ? <IconButton icon="x" onPress={onClose} accessibilityLabel={closeLabel} /> : null}
      </View>
      {children ? <View className="gap-2 pr-2">{children}</View> : null}
    </View>
  );
}

function Line({ icon, text, muted = false }: { icon: FeatherIconName; text: string; muted?: boolean }) {
  const colors = useColors();
  const rtl = useRtlText();
  return (
    <View className="flex-row items-start gap-2">
      <View className="pt-[3px]">
        <Feather name={icon} size={13} color={muted ? colors.ink.creamSubtle : colors.orange[600]} />
      </View>
      <Text className={`flex-1 text-body ${muted ? "text-ink-cream-muted" : "text-ink-cream"}`} style={rtl}>
        {text}
      </Text>
    </View>
  );
}

function QuotedNote({ text }: { text: string }) {
  const rtl = useRtlText();
  return (
    <Text numberOfLines={3} className="text-quote text-ink-cream-muted" style={rtl}>
      “{text}”
    </Text>
  );
}

/**
 * What Nexdo did with the latest note, in Task Details: working on it, what
 * it changed (or that nothing needed to), a question back, or a failure that
 * left the task untouched.
 */
export function ReassessmentNotice({
  state,
  onDismiss,
  onRetry,
}: {
  state: ReassessState;
  onDismiss: () => void;
  onRetry: () => void;
}) {
  const colors = useColors();
  const t = useTranslation();
  const rtl = useRtlText();
  const r = t.taskDetail.reassess;

  let content: ReactNode;
  switch (state.status) {
    case "running":
      content = (
        <View className="card card--cream-inset flex-row items-center gap-3 px-[14px] py-3" accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={colors.orange[500]} />
          <View className="flex-1 gap-0.5">
            <Text className="font-grotesk-semibold text-sm text-ink-cream" style={rtl}>
              {r.running}
            </Text>
            <Text numberOfLines={2} className="text-body text-ink-cream-muted" style={rtl}>
              {state.pending.noteText}
            </Text>
          </View>
        </View>
      );
      break;

    case "done": {
      const lines = changeLines(state.report, t);
      const { summary, keptUserEdits, deadlineUnchanged } = state.report;
      content =
        lines.length > 0 ? (
          <NoticeCard
            icon={<Ionicons name="sparkles" size={14} color={colors.orange[500]} />}
            title={r.updatedTitle}
            onClose={onDismiss}
            closeLabel={r.dismiss}
          >
            {summary ? (
              <Text className="text-body text-ink-cream-muted" style={rtl}>
                {summary}
              </Text>
            ) : null}
            {lines.map((line) => (
              <Line key={line} icon="check" text={line} />
            ))}
            {deadlineUnchanged ? <Line icon="minus" text={r.deadlineUnchanged} muted /> : null}
            {keptUserEdits ? <Line icon="info" text={r.keptUserEdits} muted /> : null}
          </NoticeCard>
        ) : (
          <NoticeCard
            icon={<Feather name="check-circle" size={14} color={colors.orange[600]} />}
            title={r.upToDate}
            onClose={onDismiss}
            closeLabel={r.dismiss}
          >
            {summary ? (
              <Text className="text-body text-ink-cream-muted" style={rtl}>
                {summary}
              </Text>
            ) : null}
            {keptUserEdits ? <Line icon="info" text={r.keptUserEdits} muted /> : null}
          </NoticeCard>
        );
      break;
    }

    case "clarify":
      content = (
        <NoticeCard
          icon={<Feather name="help-circle" size={14} color={colors.orange[600]} />}
          title={r.clarifyTitle}
          onClose={onDismiss}
          closeLabel={r.discard}
        >
          <Text className="font-grotesk-medium text-[14px] leading-5 text-ink-cream" style={rtl}>
            {state.question}
          </Text>
          <QuotedNote text={state.pending.noteText} />
        </NoticeCard>
      );
      break;

    case "error":
      content = (
        <NoticeCard
          icon={<Feather name="alert-circle" size={14} color={colors.overdue[500]} />}
          title={state.reason === "ai" ? r.aiFailed : r.saveFailed}
        >
          <QuotedNote text={state.pending.noteText} />
          <View className="flex-row items-center gap-5 pt-1">
            <SecondaryButton icon="refresh-cw" label={t.common.tryAgain} onPress={onRetry} />
            <TextButton label={r.discard} onPress={onDismiss} />
          </View>
        </NoticeCard>
      );
      break;
  }

  // Keyed by status, so each new state rises in like a new list item.
  return (
    <Animated.View key={state.status} entering={listItemEntering(0)}>
      {content}
    </Animated.View>
  );
}
