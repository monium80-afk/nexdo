import { Text, View } from "react-native";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { ROW_RULE, TIGHT_TEXT, dayEntries, timeLabel, type DayEntry } from "@/components/schedule/scheduleParts";
import { useTranslation } from "@/hooks/useTranslation";
import { keyToLocalDate, weekdayOf, type LocalDate } from "@/lib/localDate";
import { weekdayName } from "@/lib/recurrence";
import type { DayPlan } from "@/lib/schedule";

/** A coming repeat's row (not a real task yet) is drawn this much lighter. */
const PLANNED_OPACITY = 0.5;

/** "TASKS" on ink, or "ROUTINES" on peach: the label over each of a day's lists. */
function ListLabel({ label, tone }: { label: string; tone: "ink" | "peach" }) {
  return (
    <View className={`h-[24px] self-start justify-center rounded-full px-[10px] ${tone === "ink" ? "bg-ink" : "bg-peach"}`}>
      <Text
        className={`font-mono-bold text-[11px] uppercase leading-[14px] tracking-[1.4px] ${tone === "ink" ? "text-white" : "text-accent-ink"}`}
        style={TIGHT_TEXT}
      >
        {label}
      </Text>
    </View>
  );
}

/** One row: the time in a column of its own, then the title. Late times in red; finished ones struck through. */
function EntryRow({ entry, last, onPress }: { entry: DayEntry; last: boolean; onPress: () => void }) {
  const t = useTranslation();
  return (
    <AnimatedPressable
      // A coming repeat isn't a task yet: nothing to open, and drawn lighter.
      onPress={entry.planned ? undefined : onPress}
      disabled={entry.planned}
      scaleTo={0.98}
      accessibilityRole={entry.planned ? "text" : "button"}
      className="h-[47px] flex-row pt-[11.9px]"
      style={[last ? undefined : { borderBottomWidth: 0.75, borderBottomColor: ROW_RULE }, entry.planned ? { opacity: PLANNED_OPACITY } : undefined]}
    >
      <Text
        numberOfLines={1}
        // A longer word for "Anytime" in some languages shrinks to fit the column.
        adjustsFontSizeToFit
        className={`mt-[0.6px] w-[80px] pl-[2px] pr-[6px] font-mono-bold text-[11px] leading-[22px] tracking-[0.9px] ${entry.overdue ? "text-alert" : "text-ink-muted"}`}
        style={TIGHT_TEXT}
      >
        {timeLabel(entry, t)}
      </Text>
      <Text
        numberOfLines={1}
        className={`flex-1 font-grotesk-medium text-[16px] leading-[22px] ${entry.done ? "text-[#A79C92] line-through" : "text-ink"}`}
        style={TIGHT_TEXT}
      >
        {entry.task.title}
      </Text>
    </AnimatedPressable>
  );
}

/**
 * The Week view: the seven days of the week as tiles (the picked one dark),
 * then the picked day's tasks and its routines, each list under its label.
 */
export function ScheduleWeek({
  week,
  plans,
  selected,
  onSelect,
  onOpenTask,
}: {
  /** Monday to Sunday. */
  week: LocalDate[];
  plans: Map<LocalDate, DayPlan>;
  selected: LocalDate;
  onSelect: (date: LocalDate) => void;
  onOpenTask: (id: string) => void;
}) {
  const t = useTranslation();

  return (
    <View>
      <View className="flex-row gap-[5px]">
        {week.map((date) => {
          const picked = date === selected;
          const day = keyToLocalDate(date);
          return (
            <AnimatedPressable
              key={date}
              onPress={() => onSelect(date)}
              scaleTo={0.94}
              accessibilityRole="button"
              accessibilityState={{ selected: picked }}
              accessibilityLabel={day.toLocaleDateString(t.locale, { weekday: "long", month: "long", day: "numeric" })}
              className={`h-[58px] flex-1 items-center rounded-[15px] pt-[11.2px] ${picked ? "bg-ink" : "bg-chip"}`}
            >
              <Text
                className={`font-mono-bold text-[10px] leading-[12px] ${picked ? "text-peach-on-dark" : "text-ink-muted"}`}
                style={TIGHT_TEXT}
              >
                {weekdayName(weekdayOf(date), t.locale, "narrow")}
              </Text>
              <Text
                className={`mt-[3px] font-grotesk-bold text-[17.5px] leading-[22px] tracking-[-0.35px] ${picked ? "text-white" : "text-ink"}`}
                style={TIGHT_TEXT}
              >
                {day.toLocaleDateString(t.locale, { day: "numeric" })}
              </Text>
            </AnimatedPressable>
          );
        })}
      </View>

      <ScheduleDayLists plan={plans.get(selected)} date={selected} onOpenTask={onOpenTask} />
    </View>
  );
}

/**
 * The picked day under the Week and Month views (the same since 2026-11-14):
 * its date, then its tasks and its routines, each list under its label.
 */
export function ScheduleDayLists({ plan, date, onOpenTask }: { plan: DayPlan | undefined; date: LocalDate; onOpenTask: (id: string) => void }) {
  const t = useTranslation();
  const { tasks, routines } = dayEntries(plan);
  const dayTitle = keyToLocalDate(date).toLocaleDateString(t.locale, { weekday: "long", month: "short", day: "numeric" });

  return (
    <View>
      <Text className="mt-[17.4px] font-grotesk-bold text-[18px] leading-[24px] text-ink" style={TIGHT_TEXT}>
        {dayTitle}
      </Text>

      {tasks.length === 0 && routines.length === 0 ? (
        <Text className="mt-[14px] font-grotesk-regular text-[14px] leading-[18px] text-ink-muted" style={TIGHT_TEXT}>
          {t.schedule.nothingDue}
        </Text>
      ) : null}

      {tasks.length > 0 ? (
        <View className="mt-[19.6px]">
          <ListLabel label={t.schedule.tasksLabel} tone="ink" />
          <View className="mt-[4.5px]">
            {tasks.map((entry, index) => (
              <EntryRow key={entry.task.id} entry={entry} last={index === tasks.length - 1} onPress={() => onOpenTask(entry.task.id)} />
            ))}
          </View>
        </View>
      ) : null}

      {routines.length > 0 ? (
        <View className={tasks.length > 0 ? "mt-[19.75px]" : "mt-[19.6px]"}>
          <ListLabel label={t.schedule.routinesLabel} tone="peach" />
          <View className="mt-[4.5px]">
            {routines.map((entry, index) => (
              <EntryRow key={entry.task.id} entry={entry} last={index === routines.length - 1} onPress={() => onOpenTask(entry.task.id)} />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}
