import { useUser } from "@clerk/expo";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Image, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { GemLogo } from "@/components/GemLogo";
import { ImageViewerModal } from "@/components/ImageViewerModal";
import { InboxInput } from "@/components/InboxInput";
import { SuggestionChip } from "@/components/SuggestionChip";
import { TaskConfirmationCard } from "@/components/TaskConfirmationCard";
import { colors } from "@/constants/theme";
import { INBOX_QUICK_ACTIONS } from "@/data/aiPrompts";
import { useRtlText } from "@/hooks/useRtlText";
import { useTranslation } from "@/hooks/useTranslation";
import { adviceToText, generateAdvice } from "@/lib/ai/generateAdvice";
import { extractAttachmentText } from "@/lib/ai/media";
import { isImageAttachment, messageAttachments } from "@/lib/chatAttachments";
import { getLanguage, translate } from "@/lib/i18n";
import { posthog } from "@/lib/posthog";
import { getAttachmentSignedUrl, isStoragePath, uploadAttachment } from "@/lib/supabaseStorage";
import { useChatStore } from "@/store/useChatStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTaskStore } from "@/store/useTaskStore";
import type { ChatAttachment, ChatMessage } from "@/types/chat";

const QUICK_ACTION_ICON_SIZE = 18;

// Tall phone shots and wide screenshots are cropped to stay a sensible size in the bubble.
const MIN_IMAGE_RATIO = 3 / 4;
const MAX_IMAGE_RATIO = 16 / 9;

// Each quick-action chip gets its own colored icon, keyed by INBOX_QUICK_ACTIONS id.
const QUICK_ACTION_ICONS: Record<string, ReactNode> = {
  "whats-next": <Feather name="plus" size={QUICK_ACTION_ICON_SIZE} color={colors.quickAction.add} />,
  "breakdown-top": <Feather name="check" size={QUICK_ACTION_ICON_SIZE} color={colors.quickAction.complete} />,
  "quick-win": <Feather name="trash-2" size={QUICK_ACTION_ICON_SIZE} color={colors.quickAction.remove} />,
  "overdue-catchup": <Feather name="refresh-cw" size={QUICK_ACTION_ICON_SIZE} color={colors.quickAction.change} />,
  "break-down": (
    <MaterialCommunityIcons name="format-list-checks" size={QUICK_ACTION_ICON_SIZE} color={colors.quickAction.breakDown} />
  ),
  prioritize: <Feather name="target" size={QUICK_ACTION_ICON_SIZE} color={colors.quickAction.prioritize} />,
};

// Both sides share one bubble shape; the corner nearest the speaker is
// tighter, so it points at them. No avatars and no timestamps: which side a
// bubble sits on says who said it.
const USER_BUBBLE = "rounded-[15px] rounded-br-[6px] bg-charcoal-800 px-[13px] py-[9px]";
const AI_BUBBLE = "card--cream rounded-[15px] rounded-bl-[6px] border px-[13px] py-[9px]";

/** An image the user sent, shown inside their bubble like a regular chat attachment. */
function ChatImage({ attachment }: { attachment: ChatAttachment }) {
  const t = useTranslation();
  // Once the upload lands, the message's uri is swapped for a storage path. This
  // bubble keeps showing the local file it started with instead of downloading it again.
  const [localUri] = useState(isStoragePath(attachment.uri) ? null : attachment.uri);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const storagePath = localUri ? null : attachment.uri;

  useEffect(() => {
    if (!storagePath) return;
    let cancelled = false;
    getAttachmentSignedUrl(storagePath)
      .then((url) => {
        if (!cancelled) setSignedUrl(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [storagePath]);

  if (failed) return null;

  const uri = localUri ?? signedUrl;
  const ratio = attachment.width && attachment.height ? attachment.width / attachment.height : 4 / 3;
  const aspectRatio = Math.min(Math.max(ratio, MIN_IMAGE_RATIO), MAX_IMAGE_RATIO);

  return (
    <>
      {/* Cropped to the bubble here, so a tap opens the whole frame full
          screen — that's the only way to actually read a photo of a page. */}
      <AnimatedPressable
        onPress={() => setViewerOpen(true)}
        disabled={!uri}
        scaleTo={0.98}
        accessibilityRole="imagebutton"
        accessibilityLabel={t.chat.viewPhoto}
        className="overflow-hidden rounded-xl bg-white/10"
        style={{ aspectRatio }}
      >
        {uri ? (
          <Image source={{ uri }} resizeMode="cover" onError={() => setFailed(true)} className="h-full w-full" />
        ) : null}
      </AnimatedPressable>

      {/* Mounted only while open — every message in the thread renders one of
          these, and a Modal each would be expensive. */}
      {viewerOpen && uri ? <ImageViewerModal uri={uri} onClose={() => setViewerOpen(false)} /> : null}
    </>
  );
}

/**
 * A voice note or document the user sent. There's nothing to show for these
 * the way there is for an image, so a small chip stands in — otherwise a
 * message like "summarize this" would look like it was sent with nothing.
 */
function AttachmentChip({ attachment }: { attachment: ChatAttachment }) {
  const t = useTranslation();
  return (
    <View className="flex-row items-center gap-2 self-start rounded-lg bg-white/10 px-2.5 py-1.5">
      <Feather
        name={attachment.kind === "voice" ? "mic" : "paperclip"}
        size={13}
        color={colors.ink.charcoalMuted}
      />
      <Text numberOfLines={1} className="font-grotesk-medium text-xs text-ink-charcoal-muted">
        {attachment.kind === "voice" ? attachment.label : (attachment.name ?? t.chat.documentLabel)}
      </Text>
    </View>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const t = useTranslation();
  const rtl = useRtlText();

  if (message.role === "ai") {
    return (
      <Animated.View entering={FadeInUp.duration(240)} className="items-start">
        <View className={`max-w-[88%] ${AI_BUBBLE}`}>
          {/* The welcome message is app copy, so it follows the current language. */}
          <Text className="text-quote text-ink-cream" style={rtl}>
            {message.id === "welcome" ? t.chat.welcome : message.text}
          </Text>
        </View>
      </Animated.View>
    );
  }

  // Images render as themselves, everything else as a chip. Either way the
  // user's own text is what's shown as text — never a file name.
  const attachments = messageAttachments(message);
  // A photo has no width of its own to size the bubble by, so a bubble
  // carrying one takes a set width; text alone sizes its bubble to fit.
  const hasImage = attachments.some(isImageAttachment);

  return (
    <Animated.View entering={FadeInDown.duration(220)} className="items-end">
      <View className={`${hasImage ? "w-[80%]" : "max-w-[85%]"} gap-2 ${USER_BUBBLE}`}>
        {attachments.map((attachment, index) =>
          isImageAttachment(attachment) ? (
            <ChatImage key={`${attachment.uri}-${index}`} attachment={attachment} />
          ) : (
            <AttachmentChip key={`${attachment.uri}-${index}`} attachment={attachment} />
          ),
        )}
        {message.text ? (
          <Text className="font-grotesk-medium text-[13.5px] leading-[19px] text-ink-charcoal" style={rtl}>
            {message.text}
          </Text>
        ) : null}
      </View>
    </Animated.View>
  );
}

function TypingBubble() {
  const t = useTranslation();

  return (
    <Animated.View entering={FadeInUp.duration(200)} className="items-start">
      <View className={AI_BUBBLE}>
        <Text className="text-quote text-ink-cream-muted">{t.chat.typing}</Text>
      </View>
    </Animated.View>
  );
}

function InboxChatScreen({ contextTaskId, availableMinutes }: { contextTaskId?: string; availableMinutes?: number }) {
  const t = useTranslation();
  const rtl = useRtlText();
  const router = useRouter();
  const { user } = useUser();
  const messages = useChatStore((state) => state.messages);
  const isAiTyping = useChatStore((state) => state.isAiTyping);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const seedMessage = useChatStore((state) => state.seedMessage);
  const pendingActions = useChatStore((state) => state.pendingActions);
  const confirmPendingActions = useChatStore((state) => state.confirmPendingActions);
  const confirmPendingDraft = useChatStore((state) => state.confirmPendingDraft);
  const confirmAllPendingDrafts = useChatStore((state) => state.confirmAllPendingDrafts);
  const dismissPendingDraft = useChatStore((state) => state.dismissPendingDraft);
  const cancelPendingActions = useChatStore((state) => state.cancelPendingActions);
  const updatePendingDraft = useChatStore((state) => state.updatePendingDraft);
  const redirectToNext = useChatStore((state) => state.redirectToNext);
  const clearRedirectToNext = useChatStore((state) => state.clearRedirectToNext);
  const tasks = useTaskStore((state) => state.tasks);

  const pendingCount = tasks.filter((task) => task.status === "pending").length;
  const pendingDraftCount = pendingActions.reduce(
    (count, pending) => count + (pending.action.type === "CREATE_TASK" ? pending.action.drafts.length : 0),
    0,
  );
  const contextTask = contextTaskId ? tasks.find((task) => task.id === contextTaskId) : undefined;

  const [draft, setDraft] = useState("");
  // Photos/documents captured but not sent yet. They sit in the composer so
  // the user can add instructions, attach more, or remove them again —
  // nothing is uploaded or read until Send.
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const aiAutoMode = useSettingsStore((state) => state.aiAutoMode);
  // What this screen has already had the AI read out, as "<taskId>:<minutes>".
  // The time budget is part of the key because advice for "I have 20 minutes"
  // is different advice, but re-running the effect for the same pair (a store
  // callback changing identity, say) must not send a second request or push a
  // second bubble into the thread.
  const analysisSeededFor = useRef(new Set<string>());
  const analysisSeedKey = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!contextTaskId) return;
    const seedKey = `${contextTaskId}:${availableMinutes ?? ""}`;
    if (analysisSeededFor.current.has(seedKey) || analysisSeedKey.current === seedKey) return;
    const task = useTaskStore.getState().tasks.find((candidate) => candidate.id === contextTaskId);
    if (!task) return;

    // Claimed before the request leaves, so a re-run while it is still in
    // flight doesn't start a second one.
    analysisSeedKey.current = seedKey;
    let seeded = false;
    let cancelled = false;
    const release = () => {
      if (analysisSeedKey.current === seedKey) analysisSeedKey.current = null;
    };

    generateAdvice(task, availableMinutes)
      .then((advice) => {
        if (cancelled) return;
        const copy = translate().chat;
        seedMessage(copy.taskRead(task.title, copy.complexity[task.complexity], adviceToText(advice)), task.id);
        seeded = true;
        analysisSeededFor.current.add(seedKey);
        release();
      })
      .catch((error) => {
        // generateAdvice falls back to its own heuristic, so this is only
        // reached by something unexpected — let the next run try again.
        console.warn("[ai-chat] task analysis failed", error);
        release();
      });

    return () => {
      cancelled = true;
      // Nothing was ever said, so the claim goes back and a later run may retry.
      if (!seeded) release();
    };
  }, [contextTaskId, availableMinutes, seedMessage]);

  // Local file:// uris don't survive a reinstall or another device, so files
  // are uploaded before the message is written and synced devices only ever
  // receive storage paths. Failed uploads are left out of the sent message.
  const uploadAttachments = async (
    attachments: ChatAttachment[],
  ): Promise<{ storedAttachments: ChatAttachment[]; failedAttachments: ChatAttachment[] }> => {
    if (!user) return { storedAttachments: [], failedAttachments: attachments };
    const failedAttachments: ChatAttachment[] = [];
    const stored = await Promise.all(
      attachments.map(async (attachment, index) => {
        try {
          const path = await uploadAttachment(
            attachment.uri,
            user.id,
            attachment.name ?? `${attachment.kind}-${Date.now()}-${index}`,
            attachment.mimeType,
          );
          return { ...attachment, uri: path };
        } catch (error) {
          console.warn("[ai-chat] attachment upload failed", error);
          failedAttachments.push(attachment);
          return null;
        }
      }),
    );
    return {
      storedAttachments: stored.filter((attachment): attachment is ChatAttachment => attachment !== null),
      failedAttachments,
    };
  };

  // The one place a message leaves this screen. Clearing the draft and the
  // staged files here is also what stops the same files being sent twice:
  // the send button goes disabled on the very next render.
  const handleSend = async (text: string, attachments: ChatAttachment[]) => {
    if (!text.trim() && attachments.length === 0) return;
    setDraft("");
    setPendingAttachments([]);
    const { storedAttachments, failedAttachments } =
      attachments.length > 0
        ? await uploadAttachments(attachments)
        : { storedAttachments: [], failedAttachments: [] };

    // Nothing reached storage. A message with no text has nothing left to say,
    // and sendMessage would drop it on the floor — so the files go back in the
    // composer with an explanation rather than simply disappearing.
    if (attachments.length > 0 && storedAttachments.length === 0) {
      setPendingAttachments((current) => [...current, ...failedAttachments]);
      setDraft((current) => current || text);
      Alert.alert(t.chat.uploadFailedTitle, t.chat.uploadFailedBody);
      return;
    }
    // Some made it. The message is still worth sending, but the ones that
    // didn't are said out loud instead of quietly missing from it.
    if (storedAttachments.length < attachments.length) {
      setPendingAttachments((current) => [...current, ...failedAttachments]);
      Alert.alert(t.chat.uploadFailedTitle, t.chat.uploadPartialBody(attachments.length - storedAttachments.length));
    }

    // The message carries the storage paths, but the text is read from the
    // files still on this phone — the same ones, in the same order.
    const uploadedLocal = attachments.filter((attachment) => !failedAttachments.includes(attachment));
    sendMessage(text, storedAttachments, contextTaskId, uploadedLocal);
  };

  const handleRemoveAttachment = (index: number) => {
    setPendingAttachments((current) => current.filter((_, i) => i !== index));
  };

  // Quick-action chips (Add, Mark complete, Remove, Change, Break down, Prioritize) don't
  // send on their own — they drop their label into the draft so the user
  // can add the specifics (which task, what deadline) before sending.
  const handleQuickAction = (label: string) => {
    setDraft(`${label}: `);
  };

  const handleOpenNext = () => {
    const minutes = redirectToNext?.minutes;
    clearRedirectToNext();
    router.push({ pathname: "/(tabs)", params: minutes ? { minutes: String(minutes) } : undefined });
  };

  // A batch: the document picker can hand back several files at once.
  const handleAttachment = async (attachments: ChatAttachment[]) => {
    if (attachments.length === 0) return;
    attachments.forEach((attachment) => posthog.capture("inbox_attachment_captured", { kind: attachment.kind }));

    // With auto mode off, a voice note isn't sent — its transcript lands in
    // the input box so the user can check/edit it and send it themselves.
    // Recording only ever produces one file, so this branch is never a batch.
    const [attachment] = attachments;
    if (attachment.kind === "voice" && !aiAutoMode) {
      setIsTranscribing(true);
      try {
        const transcript = await extractAttachmentText(attachment, { language: getLanguage() });
        if (transcript) {
          setDraft((current) => (current.trim() ? `${current.trimEnd()} ${transcript}` : transcript));
        } else {
          Alert.alert(t.chat.couldntCatch, t.chat.attachmentReplies.voice);
        }
      } catch (error) {
        console.warn("[ai-chat] voice transcription failed", error);
        Alert.alert(t.chat.couldntTranscribe, t.chat.attachmentReplies.voice);
      } finally {
        setIsTranscribing(false);
      }
      return;
    }

    // Auto mode on means "don't make me confirm things" — so photos and
    // documents fire straight away, carrying whatever is already typed.
    if (aiAutoMode) {
      handleSend(draft, [...pendingAttachments, ...attachments]);
      return;
    }

    // Auto mode off: stage them in the composer instead. Nothing is read or
    // uploaded until Send, so removing one here costs nothing.
    setPendingAttachments((current) => [...current, ...attachments]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream[100] }} edges={["top"]}>
      <View className="flex-row items-center gap-3 border-b border-cream-300 bg-cream-100 px-6 pb-4 pt-2">
        <GemLogo size={44} />
        <View className="flex-1">
          <Text className="text-card-title text-ink-cream">
            {contextTask ? contextTask.title : t.chat.inboxTitle}
          </Text>
          <Text className="font-grotesk-medium text-sm text-ink-cream-muted">
            {contextTask ? (
              t.chat.contextSubtitle
            ) : (
              <>
                <Text className="font-grotesk-bold text-ink-cream">{pendingCount}</Text>
                {t.chat.activeTasksSuffix}
              </>
            )}
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          contentContainerStyle={{ gap: 16, padding: 24 }}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {messages.map((message) => (
            <ChatBubble key={message.id} message={message} />
          ))}
          {isAiTyping ? <TypingBubble /> : null}

          {pendingActions.length > 0 ? (
            <Animated.View entering={FadeInUp.duration(240)} className="gap-3">
              {/* Plain text, not a message: nothing has been added yet. */}
              {pendingDraftCount > 0 ? (
                <Text className="font-grotesk-medium text-[13.5px] text-ink-cream-muted" style={rtl}>
                  {t.chat.foundTasks(pendingDraftCount)}
                </Text>
              ) : null}
              {pendingActions.flatMap((pending, index) =>
                pending.action.type === "CREATE_TASK"
                  ? pending.action.drafts.map((draft, draftIndex) => {
                      // Every queued draft has one (useChatStore); the fallback is only for the type.
                      const candidateId = draft.candidateId ?? `${index}-${draftIndex}`;
                      return (
                        <TaskConfirmationCard
                          key={candidateId}
                          draft={draft}
                          onAdd={() => void confirmPendingDraft(candidateId)}
                          onDismiss={() => dismissPendingDraft(candidateId)}
                          onChange={(patch) => updatePendingDraft(candidateId, patch)}
                        />
                      );
                    })
                  : [],
              )}
              {pendingDraftCount > 1 ? (
                <AnimatedPressable
                  onPress={() => void confirmAllPendingDrafts()}
                  className="flex-row items-center justify-center gap-2 self-end rounded-full bg-orange-500 px-4 py-2.5"
                >
                  <Feather name="check-circle" size={16} color={colors.cream[50]} />
                  <Text className="font-grotesk-bold text-sm text-cream-50">{t.chat.addAll(pendingDraftCount)}</Text>
                </AnimatedPressable>
              ) : null}
              {pendingActions.some((pending) => pending.action.type !== "CREATE_TASK") ? (
                <View className="flex-row gap-2">
                  <SuggestionChip emoji="✅" label={t.chat.yesDoIt} onPress={confirmPendingActions} />
                  <SuggestionChip emoji="✕" label={t.common.cancel} onPress={cancelPendingActions} />
                </View>
              ) : null}
            </Animated.View>
          ) : null}

          {redirectToNext ? (
            <Animated.View entering={FadeInUp.duration(240)} className="flex-row gap-2 pr-8">
              <SuggestionChip emoji="🎯" label={t.chat.openNext(redirectToNext.minutes)} onPress={handleOpenNext} />
            </Animated.View>
          ) : null}
        </ScrollView>

        <View className="gap-3 border-t border-cream-300 bg-cream-100 px-6 pb-2 pt-3">
          {!contextTask ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
            >
              {INBOX_QUICK_ACTIONS.map((action) => (
                <SuggestionChip
                  key={action.id}
                  emoji={action.emoji}
                  label={t.chat.quickActions[action.id]}
                  icon={QUICK_ACTION_ICONS[action.id]}
                  onPress={() => handleQuickAction(t.chat.quickActions[action.id])}
                />
              ))}
            </ScrollView>
          ) : null}

          <InboxInput
            value={draft}
            onChangeText={setDraft}
            onSend={() => handleSend(draft, pendingAttachments)}
            onAttachment={handleAttachment}
            attachments={pendingAttachments}
            onRemoveAttachment={handleRemoveAttachment}
            isTranscribing={isTranscribing}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export default function AiChat() {
  const { taskId, minutes } = useLocalSearchParams<{ taskId?: string; minutes?: string }>();
  const parsedMinutes = minutes ? Number.parseInt(minutes, 10) : Number.NaN;
  const availableMinutes = Number.isFinite(parsedMinutes) && parsedMinutes > 0 ? parsedMinutes : undefined;
  return <InboxChatScreen contextTaskId={taskId} availableMinutes={availableMinutes} />;
}
