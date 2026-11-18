import { Feather } from "@expo/vector-icons";
import { Image, Modal, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";

/**
 * A photo on its own, full screen. Images in the chat are cropped to fit
 * their bubble, so this is where you actually read what's in one — it shows
 * the whole frame, uncropped, on black.
 */
export function ImageViewerModal({ uri, onClose }: { uri: string; onClose: () => void }) {
  const colors = useColors();
  const t = useTranslation();

  return (
    <Modal visible transparent={false} animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>
        {/* Tapping the backdrop closes it — the same way the app's other
            sheets behave. */}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t.common.close}
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" }}
        >
          <Image source={{ uri }} resizeMode="contain" className="h-full w-full" />
        </Pressable>

        <View style={{ alignItems: "flex-end", paddingTop: 16, paddingRight: 16 }}>
          <AnimatedPressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t.common.close}
            hitSlop={10}
            className="h-11 w-11 items-center justify-center rounded-full bg-white/15"
          >
            <Feather name="x" size={22} color={colors.onAccent} />
          </AnimatedPressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}
