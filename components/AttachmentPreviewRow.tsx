import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { Image, ScrollView, Text, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { ImageViewerModal } from "@/components/ImageViewerModal";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { isImageAttachment } from "@/lib/chatAttachments";
import type { ChatAttachment } from "@/types/chat";

// What's staged in the composer but not sent yet. An image shows as itself —
// never its file name — so the user sees what the AI is about to read.
const TILE = 64;

type AttachmentPreviewRowProps = {
  attachments: ChatAttachment[];
  onRemove: (index: number) => void;
};

function RemoveButton({ onPress, inset }: { onPress: () => void; inset: boolean }) {
  const colors = useColors();
  const t = useTranslation();
  return (
    <AnimatedPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t.chat.removeAttachment}
      hitSlop={8}
      // Absolute over the thumbnail so it never shrinks the image; inline for
      // a chip, where there's a row to sit in.
      style={inset ? { position: "absolute", top: 4, right: 4 } : undefined}
      className="h-6 w-6 items-center justify-center rounded-full bg-charcoal-900/80"
    >
      <Feather name="x" size={13} color={colors.onAccent} />
    </AnimatedPressable>
  );
}

export function AttachmentPreviewRow({ attachments, onRemove }: AttachmentPreviewRowProps) {
  const colors = useColors();
  const t = useTranslation();
  // The photo being looked at full screen, if any — a thumbnail this small
  // shows little more than "there's a picture here".
  const [viewedUri, setViewedUri] = useState<string | null>(null);
  if (attachments.length === 0) return null;

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: 8, paddingHorizontal: 10, paddingTop: 10 }}
      >
        {attachments.map((attachment, index) =>
          isImageAttachment(attachment) ? (
            <View key={`${attachment.uri}-${index}`} style={{ width: TILE, height: TILE }}>
              <AnimatedPressable
                onPress={() => setViewedUri(attachment.uri)}
                scaleTo={0.94}
                accessibilityRole="imagebutton"
                accessibilityLabel={t.chat.viewPhoto}
              >
                <Image
                  source={{ uri: attachment.uri }}
                  resizeMode="cover"
                  accessibilityLabel={t.chat.photoLabel}
                  style={{ width: TILE, height: TILE }}
                  className="rounded-xl bg-cream-200"
                />
              </AnimatedPressable>
              <RemoveButton onPress={() => onRemove(index)} inset />
            </View>
          ) : (
            <View
              key={`${attachment.uri}-${index}`}
              style={{ height: TILE }}
              className="flex-row items-center gap-2 rounded-xl bg-cream-200 pl-3 pr-2"
            >
              <Feather
                name={attachment.kind === "voice" ? "mic" : "paperclip"}
                size={16}
                color={colors.ink.creamMuted}
              />
              <Text numberOfLines={1} style={{ maxWidth: 140 }} className="font-grotesk-medium text-xs text-ink-cream">
                {attachment.kind === "voice" ? attachment.label : (attachment.name ?? t.chat.documentLabel)}
              </Text>
              <RemoveButton onPress={() => onRemove(index)} inset={false} />
            </View>
          ),
        )}
      </ScrollView>

      {viewedUri ? <ImageViewerModal uri={viewedUri} onClose={() => setViewedUri(null)} /> : null}
    </>
  );
}
