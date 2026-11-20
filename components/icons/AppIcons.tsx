import Svg, { Circle, Path, Rect } from "react-native-svg";

/**
 * The 2026-11 redesign's icons, drawn from the mockups' own paths
 * (nexdo-design-handoff/screens) on a 24-unit grid, so they match them
 * exactly — Feather's are close, but not the same shapes.
 */
export type AppIconName = "bolt" | "list" | "calendar" | "sliders" | "mic" | "plus" | "clock" | "flame" | "play" | "check";

export function AppIcon({
  name,
  size = 22,
  color,
  strokeWidth = 1.8,
}: {
  name: AppIconName;
  size?: number;
  color: string;
  /** For the outlined icons; the flame and play are filled. */
  strokeWidth?: number;
}) {
  const stroke = { stroke: color, strokeWidth, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === "bolt" ? <Path d="M13.2 2.8 5.6 13.4h5.6l-1 7.8 7.8-10.9h-5.7z" {...stroke} /> : null}
      {name === "list" ? (
        <>
          <Path d="M9 6h11M9 12h11M9 18h11" {...stroke} />
          <Circle cx={4.5} cy={6} r={1.2} {...stroke} />
          <Circle cx={4.5} cy={12} r={1.2} {...stroke} />
          <Circle cx={4.5} cy={18} r={1.2} {...stroke} />
        </>
      ) : null}
      {name === "calendar" ? (
        <>
          <Rect x={3.5} y={5} width={17} height={15} rx={3.5} {...stroke} />
          <Path d="M3.5 10h17M8 3v4M16 3v4" {...stroke} />
        </>
      ) : null}
      {name === "sliders" ? (
        <>
          <Path d="M4 7h10M18 7h2M4 17h4M12 17h8" {...stroke} />
          <Circle cx={16} cy={7} r={2} {...stroke} />
          <Circle cx={10} cy={17} r={2} {...stroke} />
        </>
      ) : null}
      {name === "mic" ? (
        <>
          <Rect x={9} y={3} width={6} height={11} rx={3} {...stroke} />
          <Path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" {...stroke} />
        </>
      ) : null}
      {name === "plus" ? <Path d="M12 5v14M5 12h14" {...stroke} /> : null}
      {name === "clock" ? (
        <>
          <Circle cx={12} cy={12} r={8.5} {...stroke} />
          <Path d="M12 7.5V12l3 2" {...stroke} />
        </>
      ) : null}
      {name === "check" ? <Path d="M5 12.5l4.5 4.5L19 7.5" {...stroke} /> : null}
      {name === "flame" ? (
        <Path
          d="M12 2.5c1.2 4 6 6.2 6 11.5a6 6 0 0 1-12 0c0-2.9 1.4-4.5 2.9-6 .2 1.9 1 3.1 2.4 3.6 0-3.8-.7-6.7.7-9.1z"
          fill={color}
        />
      ) : null}
      {name === "play" ? (
        <Path d="M7 4.8v14.4a1 1 0 0 0 1.5.9l11.3-7.2a1 1 0 0 0 0-1.8L8.5 3.9A1 1 0 0 0 7 4.8z" fill={color} />
      ) : null}
    </Svg>
  );
}
