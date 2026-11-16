/// <reference types="node" />
// The quick-add line (lib/quickAdd.ts) and its repeat reader (lib/repeatPhrase.ts):
// one typed line into a task's fields, with plain rules — no AI.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseQuickAdd } from "@/lib/quickAdd";
import { findRepeat } from "@/lib/repeatPhrase";

// Wednesday, November 4, 2026, 10:00 local time.
const NOW = new Date(2026, 10, 4, 10, 0, 0);

function repeatOf(text: string, language?: Parameters<typeof findRepeat>[2]) {
  return findRepeat(text, NOW, language)?.rule;
}

describe("repeat phrases", () => {
  it("English", () => {
    assert.deepEqual(repeatOf("water plants every day"), { frequency: "daily", interval: 1 });
    assert.deepEqual(repeatOf("meditate daily"), { frequency: "daily", interval: 1 });
    assert.deepEqual(repeatOf("every other day"), { frequency: "daily", interval: 2 });
    assert.deepEqual(repeatOf("every 3 days"), { frequency: "daily", interval: 3 });
    assert.deepEqual(repeatOf("team call every monday"), { frequency: "weekly", interval: 1, weekdays: [1] });
    assert.deepEqual(repeatOf("every other tuesday"), { frequency: "weekly", interval: 2, weekdays: [2] });
    assert.deepEqual(repeatOf("gym every mon, wed and fri"), { frequency: "weekly", interval: 1, weekdays: [1, 3, 5] });
    assert.deepEqual(repeatOf("standup weekdays"), { frequency: "weekly", interval: 1, weekdays: [1, 2, 3, 4, 5] });
    assert.deepEqual(repeatOf("every weekend"), { frequency: "weekly", interval: 1, weekdays: [6, 0] });
    assert.deepEqual(repeatOf("every 2 weeks on thursday"), { frequency: "weekly", interval: 2, weekdays: [4] });
    assert.deepEqual(repeatOf("pay rent every 1st"), { frequency: "monthly", interval: 1, monthDay: 1 });
    assert.deepEqual(repeatOf("on the 15th of every month"), { frequency: "monthly", interval: 1, monthDay: 15 });
    assert.deepEqual(repeatOf("every month"), { frequency: "monthly", interval: 1 });
    assert.deepEqual(repeatOf("biweekly"), { frequency: "weekly", interval: 2 });
    assert.deepEqual(repeatOf("every year"), { frequency: "yearly", interval: 1 });
    assert.deepEqual(repeatOf("on tuesdays and thursdays"), { frequency: "weekly", interval: 1, weekdays: [2, 4] });
  });

  it("an end day right after it", () => {
    assert.deepEqual(repeatOf("every day until december 20"), { frequency: "daily", interval: 1, endDate: "2026-12-20" });
  });

  it("French, Spanish, German", () => {
    assert.deepEqual(repeatOf("tous les jours", "fr"), { frequency: "daily", interval: 1 });
    assert.deepEqual(repeatOf("tous les lundis", "fr"), { frequency: "weekly", interval: 1, weekdays: [1] });
    assert.deepEqual(repeatOf("toutes les deux semaines", "fr"), { frequency: "weekly", interval: 2 });
    assert.deepEqual(repeatOf("le 1er de chaque mois", "fr"), { frequency: "monthly", interval: 1, monthDay: 1 });
    assert.deepEqual(repeatOf("en semaine", "fr"), { frequency: "weekly", interval: 1, weekdays: [1, 2, 3, 4, 5] });
    assert.deepEqual(repeatOf("cada día", "es"), { frequency: "daily", interval: 1 });
    assert.deepEqual(repeatOf("todos los martes y jueves", "es"), { frequency: "weekly", interval: 1, weekdays: [2, 4] });
    assert.deepEqual(repeatOf("cada 2 semanas", "es"), { frequency: "weekly", interval: 2 });
    assert.deepEqual(repeatOf("cada año", "es"), { frequency: "yearly", interval: 1 });
    assert.deepEqual(repeatOf("jeden Tag", "de"), { frequency: "daily", interval: 1 });
    assert.deepEqual(repeatOf("jeden zweiten Montag", "de"), { frequency: "weekly", interval: 2, weekdays: [1] });
    assert.deepEqual(repeatOf("alle 3 Wochen", "de"), { frequency: "weekly", interval: 3 });
    assert.deepEqual(repeatOf("montags und donnerstags", "de"), { frequency: "weekly", interval: 1, weekdays: [1, 4] });
  });

  it("no repeat where there isn't one", () => {
    for (const text of ["call mom tomorrow", "read every page", "Month-end report", "every satellite"]) {
      assert.equal(repeatOf(text, "en"), undefined, text);
    }
  });
});

describe("quick-add line", () => {
  it("takes the date and time words out of the title", () => {
    const result = parseQuickAdd("Call mom tomorrow at 6pm", NOW, "en");
    assert.equal(result.title, "Call mom");
    assert.deepEqual(result.deadline, { date: "2026-11-05", time: "18:00" });
    assert.equal(result.deadlineTyped, true);
  });

  it("today, date-only, when no day is typed", () => {
    const result = parseQuickAdd("buy milk", NOW, "en");
    assert.equal(result.title, "Buy milk");
    assert.deepEqual(result.deadline, { date: "2026-11-04" });
    assert.equal(result.deadlineTyped, false);
  });

  it("no deadline when asked for none", () => {
    const result = parseQuickAdd("learn piano no deadline", NOW, "en");
    assert.equal(result.title, "Learn piano");
    assert.equal(result.deadline, undefined);
  });

  it("a stated length", () => {
    const result = parseQuickAdd("Write report friday for 2 hours", NOW, "en");
    assert.equal(result.title, "Write report");
    assert.equal(result.estimatedMinutes, 120);
    assert.equal(result.durationTyped, true);
    assert.deepEqual(result.deadline, { date: "2026-11-06" });
  });

  it("priority from p1–p3 and from words at the ends", () => {
    assert.equal(parseQuickAdd("Send invoice p1", NOW, "en").priorityLevel, "high");
    assert.equal(parseQuickAdd("Send invoice p1", NOW, "en").title, "Send invoice");
    const urgent = parseQuickAdd("Send invoice, urgent", NOW, "en");
    assert.equal(urgent.title, "Send invoice");
    assert.equal(urgent.priorityLevel, "high");
    assert.equal(parseQuickAdd("Important meeting prep", NOW, "en").title, "Important meeting prep");
  });

  it("a repeat with its time", () => {
    const result = parseQuickAdd("Team call every monday at 9am", NOW, "en");
    assert.equal(result.title, "Team call");
    assert.deepEqual(result.recurrence, { frequency: "weekly", interval: 1, weekdays: [1], time: "09:00" });
  });

  it("removes scaffolding like 'remind me to'", () => {
    assert.equal(parseQuickAdd("remind me to call the bank on friday", NOW, "en").title, "Call the bank");
  });

  it("French, Spanish, German dates come out of the title too", () => {
    const fr = parseQuickAdd("Appeler le dentiste vendredi à 15h", NOW, "fr");
    assert.equal(fr.title, "Appeler le dentiste");
    assert.deepEqual(fr.deadline, { date: "2026-11-06", time: "15:00" });
    const es = parseQuickAdd("Comprar pan mañana", NOW, "es");
    assert.equal(es.title, "Comprar pan");
    assert.deepEqual(es.deadline, { date: "2026-11-05" });
    const de = parseQuickAdd("Zahnarzt am Freitag um 15 Uhr", NOW, "de");
    assert.equal(de.title, "Zahnarzt");
    assert.deepEqual(de.deadline, { date: "2026-11-06", time: "15:00" });
  });

  it("flags lines the AI would read better", () => {
    assert.equal(parseQuickAdd("Dentist 3/4", NOW, "en").unclear, true);
    assert.equal(parseQuickAdd("buy milk", NOW, "en").unclear, false);
    assert.equal(parseQuickAdd("buy milk, call mom, email Sam", NOW, "en").unclear, true);
    assert.equal(parseQuickAdd("move the dentist to friday", NOW, "en").looksLikeChange, true);
    assert.equal(parseQuickAdd("move the couch to the garage", NOW, "en").looksLikeChange, false);
  });
});
