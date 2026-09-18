import { useUser } from "@clerk/expo";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Image, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { GemLogo } from "@/components/GemLogo";
import { InboxInput } from "@/components/InboxInput";
import { SuggestionChip } from "@/components/SuggestionChip";
import { TaskConfirmationCard } from "@/components/TaskConfirmationCard";
import { colors } from "@/constants/theme";
import type { ExtractTextRequestBody, ExtractTextResponseBody } from "@/app/api/extract-text+api";
import { INBOX_QUICK_ACTIONS } from "@/data/aiPrompts";
import { useTranslation } from "@/hooks/useTranslation";
import { adviceToText, generateAdvice } from "@/lib/ai/generateAdvice";
import { readFileAsBase64, resolveMimeType } from "@/lib/ai/media";
import { apiPost } from "@/lib/api";
import { translate } from "@/lib/i18n";
import { posthog } from "@/lib/posthog";
import { getAttachmentSignedUrl, isStoragePath, uploadAttachment } from "@/lib/supabaseStorage";
import { useCategoryStore } from "@/store/useCategoryStore";
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

function formatTime(iso: string, locale: string) {
  return new Date(iso).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** The signed-in account's photo, or a person icon when there isn't one. */
function AccountAvatar({ size }: { size: "sm" | "md" }) {
  const { user } = useUser();
  const boxClass = size === "md" ? "h-11 w-11 rounded-full" : "h-8 w-8 rounded-full";

  if (user?.hasImage) {
    return <Image source={{ uri: user.imageUrl }} className={boxClass} />;
  }
  return (
    <View className={`${boxClass} items-center justify-center bg-charcoal-900`}>
      <Feather name="user" size={size === "md" ? 20 : 16} color={colors.ink.charcoal} />
    </View>
  );
}

// A camera photo, or an image file picked with the paperclip.
function isImageAttachment(attachment: ChatAttachment | undefined): attachment is ChatAttachment {
  return attachment?.kind === "photo" || Boolean(attachment?.mimeType?.startsWith("image/"));
}

/** An image the user sent, shown inside their bubble like a regular chat attachment. */
function ChatImage({ attachment }: { attachment: ChatAttachment }) {
  // Once the upload lands, the message's uri is swapped for a storage path. This
  // bubble keeps showing the local file it started with instead of downloading it again.
  const [localUri] = useState(isStoragePath(attachment.uri) ? null : attachment.uri);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
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
    <View className="mb-2.5 overflow-hidden rounded-xl bg-white/10" style={{ aspectRatio }}>
      {uri ? (
        <Image source={{ uri }} resizeMode="cover" onError={() => setFailed(true)} className="h-full w-full" />
      ) : null}
    </View>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const t = useTranslation();

  if (message.role === "ai") {
    return (
      <Animated.View entering={FadeInUp.duration(240)} className="flex-row items-start gap-2.5 pr-1">
        <View className="h-8 w-8 items-center justify-center rounded-full bg-cream-200">
          <GemLogo size={16} />
        </View>
        <View className="card card--cream-elevated flex-1 gap-2.5 p-4">
          {/* The welcome message is app copy, so it follows the current language. */}
          <Text className="text-quote text-ink-cream">{message.id === "welcome" ? t.chat.welcome : message.text}</Text>
          <Text className="self-end font-grotesk-medium text-xs text-ink-cream-muted">
            {formatTime(message.createdAt, t.locale)}
          </Text>
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={FadeInDown.duration(220)} className="flex-row items-center justify-end gap-2 pl-1">
      <View className="flex-1 rounded-2xl bg-charcoal-900 px-4 py-3">
        {isImageAttachment(message.attachment) ? <ChatImage attachment={message.attachment} /> : null}
        <Text className="font-grotesk-medium text-sm text-ink-charcoal">{message.text}</Text>
        <Text className="mt-1 self-end font-grotesk-medium text-xs text-ink-charcoal-muted">
          {formatTime(message.createdAt, t.locale)}
        </Text>
      </View>
      <AccountAvatar size="sm" />
    </Animated.View>
  );
}

function TypingBubble() {
  const t = useTranslation();

  return (
    <Animated.View entering={FadeInUp.duration(200)} className="flex-row items-center gap-2.5 pr-1">
      <View className="h-8 w-8 items-center justify-center rounded-full bg-cream-200">
        <GemLogo size={16} />
      </View>
      <View className="card card--cream-elevated px-4 py-3.5">
        <Text className="text-quote text-ink-cream-muted">{t.chat.typing}</Text>
      </View>
    </Animated.View>
  );
}

function InboxChatScreen({ contextTaskId, availableMinutes }: { contextTaskId?: string; mode?: string; availableMinutes?: number }) {
  const t = useTranslation();
  const router = useRouter();
  const { user } = useUser();
  const messages = useChatStore((state) => state.messages);
  const isAiTyping = useChatStore((state) => state.isAiTyping);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const seedMessage = useChatStore((state) => state.seedMessage);
  const updateMessageAttachment = useChatStore((state) => state.updateMessageAttachment);
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
  const [isTranscribing, setIsTranscribing] = useState(false);
  const aiAutoMode = useSettingsStore((state) => state.aiAutoMode);
  const analysisSeededFor = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!contextTaskId || analysisSeededFor.current === contextTaskId) return;
    const task = useTaskStore.getState().tasks.find((candidate) => candidate.id === contextTaskId);
    if (!task) return;
    let cancelled = false;
    generateAdvice(task, useCategoryStore.getState().categories, availableMinutes).then((advice) => {
      if (cancelled) return;
      const copy = translate().chat;
      seedMessage(copy.taskRead(task.title, copy.complexity[task.complexity], adviceToText(advice)), task.id);
    });
    return () => {
      cancelled = true;
      if (analysisSeededFor.current === contextTaskId) analysisSeededFor.current = null;
    };
  }, [contextTaskId, availableMinutes, seedMessage]);

  const handleSend = (text: string, attachment?: ChatAttachment) => {
    if (!text.trim()) return;
    sendMessage(text, attachment, contextTaskId);
    setDraft("");
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

  const handleAttachment = async (attachment: ChatAttachment) => {
    posthog.capture("inbox_attachment_captured", { kind: attachment.kind });

    // With auto mode off, a voice note isn't sent — its transcript lands in
    // the input box so the user can check/edit it and send it themselves.
    if (attachment.kind === "voice" && !aiAutoMode) {
      setIsTranscribing(true);
      try {
        const base64 = await readFileAsBase64(attachment.uri);
        const request: ExtractTextRequestBody = {
          mimeType: resolveMimeType(attachment),
          base64,
          kind: attachment.kind,
        };
        const { text } = await apiPost<ExtractTextResponseBody>("/api/extract-text", request);
        const transcript = text.trim();
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

    const messageId = sendMessage(attachment.label, attachment, contextTaskId);

    // Local file:// uris don't survive a reinstall or another device — push
    // the file to Supabase Storage in the background and swap the message's
    // attachment over to the storage path once it lands.
    if (!user || !messageId) return;
    try {
      const path = await uploadAttachment(
        attachment.uri,
        user.id,
        attachment.name ?? `${attachment.kind}-${Date.now()}`,
        attachment.mimeType,
      );
      updateMessageAttachment(messageId, { ...attachment, uri: path });
    } catch (error) {
      console.warn("[ai-chat] attachment upload failed", error);
    }
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
            <Animated.View entering={FadeInUp.duration(240)} className="flex-row items-start gap-2.5 pr-1">
              {/* Mirrors the avatar column in ChatBubble so this card's left
                  edge lands exactly where the AI bubbles' do. */}
              <View className="h-8 w-8" />
              <View className="flex-1 gap-3">
                {pendingActions.flatMap((pending, index) =>
                  pending.action.type === "CREATE_TASK"
                    ? pending.action.drafts.map((draft, draftIndex) => (
                        <TaskConfirmationCard
                          key={`${index}-${draftIndex}`}
                          draft={draft}
                          onAdd={() => confirmPendingDraft(index, draftIndex)}
                          onDismiss={() => dismissPendingDraft(index, draftIndex)}
                          onChange={(patch) => updatePendingDraft(index, draftIndex, patch)}
                        />
                      ))
                    : [],
                )}
                {pendingDraftCount > 1 ? (
                  <AnimatedPressable
                    onPress={confirmAllPendingDrafts}
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
              </View>
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
            onSend={() => handleSend(draft)}
            onAttachment={handleAttachment}
            isTranscribing={isTranscribing}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export default function AiChat() {
  const { taskId, mode, minutes } = useLocalSearchParams<{ taskId?: string; mode?: string; minutes?: string }>();
  const availableMinutes = minutes ? Number.parseInt(minutes, 10) : undefined;
  return <InboxChatScreen contextTaskId={taskId} mode={mode} availableMinutes={availableMinutes} />;
}
