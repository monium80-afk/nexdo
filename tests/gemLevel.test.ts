/// <reference types="node" />
// The Today gem's level from today's tasks (lib/gemLevel.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { gemLevelFor } from "@/lib/gemLevel";

describe("gemLevelFor", () => {
  it("is level 1 with nothing done and level 5 only with everything done", () => {
    assert.equal(gemLevelFor(0, 6), 1);
    assert.equal(gemLevelFor(6, 6), 5);
    assert.equal(gemLevelFor(7, 8), 4);
  });

  it("spreads the tasks in between over levels 2–4", () => {
    assert.deepEqual([0, 1, 2, 3, 4].map((done) => gemLevelFor(done, 4)), [1, 2, 3, 4, 5]);
    assert.deepEqual([0, 1, 2].map((done) => gemLevelFor(done, 2)), [1, 3, 5]);
    assert.deepEqual([0, 1].map((done) => gemLevelFor(done, 1)), [1, 5]);
    assert.equal(gemLevelFor(1, 20), 2);
  });
});
