import { Feather } from "@expo/vector-icons";
import { useRef, useState, type ComponentRef } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, useReducedMotion } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { useAiLocked } from "@/hooks/useAiLocked";
import { useTranslation } from "@/hooks/useTranslation";
import { FOCUS_SOUNDS } from "@/lib/focusSound";
import { openPaywall } from "@/lib/paywall";
import { posthog } from "@/lib/posthog";
import { useSettingsStore } from "@/store/useSettingsStore";
import type { FocusSound } from "@/types/settings";
import { shadow } from "@/constants/shadow";

// The mockup's line icons (Final-Focus.html), 24 × 24.
const SOUND_ICON: Record<FocusSound, string[]> = {
  off: ["M11 5 6 9H3v6h3l5 4z", "M17 9l4 6M21 9l-4 6"],
  rain: ["M7 16a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 8.5 3.5 3.5 0 0 1 17 16", "M9 18l-1 2M13 18l-1 2M17 18l-1 2"],
  brown: ["M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0"],
  waves: ["M3 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0"],
};

function SoundIcon({ sound, size, color }: { sound: FocusSound; size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {SOUND_ICON[sound].map((d) => (
        <Path key={d} d={d} />
      ))}
    </Svg>
  );
}

/**
 * A focus session's sound (Final-Focus.html): a cream pill at the top right
 * — "Rain ⌄" — opening a dark menu of Off and the sounds. It plays while the
 * clock runs (hooks/useFocusSound.ts) and the pick is remembered for the next
 * session. Pro: on Free the sounds wear a padlock and open the plans.
 * (useAiLocked is "Pro features locked" — it isn't AI, but it's the same rule.)
 */
export function FocusSoundPicker() {
  const t = useTranslation();
  const reduceMotion = useReducedMotion();
  const locked = useAiLocked();
  const choice = useSettingsStore((state) => state.focusSound);
  const setChoice = useSettingsStore((state) => state.setFocusSound);
  const options: FocusSound[] = ["off", ...FOCUS_SOUNDS];
  const current: FocusSound = locked ? "off" : choice;

  const pillRef = useRef<ComponentRef<typeof View>>(null);
  const [menu, setMenu] = useState<{ top: number; right: number } | null>(null);

  const open = () => {
    pillRef.current?.measureInWindow((x, y, width, height) => {
      // 48 under the pill's top, its right edge lined up with the pill's (the mockup's top: 48px).
      setMenu({ top: y + height + 8, right: x + width });
    });
  };

  const handlePick = (option: FocusSound) => {
    setMenu(null);
    if (option !== "off" && locked) {
      openPaywall("sounds");
      return;
    }
    if (option !== choice) posthog.capture("focus_sound_picked", { sound: option });
    setChoice(option);
  };

  return (
    <>
      <View ref={pillRef} collapsable={false}>
        <AnimatedPressable
          onPress={open}
          scaleTo={0.96}
          accessibilityRole="button"
          accessibilityLabel={`${t.focusPage.sound}: ${t.focusSound.names[current]}`}
          accessibilityState={{ expanded: menu !== null }}
          // Just the sound's icon — its name would crowd "FOCUS SESSION";
          // the menu has the names (the user's call, 2026-11-04).
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            borderWidth: 1.5,
            borderColor: "#E2D6C8",
            backgroundColor: "#FCF7EF",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <SoundIcon sound={current} size={18} color={current === "off" ? "#7A6E64" : "#F26A2E"} />
        </AnimatedPressable>
      </View>

      <Modal visible={menu !== null} transparent animationType="none" statusBarTranslucent onRequestClose={() => setMenu(null)}>
        <Pressable style={{ flex: 1 }} onPress={() => setMenu(null)} accessibilityLabel={t.common.close}>
          {menu ? (
            <Animated.View
              entering={reduceMotion ? undefined : FadeIn.duration(140)}
              exiting={reduceMotion ? undefined : FadeOut.duration(120)}
              accessibilityRole="menu"
              accessibilityLabel={t.focusSound.label}
              style={{
                position: "absolute",
                top: menu.top,
                left: menu.right - 210,
                width: 210,
                borderRadius: 22,
                backgroundColor: "#221C17",
                padding: 6,
                gap: 2,
                ...shadow("0 18px 36px rgba(34, 28, 23, 0.3)", 12),
              }}
            >
              {options.map((option) => {
                const selected = current === option;
                const padlock = option !== "off" && locked;
                return (
                  <Pressable
                    key={option}
                    onPress={() => handlePick(option)}
                    accessibilityRole="menuitem"
                    accessibilityState={{ selected }}
                    accessibilityLabel={padlock ? `${t.focusSound.names[option]} — ${t.plan.proOnly}` : t.focusSound.names[option]}
                    style={{
                      height: 44,
                      borderRadius: 14,
                      paddingHorizontal: 12,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      backgroundColor: selected ? "rgba(242,106,46,0.18)" : "transparent",
                    }}
                  >
                    <View style={{ opacity: selected ? 1 : 0.75 }}>
                      <SoundIcon sound={option} size={18} color={selected ? "#FFB089" : "#FAF1E4"} />
                    </View>
                    <Text style={{ flex: 1, fontFamily: "SpaceGrotesk-SemiBold", fontSize: 15, color: selected ? "#FFB089" : "#FAF1E4" }}>
                      {t.focusSound.names[option]}
                    </Text>
                    {selected ? (
                      <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#FFB089" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
                        <Path d="M5 12.5l4.5 4.5L19 7.5" />
                      </Svg>
                    ) : padlock ? (
                      <Feather name="lock" size={13} color="#BFB2A7" />
                    ) : null}
                  </Pressable>
                );
              })}
            </Animated.View>
          ) : null}
        </Pressable>
      </Modal>
    </>
  );
}
