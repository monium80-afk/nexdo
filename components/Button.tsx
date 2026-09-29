import { Feather } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { Text } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { colors } from "@/constants/theme";

export type FeatherIconName = ComponentProps<typeof Feather>["name"];

/**
 * The app's buttons, all taken from the Tasks page. "md" is the Tasks
 * header's Add Task pill exactly; "lg" is the same recipe grown to a 44dp
 * touch target, for the one full-width action at the foot of a screen or
 * sheet. Class strings are written out in full so Tailwind can see them.
 */
const SIZES = {
  md: { box: "h-[39px] gap-2", withIcon: "pl-3.5 pr-4", plain: "px-4", text: "text-[13.5px]", icon: 14 },
  lg: { box: "h-[44px] gap-2", withIcon: "px-5", plain: "px-5", text: "text-base", icon: 16 },
} as const;

type ButtonProps = {
  label: string;
  onPress: () => void;
  icon?: FeatherIconName;
  size?: keyof typeof SIZES;
  disabled?: boolean;
  /** Layout from the caller — flex-1, self-start, a top margin. */
  className?: string;
};

/** The orange pill: the one action a screen is for. */
export function PrimaryButton({ label, onPress, icon, size = "md", disabled = false, className = "" }: ButtonProps) {
  const s = SIZES[size];
  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      className={`${s.box} flex-row items-center justify-center rounded-full bg-orange-500 ${icon ? s.withIcon : s.plain} ${disabled ? "opacity-40" : ""} ${className}`}
    >
      {icon ? <Feather name={icon} size={s.icon} color={colors.onAccent} /> : null}
      <Text numberOfLines={1} className={`font-grotesk-bold ${s.text} text-on-accent`}>
        {label}
      </Text>
    </AnimatedPressable>
  );
}

/** Same shape as PrimaryButton, in the idle chip's colours — for a second, lesser action. */
export function SecondaryButton({ label, onPress, icon, size = "md", disabled = false, className = "" }: ButtonProps) {
  const s = SIZES[size];
  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      className={`${s.box} flex-row items-center justify-center rounded-full border border-cream-200 bg-cream-50 ${icon ? s.withIcon : s.plain} ${disabled ? "opacity-40" : ""} ${className}`}
    >
      {icon ? <Feather name={icon} size={s.icon} color={colors.ink.creamMuted} /> : null}
      <Text numberOfLines={1} className={`font-grotesk-semibold ${s.text} text-ink-cream`}>
        {label}
      </Text>
    </AnimatedPressable>
  );
}

const TEXT_TONES = {
  muted: { text: "text-ink-cream-muted", icon: colors.ink.creamMuted },
  accent: { text: "text-orange-600", icon: colors.orange[600] },
  destructive: { text: "text-overdue-500", icon: colors.overdue[500] },
} as const;

/** A label with no button chrome: Cancel, a section's "Change" link, Delete. */
export function TextButton({
  label,
  onPress,
  icon,
  tone = "muted",
  disabled = false,
  className = "",
}: Omit<ButtonProps, "size"> & { tone?: keyof typeof TEXT_TONES }) {
  const toneStyle = TEXT_TONES[tone];
  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      className={`flex-row items-center gap-1.5 ${disabled ? "opacity-40" : ""} ${className}`}
    >
      {icon ? <Feather name={icon} size={15} color={toneStyle.icon} /> : null}
      <Text className={`font-grotesk-semibold text-sm ${toneStyle.text}`}>{label}</Text>
    </AnimatedPressable>
  );
}

// header: the Tasks header's round search button, on charcoal.
// primary: the same circle in orange, for "add this" beside a field.
// ghost: a bare icon for a row's own actions (edit, delete).
const ICON_BUTTONS = {
  header: { box: "h-[39px] w-[39px] rounded-full bg-charcoal-800", icon: 17, color: colors.ink.charcoal, hitSlop: 6 },
  primary: { box: "h-[44px] w-[44px] rounded-full bg-orange-500", icon: 18, color: colors.onAccent, hitSlop: 4 },
  ghost: { box: "h-9 w-9", icon: 15, color: colors.ink.creamMuted, hitSlop: 4 },
} as const;

export function IconButton({
  icon,
  onPress,
  variant = "ghost",
  disabled = false,
  accessibilityLabel,
}: {
  icon: FeatherIconName;
  onPress: () => void;
  variant?: keyof typeof ICON_BUTTONS;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const style = ICON_BUTTONS[variant];
  // A primary button with nothing to add yet sinks into the page instead of
  // just fading, so it doesn't read as an orange button that's broken.
  const idle = variant === "primary" && disabled;
  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={style.hitSlop}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      className={`items-center justify-center ${idle ? "h-[44px] w-[44px] rounded-full bg-cream-200" : style.box}`}
    >
      <Feather name={icon} size={style.icon} color={idle ? colors.ink.creamSubtle : style.color} />
    </AnimatedPressable>
  );
}
