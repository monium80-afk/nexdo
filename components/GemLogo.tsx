import Svg, { ClipPath, Defs, Rect } from "react-native-svg";

import { useColors } from "@/hooks/useTheme";

type GemLogoProps = {
  size?: number;
  onDark?: boolean;
};

const SQUARE = 48;
const CORNER_RADIUS = 14;
const CENTER = 50;

export function GemLogo({ size = 40, onDark = false }: GemLogoProps) {
  const colors = useColors();
  const half = SQUARE / 2;

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <ClipPath id="gemClip">
          <Rect
            x={CENTER - half}
            y={CENTER - half}
            width={SQUARE}
            height={SQUARE}
            rx={CORNER_RADIUS}
            transform={`rotate(45 ${CENTER} ${CENTER})`}
          />
        </ClipPath>
      </Defs>
      <Rect
        x={0}
        y={0}
        width={CENTER}
        height={100}
        fill={onDark ? "#FFFFFF" : colors.logoInk}
        clipPath="url(#gemClip)"
      />
      <Rect
        x={CENTER}
        y={0}
        width={CENTER}
        height={100}
        fill={colors.orange[500]}
        clipPath="url(#gemClip)"
      />
    </Svg>
  );
}
