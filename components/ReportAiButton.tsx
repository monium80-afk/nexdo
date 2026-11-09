import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Text } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { SUPPORT_LINKS } from "@/constants/support";
import { MOTION } from "@/constants/theme";
import { useColors } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";

/** As much of the AI's text as the report carries — the feedback field holds 5,000 characters. */
const MAX_REPORTED_LENGTH = 1_500;

/**
 * A quiet "Report" link under something the AI wrote (advice, a breakdown, a
 * reassessment) — Google Play's rules for AI-generated content ask for a way
 * to flag it without leaving the app. Signed in, it opens Send feedback with
 * the text already quoted; signed out (onboarding), the website's form in the
 * in-app browser.
 *
 * `beforeOpen`: for a link inside a sheet (a native modal), which has to close
 * first or the feedback screen opens underneath it.
 */
export function ReportAiButton({
  content,
  onDark = false,
  beforeOpen,
}: {
  /** The AI's text being reported. */
  content: string;
  /** On a charcoal card. */
  onDark?: boolean;
  beforeOpen?: () => void;
}) {
  const { isSignedIn } = useAuth();
  const router = useRouter();
  const t = useTranslation();
  const colors = useColors();

  const open = () => {
    if (!isSignedIn) {
      WebBrowser.openBrowserAsync(SUPPORT_LINKS.feedback).catch((error) =>
        console.warn("[ReportAiButton] couldn't open the feedback form", error),
      );
      return;
    }
    // The ** that mark highlighted words aren't part of what the AI said.
    const report = content.replace(/\*\*/g, "").trim().slice(0, MAX_REPORTED_LENGTH);
    router.push({ pathname: "/feedback", params: { report } });
  };

  const handlePress = () => {
    if (!beforeOpen) {
      open();
      return;
    }
    beforeOpen();
    // Once the sheet has slid away.
    setTimeout(open, MOTION.duration.screen + 50);
  };

  return (
    <AnimatedPressable
      onPress={handlePress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={t.feedback.reportA11y}
      className="flex-row items-center gap-1.5 self-start py-1"
    >
      <Feather name="flag" size={12} color={onDark ? colors.ink.charcoalMuted : colors.ink.creamMuted} />
      <Text className={`font-grotesk-medium text-xs ${onDark ? "text-ink-charcoal-muted" : "text-ink-cream-muted"}`}>
        {t.feedback.reportLabel}
      </Text>
    </AnimatedPressable>
  );
}
