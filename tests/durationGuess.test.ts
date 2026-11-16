/// <reference types="node" />
// The offline length guess (lib/ai/extractTasks.ts) — what a task gets when no
// model gave it one.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { guessDuration } from "@/lib/ai/extractTasks";

describe("duration guessed from the user's words", () => {
  it("a stated length always wins", () => {
    assert.equal(guessDuration("brush my teeth for 10 minutes"), 10);
    assert.equal(guessDuration("write the essay for two hours"), 120);
  });

  it("daily-routine chores are a few minutes, not half an hour", () => {
    for (const text of ["Brush my teeth", "brush teeth in the morning", "take my vitamins", "feed the cat", "take out the trash"]) {
      assert.equal(guessDuration(text), 5, text);
    }
  });

  it("bigger and quicker work keep their own guesses", () => {
    assert.equal(guessDuration("write the report"), 60);
    assert.equal(guessDuration("call the dentist"), 15);
    assert.equal(guessDuration("brush up on my French"), 30);
  });
});
