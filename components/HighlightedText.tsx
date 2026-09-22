import { Text } from "react-native";

import { useRtlText } from "@/hooks/useRtlText";

/**
 * Renders text where the AI wrapped key words in **double asterisks** — those
 * parts get `highlightClassName`, the rest `className`.
 *
 * This is always AI prose, so it right-aligns itself in a right-to-left
 * language rather than leaving that to each caller.
 */
export function HighlightedText({
  text,
  className,
  highlightClassName,
}: {
  text: string;
  className: string;
  highlightClassName: string;
}) {
  const rtl = useRtlText();
  // Splitting on a capture group keeps the matches: odd indexes are the highlights.
  const parts = text.split(/\*\*(.+?)\*\*/g);

  return (
    <Text className={className} style={rtl}>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <Text key={index} className={highlightClassName}>
            {part.replace(/\\\*/g, "*")}
          </Text>
        ) : (
          part.replace(/\\\*/g, "*")
        ),
      )}
    </Text>
  );
}
