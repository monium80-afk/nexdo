import type { ReactNode } from "react";
import { View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";

import { colors } from "@/constants/theme";

type TimerRingProps = {
  /** 0–1 of the session used up. The ring shows what's left, draining clockwise from 12 o'clock. */
  progress: number;
  /** Past the planned length: the ring is spent, so it shows as a faint red circle instead. */
  overtime?: boolean;
  size?: number;
  stroke?: number;
  /** Drawn in the middle — the clock. */
  children?: ReactNode;
};

/**
 * The focus session's clock face: a glowing orange ring of the time left,
 * with a knob riding its leading end.
 */
export function TimerRing({ progress, overtime = false, size = 188, stroke = 10, children }: TimerRingProps) {
  // Room around the ring for the knob, which is wider than the stroke.
  const knob = stroke * 0.95;
  const radius = size / 2 - knob;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const used = Math.min(Math.max(progress, 0), 1);
  const angle = used * 2 * Math.PI;
  const knobX = center + radius * Math.sin(angle);
  const knobY = center - radius * Math.cos(angle);

  return (
    <View style={{ width: size, height: size }} className="items-center justify-center">
      {/* A halo of warm light around the ring. */}
      <View
        pointerEvents="none"
        className="absolute rounded-full"
        style={{
          width: radius * 2,
          height: radius * 2,
          boxShadow: overtime ? "0 0 28px rgba(240, 149, 126, 0.15)" : "0 0 30px rgba(242, 101, 42, 0.2)",
        }}
      />
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Defs>
          <LinearGradient id="timerArc" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FFA766" />
            <Stop offset="0.55" stopColor={colors.orange[500]} />
            <Stop offset="1" stopColor="#E0421C" />
          </LinearGradient>
        </Defs>
        <Circle cx={center} cy={center} r={radius} stroke="rgba(255, 255, 255, 0.08)" strokeWidth={stroke} fill="none" />
        {overtime ? (
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={colors.overdue[300]}
            strokeOpacity={0.55}
            strokeWidth={stroke}
            fill="none"
          />
        ) : (
          // Starts at 12 o'clock (rotated from SVG's 3 o'clock) and runs from
          // the knob clockwise round to the top: the time still left.
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke="url(#timerArc)"
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${circumference * (1 - used)} ${circumference}`}
            strokeDashoffset={-circumference * used}
            transform={`rotate(-90 ${center} ${center})`}
          />
        )}
        <Circle cx={knobX} cy={knobY} r={knob} fill="#FFF6EE" />
        <Circle cx={knobX} cy={knobY} r={knob * 0.45} fill={overtime ? colors.overdue[300] : colors.orange[500]} />
      </Svg>
      {children}
    </View>
  );
}
