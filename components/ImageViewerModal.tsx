import { Feather } from "@expo/vector-icons";
import { Image, Modal, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/useTranslation";

/**
 * A photo on its own, full screen. Images in the chat are cropped to fit
 * their bubble, so this is where you actually read what's in one — it shows
 * the whole frame, uncropped, on black.
 */
export function ImageViewerModal({ uri, onClose }: { uri: string; onClose: () => void }) {
  const t = useTranslation();

  return (
    <Modal visible transparent={false} animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>
        {/* Tapping the backdrop closes it — the same way the app's other
            sheets behave. */}
        <Pressable className="flex-1 items-center justify-center" onPress={onClose}>
          <Image source={{ uri }} resizeMode="contain" className="h-full w-full" />
        </Pressable>

        <View className="absolute right-4 top-4">
          <AnimatedPressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t.common.close}
            hitSlop={10}
            className="h-11 w-11 items-center justify-center rounded-full bg-white/15"
          >
            <Feather name="x" size={22} color={colors.cream[50]} />
          </AnimatedPressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}
