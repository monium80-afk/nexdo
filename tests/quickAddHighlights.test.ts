import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseQuickAdd } from "@/lib/quickAdd";

// A Wednesday at noon, so "friday" is two days ahead.
const NOW = new Date(2026, 10, 4, 12, 0);

function marked(line: string): string[] {
  return parseQuickAdd(line, NOW, "en").highlights.map((range) => line.slice(range.start, range.end));
}

describe("quick-add highlights", () => {
  it("marks the day and time, the length and the repeat, where they were typed", () => {
    const words = marked("Dentist friday 3pm 1h every month");
    assert.ok(words.some((word) => /friday/i.test(word) && /3pm/i.test(word)), `got ${JSON.stringify(words)}`);
    assert.ok(words.includes("1h"), `got ${JSON.stringify(words)}`);
    assert.ok(words.includes("every month"), `got ${JSON.stringify(words)}`);
    assert.ok(!words.some((word) => /dentist/i.test(word)));
  });

  it("marks a p1 priority token", () => {
    assert.deepEqual(marked("Call mom p1"), ["p1"]);
  });

  it("marks nothing in a plain title", () => {
    assert.deepEqual(marked("Buy milk"), []);
  });

  it("gives ordered ranges that never overlap", () => {
    const { highlights } = parseQuickAdd("Gym every monday at 7am for 45 min", NOW, "en");
    for (let index = 1; index < highlights.length; index += 1) {
      assert.ok(highlights[index].start >= highlights[index - 1].end);
    }
  });
});
