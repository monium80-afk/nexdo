import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Platform, ScrollView, Text, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import {
  DetailHeader,
  Diamonds,
  Segmented,
  SheetIcon,
  Toggle,
  Wheel,
  WheelFrame,
  WheelUnit,
  type SheetIconName,
} from "@/components/addSheet/SheetParts";
import { dayPeriods, formatTime, shortDay, uses24HourClock } from "@/components/addSheet/sheetFormat";
import { NO_DURATION } from "@/components/TaskFormFields";
import { colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/useTranslation";
import type { DeadlineInput } from "@/lib/deadline";
import { makeDeadline } from "@/lib/deadline";
import { addDaysToKey, addMonthsToKey, keyParts, keyToLocalDate, pad, toLocalDateKey, type LocalDate } from "@/lib/localDate";
import { buildRule, describeRule, weekdayName, weekdayOf, type RuleInput } from "@/lib/recurrence";
import type { RecurrenceFrequency, TaskPriorityLevel, Weekday } from "@/types/task";
import { shadow, SOFT_SHADOW } from "@/constants/shadow";

const P = colors.palette;
const CARD_SHADOW = SOFT_SHADOW;

/** The card a detail's own screen sits in. */
export function DetailCard({ children }: { children: ReactNode }) {
  return (
    <View
      style={[
        { borderRadius: 22, backgroundColor: P.paperCard, paddingTop: 12, paddingHorizontal: 14, paddingBottom: 16, gap: 14 },
        CARD_SHADOW,
      ]}
    >
      {children}
    </View>
  );
}

export type DetailKey = "date" | "duration" | "repeat" | "priority";

/** Date · Duration · Repeat · Priority, each with its value and a ›. */
export function DetailsList({ rows, onOpen }: { rows: { key: DetailKey; icon: SheetIconName; label: string; value: string }[]; onOpen: (key: DetailKey) => void }) {
  return (
    <View style={[{ borderRadius: 18, backgroundColor: P.paperCard, overflow: "hidden" }, CARD_SHADOW]}>
      {rows.map((row, index) => (
        <Fragment key={row.key}>
          {index > 0 ? <View style={{ height: 1, backgroundColor: P.chip, marginHorizontal: 16 }} /> : null}
          <AnimatedPressable
            onPress={() => onOpen(row.key)}
            scaleTo={0.99}
            accessibilityRole="button"
            accessibilityLabel={`${row.label}, ${row.value}`}
            style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 15, paddingHorizontal: 16 }}
          >
            <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: P.peach, alignItems: "center", justifyContent: "center" }}>
              <SheetIcon name={row.icon} size={17} color={P.accentInk} />
            </View>
            <Text style={{ flex: 1, fontFamily: "SpaceGrotesk-SemiBold", fontSize: 16, color: P.ink }}>{row.label}</Text>
            <Text numberOfLines={1} style={{ flexShrink: 1, maxWidth: "50%", fontFamily: "SpaceGrotesk-SemiBold", fontSize: 15, color: P.inkMuted }}>
              {row.value}
            </Text>
            <SheetIcon name="chevronRight" size={18} color={P.inkFaint} />
          </AnimatedPressable>
        </Fragment>
      ))}
    </View>
  );
}

// ─── Time ─────────────────────────────────────────────────────────────────

const MINUTE_STEPS = Array.from({ length: 12 }, (_, index) => index * 5);

/** A time of day on wheels: hour, minutes (5 at a time) and AM/PM — or 24-hour where that's the custom. */
function TimeWheel({ time, onChange }: { time: string; onChange: (time: string) => void }) {
  const t = useTranslation();
  const twentyFour = useMemo(() => uses24HourClock(t.locale), [t.locale]);
  const periods = useMemo(() => dayPeriods(t.locale), [t.locale]);
  const [hour, minute] = time.split(":").map(Number);
  const minuteIndex = Math.min(11, Math.round(minute / 5));
  const set = (h: number, m: number) => onChange(`${pad(h)}:${pad(m)}`);

  if (twentyFour) {
    return (
      <WheelFrame>
        <Wheel
          items={Array.from({ length: 24 }, (_, index) => pad(index))}
          index={hour}
          onChange={(index) => set(index, MINUTE_STEPS[minuteIndex])}
          width={60}
          accessibilityLabel={t.addSheet.hoursShort}
        />
        <Wheel
          items={MINUTE_STEPS.map(pad)}
          index={minuteIndex}
          onChange={(index) => set(hour, MINUTE_STEPS[index])}
          width={60}
          accessibilityLabel={t.addSheet.minutesShort}
        />
      </WheelFrame>
    );
  }
  const pm = hour >= 12;
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return (
    <WheelFrame>
      <Wheel
        items={Array.from({ length: 12 }, (_, index) => String(index + 1))}
        index={twelve - 1}
        onChange={(index) => set(((index + 1) % 12) + (pm ? 12 : 0), MINUTE_STEPS[minuteIndex])}
        width={52}
        accessibilityLabel={t.addSheet.hoursShort}
      />
      <Wheel
        items={MINUTE_STEPS.map(pad)}
        index={minuteIndex}
        onChange={(index) => set(hour, MINUTE_STEPS[index])}
        width={52}
        accessibilityLabel={t.addSheet.minutesShort}
      />
      <Wheel
        items={periods}
        index={pm ? 1 : 0}
        onChange={(index) => set((hour % 12) + (index === 1 ? 12 : 0), minute)}
        width={56}
        accessibilityLabel={`${periods[0]} / ${periods[1]}`}
      />
    </WheelFrame>
  );
}

/** A calendar for a day further out: the system's own (a dialog on Android, inline on iOS). */
function DayCalendar({ value, minimum, onPick, onClose }: { value: LocalDate; minimum: LocalDate; onPick: (date: LocalDate) => void; onClose: () => void }) {
  // A day picked closes it (the inline iOS calendar picks on a tap), and so does Cancel.
  const handle = (event: DateTimePickerEvent, picked?: Date) => {
    if (event.type === "set" && picked) onPick(toLocalDateKey(picked));
    onClose();
  };
  return (
    <DateTimePicker
      value={keyToLocalDate(value)}
      minimumDate={keyToLocalDate(minimum)}
      mode="date"
      display={Platform.OS === "ios" ? "inline" : "default"}
      accentColor={P.accent}
      onChange={handle}
    />
  );
}

// ─── Date ─────────────────────────────────────────────────────────────────

const DAY_TILES = 14;

/** The time a deadline gets when "At a set time" is switched on: the next hour today, 9:00 another day. */
function defaultTime(date: LocalDate, now: Date): string {
  if (date !== toLocalDateKey(now)) return "09:00";
  return `${pad(Math.min(23, now.getHours() + 1))}:00`;
}

export function DateDetail({
  deadline,
  onChange,
  busy,
  now,
  onBack,
}: {
  deadline: DeadlineInput | undefined;
  onChange: (deadline: DeadlineInput | undefined) => void;
  /** How many open tasks are due on each day (the dots under it). */
  busy: Map<LocalDate, number>;
  now: Date;
  onBack: () => void;
}) {
  const t = useTranslation();
  const today = toLocalDateKey(now);
  const days = useMemo(() => Array.from({ length: DAY_TILES }, (_, index) => addDaysToKey(today, index)), [today]);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const selected = deadline?.date;
  const beyondTiles = selected !== undefined && !days.includes(selected);

  const pickDay = (date: LocalDate) => onChange({ date, ...(deadline?.time ? { time: deadline.time } : {}) });

  return (
    <DetailCard>
      <DetailHeader title={t.addSheet.date} onBack={onBack} onDone={onBack} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -14 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 14 }}>
        {days.map((date) => {
          const picked = date === selected;
          const count = Math.min(3, busy.get(date) ?? 0);
          const weekday = date === today ? t.addSheet.today : keyToLocalDate(date).toLocaleDateString(t.locale, { weekday: "short" });
          return (
            <AnimatedPressable
              key={date}
              onPress={() => pickDay(date)}
              scaleTo={0.95}
              accessibilityRole="radio"
              accessibilityState={{ selected: picked }}
              accessibilityLabel={`${keyToLocalDate(date).toLocaleDateString(t.locale, { weekday: "long", month: "long", day: "numeric" })}${
                count > 0 ? `, ${t.addSheet.busy(busy.get(date) ?? 0)}` : ""
              }`}
              style={[
                { width: 62, height: 82, borderRadius: 18, backgroundColor: picked ? P.accent : P.tile, alignItems: "center", justifyContent: "center", gap: 4 },
                picked ? shadow("0 8px 16px rgba(242, 106, 46, 0.3)", 6, "#F26A2E") : null,
              ]}
            >
              <Text
                numberOfLines={1}
                style={{ fontFamily: "SpaceMono-Bold", fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase", color: picked ? P.onAccentSoft : P.inkMuted }}
              >
                {weekday}
              </Text>
              <Text style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 24, lineHeight: 26, color: picked ? "#FFFFFF" : P.ink }}>{keyParts(date).d}</Text>
              <View style={{ flexDirection: "row", gap: 2, height: 4 }}>
                {Array.from({ length: count }, (_, index) => (
                  <View key={index} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: picked ? "#FFFFFF" : P.ringSoft }} />
                ))}
              </View>
            </AnimatedPressable>
          );
        })}
      </ScrollView>

      {/* Another day (the calendar) on the left, no date at all on the right. */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <AnimatedPressable
          onPress={() => setCalendarOpen(true)}
          scaleTo={0.97}
          accessibilityRole="button"
          style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 }}
        >
          <SheetIcon name="calendar" size={16} color={P.accentInk} />
          <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: "SpaceGrotesk-SemiBold", fontSize: 14.5, color: P.accentInk }}>
            {beyondTiles && selected
              ? `${t.addSheet.anotherDay} · ${keyToLocalDate(selected).toLocaleDateString(t.locale, { weekday: "short", month: "short", day: "numeric" })}`
              : t.addSheet.anotherDay}
          </Text>
        </AnimatedPressable>
        <AnimatedPressable
          onPress={() => onChange(undefined)}
          scaleTo={0.97}
          accessibilityRole="radio"
          accessibilityState={{ selected: !deadline }}
          style={{ paddingLeft: 12 }}
        >
          <Text style={{ fontFamily: deadline ? "SpaceGrotesk-SemiBold" : "SpaceGrotesk-Bold", fontSize: 14.5, color: deadline ? P.inkMuted : P.ink }}>
            {t.addSheet.noDate}
          </Text>
        </AnimatedPressable>
      </View>
      {calendarOpen ? (
        <DayCalendar value={selected ?? today} minimum={today} onPick={pickDay} onClose={() => setCalendarOpen(false)} />
      ) : null}

      {deadline ? (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: P.chip, paddingTop: 12 }}>
            <Text style={{ fontFamily: "SpaceGrotesk-SemiBold", fontSize: 15.5, color: P.ink }}>{t.addSheet.atSetTime}</Text>
            <Toggle
              value={!!deadline.time}
              accessibilityLabel={t.addSheet.atSetTime}
              onChange={(on) => onChange(on ? { date: deadline.date, time: defaultTime(deadline.date, now) } : { date: deadline.date })}
            />
          </View>
          {deadline.time ? <TimeWheel time={deadline.time} onChange={(time) => onChange({ date: deadline.date, time })} /> : null}
        </>
      ) : null}
    </DetailCard>
  );
}

// ─── Duration ─────────────────────────────────────────────────────────────

const HOUR_STEPS = Array.from({ length: 13 }, (_, index) => index);
const DURATION_SHORTCUTS = [15, 30, 60, 120, NO_DURATION];

export function DurationDetail({ minutes, onChange, onBack }: { minutes: number; onChange: (minutes: number) => void; onBack: () => void }) {
  const t = useTranslation();
  const hours = Math.min(12, Math.floor(minutes / 60));
  const minuteIndex = Math.min(11, Math.round((minutes % 60) / 5));

  return (
    <DetailCard>
      <DetailHeader title={t.addSheet.duration} onBack={onBack} onDone={onBack} />
      <WheelFrame>
        <Wheel
          items={HOUR_STEPS.map(String)}
          index={hours}
          onChange={(index) => onChange(index * 60 + MINUTE_STEPS[minuteIndex])}
          width={60}
          accessibilityLabel={t.addSheet.hoursShort}
        />
        <WheelUnit label={t.addSheet.hoursShort} />
        <Wheel
          items={MINUTE_STEPS.map(pad)}
          index={minuteIndex}
          onChange={(index) => onChange(hours * 60 + MINUTE_STEPS[index])}
          width={60}
          accessibilityLabel={t.addSheet.minutesShort}
        />
        <WheelUnit label={t.addSheet.minutesShort} />
      </WheelFrame>
      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 4 }}>
        {DURATION_SHORTCUTS.map((value) => (
          <AnimatedPressable
            key={value}
            onPress={() => onChange(value)}
            scaleTo={0.94}
            hitSlop={6}
            accessibilityRole="radio"
            accessibilityState={{ selected: minutes === value }}
          >
            <Text style={{ fontFamily: "SpaceGrotesk-SemiBold", fontSize: 14, color: minutes === value ? P.accentInk : P.inkMuted }}>
              {t.form.durationOptions[value]}
            </Text>
          </AnimatedPressable>
        ))}
      </View>
    </DetailCard>
  );
}

// ─── Repeat ───────────────────────────────────────────────────────────────

const FREQUENCIES: RecurrenceFrequency[] = ["daily", "weekly", "monthly", "yearly"];
const WEEK: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

function RepeatRow({ label, children, first = false }: { label: string; children: ReactNode; first?: boolean }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        paddingVertical: 10,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: P.chip,
      }}
    >
      <Text style={{ flexShrink: 1, fontFamily: "SpaceGrotesk-SemiBold", fontSize: 15, color: P.ink }}>{label}</Text>
      {children}
    </View>
  );
}

function RoundStep({ label, onPress, disabled, accessibilityLabel }: { label: string; onPress: () => void; disabled: boolean; accessibilityLabel: string }) {
  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      scaleTo={0.9}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: P.paperCard, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.4 : 1 }}
    >
      <Text style={{ fontFamily: "SpaceGrotesk-Medium", fontSize: 18, lineHeight: 22, color: P.ink }}>{label}</Text>
    </AnimatedPressable>
  );
}

/** A small light pill for a time or a date in a row ("3:00 PM"). */
function ValuePill({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <AnimatedPressable
      onPress={onPress}
      scaleTo={0.95}
      accessibilityRole="button"
      style={{ height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: P.paperCard, borderWidth: 1.5, borderColor: P.lineWarm, justifyContent: "center" }}
    >
      <Text style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 14, color: P.ink }}>{label}</Text>
    </AnimatedPressable>
  );
}

export function RepeatDetail({
  repeat,
  onChange,
  deadline,
  now,
  onBack,
}: {
  repeat: RuleInput | null;
  onChange: (repeat: RuleInput | null) => void;
  deadline: DeadlineInput | undefined;
  now: Date;
  onBack: () => void;
}) {
  const t = useTranslation();
  const [timeOpen, setTimeOpen] = useState(false);
  const [endCalendarOpen, setEndCalendarOpen] = useState(false);
  const today = toLocalDateKey(now);
  const startDay = deadline?.date ?? today;
  // The rule as it will be saved — its summary, its time, its kind.
  const rule = useMemo(() => (repeat ? buildRule(repeat, makeDeadline(deadline), now) : null), [deadline, now, repeat]);
  const ruleTimeValue = rule && !rule.allDay ? `${pad(rule.hour)}:${pad(rule.minute)}` : null;
  const kind = rule?.kind ?? "task";

  const setFrequency = (frequency: RecurrenceFrequency) => {
    const base: RuleInput = repeat ?? { frequency };
    onChange({
      ...base,
      frequency,
      interval: base.interval ?? 1,
      weekdays: frequency === "weekly" ? (base.weekdays?.length ? base.weekdays : [weekdayOf(startDay)]) : undefined,
      monthDay: frequency === "monthly" ? (base.monthDay ?? keyParts(startDay).d) : undefined,
      // How often it comes round decides its kind again, unless picked below.
      kind: undefined,
    });
  };

  const update = (patch: Partial<RuleInput>) => repeat && onChange({ ...repeat, ...patch });
  const interval = repeat?.interval ?? 1;

  const toggleDay = (day: Weekday) => {
    if (!repeat) return;
    const days = repeat.weekdays ?? [];
    const next = days.includes(day) ? days.filter((other) => other !== day) : [...days, day];
    if (next.length > 0) update({ weekdays: next });
  };

  const summary = rule ? describeRule(rule, t, { withTime: true }) : t.recurrence.frequencies.none;

  return (
    <DetailCard>
      <DetailHeader title={t.addSheet.repeat} onBack={onBack} onDone={onBack} />

      {/* What it adds up to, in words; the × stops it repeating. */}
      <View style={{ borderRadius: 14, backgroundColor: P.peach, paddingVertical: 10, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <SheetIcon name="repeat" size={16} color={P.accentInk} strokeWidth={2.2} />
        <Text style={{ flex: 1, fontFamily: "SpaceGrotesk-Bold", fontSize: 14.5, color: P.accentInk }}>{summary}</Text>
        {repeat ? (
          <AnimatedPressable onPress={() => onChange(null)} scaleTo={0.9} hitSlop={8} accessibilityRole="button" accessibilityLabel={t.addSheet.noRepeat}>
            <SheetIcon name="close" size={16} color={P.accentInk} strokeWidth={2.2} />
          </AnimatedPressable>
        ) : null}
      </View>

      <View>
        <View style={{ paddingBottom: 10 }}>
          <Segmented
            options={FREQUENCIES.map((frequency) => ({ value: frequency, label: t.recurrence.frequencies[frequency] }))}
            value={repeat?.frequency ?? null}
            onChange={setFrequency}
          />
        </View>

        {repeat ? (
          <>
            <RepeatRow label={t.recurrence.every} first>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 2, padding: 3, borderRadius: 18, backgroundColor: P.chip }}>
                <RoundStep label="−" disabled={interval <= 1} onPress={() => update({ interval: interval - 1 })} accessibilityLabel={t.recurrence.decrease} />
                <Text style={{ minWidth: 70, textAlign: "center", fontFamily: "SpaceGrotesk-Bold", fontSize: 15, color: P.ink }}>
                  {`${interval} ${t.recurrence.unit(repeat.frequency, interval)}`}
                </Text>
                <RoundStep label="+" disabled={interval >= 365} onPress={() => update({ interval: interval + 1 })} accessibilityLabel={t.recurrence.increase} />
              </View>
            </RepeatRow>

            {repeat.frequency === "weekly" ? (
              <View style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: 4, paddingBottom: 10 }}>
                {WEEK.map((day) => {
                  const on = repeat.weekdays?.includes(day) ?? false;
                  return (
                    <AnimatedPressable
                      key={day}
                      onPress={() => toggleDay(day)}
                      scaleTo={0.92}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={weekdayName(day, t.locale, "long")}
                      style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: on ? P.accent : P.chip, alignItems: "center", justifyContent: "center" }}
                    >
                      <Text style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 13.5, color: on ? "#FFFFFF" : P.ink }}>{weekdayName(day, t.locale, "narrow")}</Text>
                    </AnimatedPressable>
                  );
                })}
              </View>
            ) : null}

            <RepeatRow label={t.addSheet.atSetTime}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                {ruleTimeValue ? <ValuePill label={formatTime(ruleTimeValue, t.locale)} onPress={() => setTimeOpen((open) => !open)} /> : null}
                <Toggle
                  value={!!ruleTimeValue}
                  accessibilityLabel={t.addSheet.atSetTime}
                  onChange={(on) => {
                    update({ time: on ? (deadline?.time ?? "09:00") : null });
                    setTimeOpen(on);
                  }}
                />
              </View>
            </RepeatRow>
            {ruleTimeValue && timeOpen ? <TimeWheel time={ruleTimeValue} onChange={(time) => update({ time })} /> : null}

            <RepeatRow label={t.addSheet.ends}>
              <Segmented
                width={170}
                options={[
                  { value: "never", label: t.recurrence.endsNever },
                  { value: "on", label: t.recurrence.endsOn },
                ]}
                value={repeat.endDate ? "on" : "never"}
                onChange={(value) => update({ endDate: value === "on" ? (repeat.endDate ?? addMonthsToKey(startDay, 1)) : undefined })}
              />
            </RepeatRow>
            {repeat.endDate ? (
              <View style={{ alignItems: "flex-end", paddingBottom: 10, marginTop: -2 }}>
                <ValuePill
                  label={keyToLocalDate(repeat.endDate).toLocaleDateString(t.locale, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                  onPress={() => setEndCalendarOpen(true)}
                />
              </View>
            ) : null}
            {endCalendarOpen && repeat.endDate ? (
              <DayCalendar value={repeat.endDate} minimum={startDay} onPick={(endDate) => update({ endDate })} onClose={() => setEndCalendarOpen(false)} />
            ) : null}

            <RepeatRow label={t.addSheet.ifMissed}>
              <Segmented
                width={170}
                options={[
                  { value: "keep", label: t.addSheet.keepOpen },
                  { value: "skip", label: t.addSheet.skip },
                ]}
                value={repeat.missed ?? "keep"}
                onChange={(missed) => update({ missed })}
              />
            </RepeatRow>
          </>
        ) : null}
      </View>

      {repeat ? (
        <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: P.chip, paddingTop: 10 }}>
          <Text style={{ fontFamily: "SpaceMono-Bold", fontSize: 10.5, letterSpacing: 1.26, textTransform: "uppercase", color: P.inkMuted }}>
            {t.addSheet.showAs}
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {(
              [
                { value: "task", title: t.addSheet.taskKind, hint: t.addSheet.taskKindHint },
                { value: "routine", title: t.addSheet.routineKind, hint: t.addSheet.routineKindHint },
              ] as const
            ).map((option) => {
              const picked = kind === option.value;
              return (
                <AnimatedPressable
                  key={option.value}
                  onPress={() => update({ kind: option.value })}
                  scaleTo={0.97}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: picked }}
                  style={{ flex: 1, borderRadius: 16, paddingVertical: 11, paddingHorizontal: 12, backgroundColor: picked ? P.ink : P.tile, gap: 3 }}
                >
                  <Text style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 15, color: picked ? "#FFFFFF" : P.ink }}>{option.title}</Text>
                  <Text style={{ fontFamily: "SpaceGrotesk-Regular", fontSize: 12, lineHeight: 15.6, color: picked ? "#BFB2A7" : P.inkMuted }}>{option.hint}</Text>
                </AnimatedPressable>
              );
            })}
          </View>
        </View>
      ) : null}
    </DetailCard>
  );
}

// ─── Priority ─────────────────────────────────────────────────────────────

const LEVELS: { level: TaskPriorityLevel; diamonds: number }[] = [
  { level: "high", diamonds: 3 },
  { level: "medium", diamonds: 2 },
  { level: "low", diamonds: 1 },
];

export function PriorityDetail({ value, onChange, onBack }: { value: TaskPriorityLevel; onChange: (level: TaskPriorityLevel) => void; onBack: () => void }) {
  const t = useTranslation();
  return (
    <DetailCard>
      <DetailHeader title={t.addSheet.priority} onBack={onBack} onDone={onBack} />
      <View style={{ gap: 8 }}>
        {LEVELS.map(({ level, diamonds }) => {
          const picked = value === level;
          return (
            <AnimatedPressable
              key={level}
              onPress={() => onChange(level)}
              scaleTo={0.98}
              accessibilityRole="radio"
              accessibilityState={{ selected: picked }}
              style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderRadius: 16, backgroundColor: picked ? P.peach : P.tile }}
            >
              <View style={{ width: 52, paddingLeft: 2 }}>
                <Diamonds filled={diamonds} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontFamily: "SpaceGrotesk-Bold", fontSize: 16, color: P.ink }}>{t.addSheet[level]}</Text>
                <Text style={{ fontFamily: "SpaceGrotesk-Regular", fontSize: 13, color: P.inkMuted }}>{t.addSheet[`${level}Hint`]}</Text>
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
        })}
      </View>
      <Text style={{ marginHorizontal: 2, fontFamily: "SpaceGrotesk-Regular", fontSize: 13, lineHeight: 18, color: P.inkMuted }}>{t.addSheet.priorityNote}</Text>
    </DetailCard>
  );
}

/** The Details line's value for a date: "Fri 6 · 3 PM", "Today", "No date". */
export function dateValue(deadline: DeadlineInput | undefined, now: Date, t: ReturnType<typeof useTranslation>, shortTime: (time: string) => string): string {
  if (!deadline) return t.addSheet.noDate;
  const day = shortDay(deadline.date, now, t);
  return deadline.time ? `${day} · ${shortTime(deadline.time)}` : day;
}
