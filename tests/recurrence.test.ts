/// <reference types="node" />
// Europe/Paris: summer time ends on 2026-10-25 and starts on 2027-03-28, so
// the DST cases below actually cross a clock change. Set before any Date use.
process.env.TZ = "Europe/Paris";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildNextOccurrence,
  buildRule,
  nextSlot,
  normalizeRule,
  occursOn,
  slotDueDate,
  startSeries,
  toLocalDateKey,
} from "@/lib/recurrence";
import type { RecurrenceRule } from "@/types/task";

import { local, makeTask } from "./helpers";

function rule(partial: Partial<RecurrenceRule> & Pick<RecurrenceRule, "frequency" | "anchorDate">): RecurrenceRule {
  const normalized = normalizeRule({ interval: 1, hour: 9, minute: 0, ...partial });
  assert.ok(normalized);
  return normalized;
}

describe("normalizeRule", () => {
  it("rejects unknown frequencies and bad anchors", () => {
    assert.equal(normalizeRule({ frequency: "hourly" as never, anchorDate: "2026-10-05" }), null);
    assert.equal(normalizeRule({ frequency: "daily", anchorDate: "2026-02-30" }), null);
  });

  it("clamps the interval and defaults a weekly rule to the anchor's weekday", () => {
    const weekly = normalizeRule({ frequency: "weekly", anchorDate: "2026-10-07", interval: 0 });
    assert.equal(weekly?.interval, 1);
    assert.deepEqual(weekly?.weekdays, [3]); // Wednesday
  });
});

describe("nextSlot", () => {
  it("daily every 3 days keeps its phase", () => {
    const daily = rule({ frequency: "daily", interval: 3, anchorDate: "2026-10-01" });
    assert.equal(nextSlot(daily, "2026-10-01"), "2026-10-04");
    assert.equal(nextSlot(daily, "2026-10-02"), "2026-10-04");
    assert.equal(nextSlot(daily, "2026-10-04"), "2026-10-07");
  });

  it("weekly on Monday: completing Monday's schedules next Monday", () => {
    const weekly = rule({ frequency: "weekly", anchorDate: "2026-10-05", weekdays: [1] });
    assert.equal(nextSlot(weekly, "2026-10-05"), "2026-10-12");
  });

  it("weekly on Mon/Thu, every 2 weeks", () => {
    const weekly = rule({ frequency: "weekly", interval: 2, anchorDate: "2026-10-05", weekdays: [1, 4] });
    assert.equal(nextSlot(weekly, "2026-10-05"), "2026-10-08");
    assert.equal(nextSlot(weekly, "2026-10-08"), "2026-10-19");
    assert.ok(!occursOn(weekly, "2026-10-12"));
  });

  it("monthly on the 31st lands on the last day of shorter months", () => {
    const monthly = rule({ frequency: "monthly", anchorDate: "2026-01-31", monthDay: 31 });
    assert.equal(nextSlot(monthly, "2026-01-31"), "2026-02-28");
    assert.equal(nextSlot(monthly, "2026-02-28"), "2026-03-31");
    assert.equal(nextSlot(monthly, "2026-03-31"), "2026-04-30");
  });

  it("yearly on Feb 29th falls on Feb 28th in other years", () => {
    const yearly = rule({ frequency: "yearly", anchorDate: "2028-02-29" });
    assert.equal(nextSlot(yearly, "2028-02-29"), "2029-02-28");
    assert.equal(nextSlot(yearly, "2031-03-01"), "2032-02-29");
  });

  it("stops at the end date", () => {
    const daily = rule({ frequency: "daily", anchorDate: "2026-10-01", endDate: "2026-10-03" });
    assert.equal(nextSlot(daily, "2026-10-02"), "2026-10-03");
    assert.equal(nextSlot(daily, "2026-10-03"), null);
  });

  it("skips missed slots when told not to go back before today", () => {
    const daily = rule({ frequency: "daily", anchorDate: "2026-10-01" });
    assert.equal(nextSlot(daily, "2026-10-01", "2026-10-09"), "2026-10-09");
  });
});

describe("daylight saving", () => {
  it("keeps the wall-clock time across the October change", () => {
    const weekly = rule({ frequency: "weekly", anchorDate: "2026-10-19", weekdays: [1], hour: 9, minute: 30 });
    const before = new Date(slotDueDate(weekly, "2026-10-19"));
    const after = new Date(slotDueDate(weekly, nextSlot(weekly, "2026-10-19")!));
    assert.equal(before.getHours(), 9);
    assert.equal(after.getHours(), 9);
    assert.equal(after.getMinutes(), 30);
    assert.equal(toLocalDateKey(after), "2026-10-26");
    // 7 days apart on the calendar, 7 days + 1 hour apart in real time.
    assert.equal(after.getTime() - before.getTime(), 7 * 24 * 3_600_000 + 3_600_000);
  });

  it("daily slots on either side of the change are consecutive days", () => {
    const daily = rule({ frequency: "daily", anchorDate: "2026-10-24", hour: 0, minute: 30 });
    assert.equal(nextSlot(daily, "2026-10-24"), "2026-10-25");
    assert.equal(nextSlot(daily, "2026-10-25"), "2026-10-26");
    assert.equal(new Date(slotDueDate(daily, "2026-10-25")).getHours(), 0);
  });
});

describe("buildRule", () => {
  it("anchors a weekly-on-Monday rule on the first Monday on or after the due day", () => {
    const due = local(2026, 10, 7, 18).toISOString(); // Wednesday
    const built = buildRule({ frequency: "weekly", weekdays: [1] }, due, local(2026, 10, 6, 12));
    assert.equal(built?.anchorDate, "2026-10-12");
    assert.equal(built?.hour, 18);
  });

  it("never starts on an occurrence whose time has already passed", () => {
    const due = local(2026, 10, 6, 9).toISOString();
    const built = buildRule({ frequency: "daily" }, due, local(2026, 10, 6, 15));
    assert.equal(built?.anchorDate, "2026-10-07");
  });

  it("without a due date, starts today at 18:00", () => {
    const built = buildRule({ frequency: "daily" }, undefined, local(2026, 10, 6, 10));
    assert.equal(built?.anchorDate, "2026-10-06");
    assert.equal(built?.hour, 18);
  });
});

describe("buildNextOccurrence", () => {
  const monday = rule({ frequency: "weekly", anchorDate: "2026-10-05", weekdays: [1], hour: 7 });
  const first = startSeries(
    makeTask({ id: "gym", title: "Gym", estimatedMinutes: 60, importance: 75 }),
    monday,
    "series-gym",
  );

  it("builds next Monday's occurrence from the template with a deterministic id", () => {
    const next = buildNextOccurrence({ ...first, status: "completed" }, local(2026, 10, 5, 8));
    assert.equal(next?.id, "series-gym@2026-10-12");
    assert.equal(next?.title, "Gym");
    assert.equal(next?.status, "pending");
    assert.equal(next?.importance, 75);
    assert.equal(next?.recurrence?.occurrenceDate, "2026-10-12");
    assert.equal(new Date(next!.dueDate!).getHours(), 7);
  });

  it("an overdue occurrence completed late schedules the next upcoming slot, not a missed one", () => {
    const next = buildNextOccurrence({ ...first, status: "completed" }, local(2026, 10, 21, 8));
    assert.equal(next?.recurrence?.occurrenceDate, "2026-10-26");
  });

  it("an occurrence completed early still moves past its own slot", () => {
    const next = buildNextOccurrence({ ...first, status: "completed" }, local(2026, 10, 3, 8));
    assert.equal(next?.recurrence?.occurrenceDate, "2026-10-12");
  });

  it("uses the full estimate even after the steps ate it to 0", () => {
    const withSteps = startSeries(
      makeTask({
        id: "report",
        estimatedMinutes: 0,
        subtasks: [
          { id: "a", label: "Draft", estimatedMinutes: 20, order: 0, status: "completed" },
          { id: "b", label: "Send", estimatedMinutes: 10, order: 1, status: "completed" },
        ],
      }),
      monday,
      "series-report",
    );
    const next = buildNextOccurrence({ ...withSteps, status: "completed" }, local(2026, 10, 5, 8));
    assert.equal(next?.estimatedMinutes, 30);
    assert.deepEqual(next?.subtasks?.map((subtask) => subtask.status), ["current", "pending"]);
  });
});
