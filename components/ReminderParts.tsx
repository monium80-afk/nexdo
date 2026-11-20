import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { DetailCard } from "@/components/addSheet/AddSheetDetails";
import { DetailHeader, SheetIcon } from "@/components/addSheet/SheetParts";
import { usePalette } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import type { Translations } from "@/lib/i18n";
import { REMINDER_LEAD_OPTIONS, type ReminderMode } from "@/lib/taskReminder";

// The reminder pieces shared by Settings → Notifications and a task's
// "Remind me" sheet (2026-11-18, from the user's Claude Design screenshots).

const TIGHT = { includeFontPadding: false } as const;

/** "At the start", "15 min before", "1 day before" — a lead in words. */
export function leadText(lead: number, t: Translations): string {
  if (lead === 0) return t.redesign.leadAtStart;
  const short = (REMINDER_LEAD_OPTIONS as readonly number[]).includes(lead) ? t.redesign.leadShort(lead) : t.notifications.offsetLabel(lead);
  return t.redesign.leadBefore(short);
}

/** A task's reminder in a few words: "At the start", "Alarm · 15 min before", "Off". */
export function reminderSummary(mode: ReminderMode, lead: number, t: Translations): string {
  if (mode === "off") return t.reminderUi.off;
  return mode === "alarm" ? `${t.reminderUi.alarm} · ${leadText(lead, t)}` : leadText(lead, t);
}

/** The small sign after a task's name on its card: a bell for a notification, an alarm clock for an alarm. */
export function ReminderIcon({ kind, size = 14, color }: { kind: "notify" | "alarm"; size?: number; color: string }) {
  return kind === "alarm" ? (
    <MaterialCommunityIcons name="alarm" size={size + 1} color={color} />
  ) : (
    <Feather name="bell" size={size} color={color} />
  );
}

/**
 * "How long before" as a row of stops on a line: the line and dots orange up
 * to the chosen stop, which wears a halo; its label in bold. Each stop is a
 * tap target. A lead that isn't one of the stops (said to Magic mic, "10
 * minutes before") lights the line up to it, with no stop picked.
 */
export function LeadSlider({ value, onChange }: { value: number; onChange: (minutes: number) => void }) {
  const P = usePalette();
  const t = useTranslation();
  const [width, setWidth] = useState(0);
  const options = REMINDER_LEAD_OPTIONS as readonly number[];
  const exact = options.indexOf(value);
  const reachedIndex = exact >= 0 ? exact : Math.max(0, options.filter((option) => option <= value).length - 1);
  const column = options.length > 0 ? width / options.length : 0;
  const DOT_ROW = 26;
  return (
    <View accessibilityRole="radiogroup" onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 ? (
        <View pointerEvents="none" style={{ position: "absolute", top: DOT_ROW / 2 - 1.5, left: column / 2, right: column / 2, height: 3, borderRadius: 1.5, backgroundColor: P.track }}>
          <View style={{ width: column * reachedIndex, height: 3, borderRadius: 1.5, backgroundColor: P.accent }} />
        </View>
      ) : null}
      <View style={{ flexDirection: "row" }}>
        {options.map((minutes, index) => {
          const selected = index === exact;
          const reached = index <= reachedIndex;
          return (
            <Pressable
              key={minutes}
              onPress={() => onChange(minutes)}
              hitSlop={{ top: 8, bottom: 8 }}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={t.redesign.leadStop(minutes)}
              style={{ flex: 1, alignItems: "center" }}
            >
              <View style={{ height: DOT_ROW, alignItems: "center", justifyContent: "center" }}>
                {selected ? (
                  <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(242,106,46,0.22)", alignItems: "center", justifyContent: "center" }}>
                    <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: P.accent }} />
                  </View>
                ) : (
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: reached ? P.accent : P.dot }} />
                )}
              </View>
              <Text
                numberOfLines={1}
                style={[{ marginTop: 8, fontFamily: selected ? "SpaceGrotesk-Bold" : "SpaceGrotesk-Medium", fontSize: 12.5, color: selected ? P.ink : P.inkMuted }, TIGHT]}
              >
                {t.redesign.leadStop(minutes)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** One choice in the sheet: icon, name and line, and its round check. */
function ModeRow({
  icon,
  title,
  hint,
  picked,
  disabled = false,
  badge,
  onPress,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  picked: boolean;
  disabled?: boolean;
  badge?: string;
  onPress: () => void;
}) {
  const P = usePalette();
  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      scaleTo={0.98}
      accessibilityRole="radio"
      accessibilityState={{ selected: picked, disabled }}
      accessibilityLabel={`${title}. ${hint}`}
      style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderRadius: 16, backgroundColor: picked ? P.peach : P.tile, opacity: disabled ? 0.5 : 1 }}
    >
      <View style={{ width: 36, alignItems: "center" }}>{icon}</View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 16, color: P.ink }}>{title}</Text>
          {badge ? (
            <View style={{ height: 18, paddingHorizontal: 6, borderRadius: 9, backgroundColor: P.ink, flexDirection: "row", alignItems: "center", gap: 3 }}>
              <Feather name="lock" size={9} color={P.inverse} />
              <Text style={[{ fontFamily: "SpaceGrotesk-Bold", fontSize: 10, letterSpacing: 0.6, color: P.inverse }, TIGHT]}>{badge}</Text>
            </View>
          ) : null}
        </View>
        <Text style={{ fontFamily: "SpaceGrotesk-Regular", fontSize: 13, color: P.inkMuted }}>{hint}</Text>
      </View>
      {picked ? (
        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: P.accent, alignItems: "center", justifyContent: "center" }}>
          <SheetIcon name="check" size={13} color="#FFFFFF" strokeWidth={3} />
        </View>
      ) : (
        <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: P.ring }} />
      )}
    </AnimatedPressable>
  );
}

/**
 * A task's "Remind me" sheet: Notification, Alarm (Pro) or Off, then — for a
 * task with a time — how long before. It opens on the Settings default; a
 * change here is only this task's. A task without a time can't have its own
 * reminder: it's in the morning summary, as the note says.
 */
export function ReminderDetail({
  mode,
  lead,
  customLead,
  hasTime,
  startsAt,
  alarmLocked,
  onChangeMode,
  onChangeLead,
  onUseDefault,
  onUnlockAlarm,
  onBack,
}: {
  mode: ReminderMode;
  /** The lead in effect: the task's own, or the default. */
  lead: number;
  /** Whether the task has its own lead (so "Use my default" makes sense). */
  customLead: boolean;
  hasTime: boolean;
  /** When the task starts (ms), to show the reminder's own time. */
  startsAt: number | null;
  alarmLocked: boolean;
  onChangeMode: (mode: ReminderMode) => void;
  onChangeLead: (minutes: number) => void;
  onUseDefault: () => void;
  onUnlockAlarm: () => void;
  onBack: () => void;
}) {
  const P = usePalette();
  const t = useTranslation();
  const ringsAt =
    startsAt !== null ? new Date(startsAt - lead * 60_000).toLocaleTimeString(t.locale, { hour: "numeric", minute: "2-digit" }) : null;
  const whenValue = ringsAt ? `${lead === 0 ? t.redesign.leadAtStart : leadText(lead, t)} · ${ringsAt}` : leadText(lead, t);

  return (
    <DetailCard>
      <DetailHeader title={t.reminderUi.remindMe} onBack={onBack} onDone={onBack} />
      <View style={{ gap: 8 }}>
        <ModeRow
          icon={<Feather name="bell" size={22} color={P.accent} />}
          title={t.reminderUi.notification}
          hint={hasTime ? t.reminderUi.notificationHint : t.reminderUi.inSummary}
          picked={mode === "notify"}
          onPress={() => onChangeMode("notify")}
        />
        <ModeRow
          icon={<MaterialCommunityIcons name="alarm" size={24} color={P.accent} />}
          title={t.reminderUi.alarm}
          hint={t.reminderUi.alarmHint}
          picked={mode === "alarm"}
          disabled={!hasTime}
          badge={alarmLocked ? t.reminderUi.pro : undefined}
          onPress={() => (alarmLocked ? onUnlockAlarm() : onChangeMode("alarm"))}
        />
        <ModeRow
          icon={<Feather name="bell-off" size={22} color={P.accent} />}
          title={t.reminderUi.off}
          hint={t.reminderUi.offHint}
          picked={mode === "off"}
          onPress={() => onChangeMode("off")}
        />
      </View>

      {!hasTime ? (
        <Text style={{ marginHorizontal: 2, fontFamily: "SpaceGrotesk-Regular", fontSize: 13, lineHeight: 18, color: P.inkMuted }}>{t.reminderUi.dateOnlyNote}</Text>
      ) : mode !== "off" ? (
        <>
          <View style={{ marginTop: 4, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 2 }}>
            <Text style={[{ fontFamily: "SpaceGrotesk-Bold", fontSize: 16, color: P.ink }, TIGHT]}>{t.reminderUi.when}</Text>
            <Text numberOfLines={1} style={[{ flexShrink: 1, fontFamily: "SpaceGrotesk-Bold", fontSize: 14.5, color: P.accentInk }, TIGHT]}>
              {whenValue}
            </Text>
          </View>
          <LeadSlider value={lead} onChange={onChangeLead} />
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, marginHorizontal: 2 }}>
            <Text style={{ flex: 1, fontFamily: "SpaceGrotesk-Regular", fontSize: 13, lineHeight: 18, color: P.inkMuted }}>{t.reminderUi.defaultNote}</Text>
            {customLead ? (
              <AnimatedPressable onPress={onUseDefault} scaleTo={0.95} hitSlop={6} accessibilityRole="button">
                <Text style={{ fontFamily: "SpaceGrotesk-SemiBold", fontSize: 13, lineHeight: 18, color: P.accentInk }}>{t.reminderUi.useDefault}</Text>
              </AnimatedPressable>
            ) : null}
          </View>
        </>
      ) : null}
    </DetailCard>
  );
}
