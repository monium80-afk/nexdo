import { Feather } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { BottomSheet } from "@/components/BottomSheet";
import { useColors } from "@/hooks/useTheme";

type FilterOption<T extends string> = { label: string; value: T; count?: number };

type FilterSheetProps<T extends string> = {
  visible: boolean;
  title: string;
  options: FilterOption<T>[];
  selected: T;
  onSelect: (value: T) => void;
  onClose: () => void;
};

export function FilterSheet<T extends string>({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
}: FilterSheetProps<T>) {
  const colors = useColors();
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title} panelClassName="gap-1">
      {options.map((option) => {
        const isSelected = option.value === selected;
        return (
          <AnimatedPressable
            key={option.value}
            onPress={() => {
              onSelect(option.value);
              onClose();
            }}
            className="flex-row items-center justify-between rounded-2xl px-2 py-3.5"
          >
            <Text
              className={
                isSelected
                  ? "font-grotesk-semibold text-base text-orange-500"
                  : "font-grotesk-medium text-base text-ink-cream"
              }
            >
              {option.label}
            </Text>
            <View className="flex-row items-center gap-2.5">
              {option.count !== undefined ? (
                <View className="rounded-xl bg-cream-200 px-2 py-0.5">
                  <Text className="font-grotesk-bold text-xs text-ink-cream-muted">{option.count}</Text>
                </View>
              ) : null}
              {isSelected ? <Feather name="check" size={18} color={colors.orange[500]} /> : null}
            </View>
          </AnimatedPressable>
        );
      })}
    </BottomSheet>
  );
}
