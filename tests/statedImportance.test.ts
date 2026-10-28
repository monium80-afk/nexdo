/// <reference types="node" />
// Importance read straight off the user's own words (lib/ai/extractTasks.ts)
// — what the inbox route uses to override the model, and the offline guess.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { guessPriorityLevel } from "@/lib/ai/extractTasks";

describe("importance stated in the user's words", () => {
  it("stressed outright is critical, in each language", () => {
    for (const text of [
      "Finish the visa form, it's really important",
      "top priority: send the contract",
      "Ce dossier est très important",
      "Es muy importante llamar al banco",
      "Das ist sehr wichtig",
    ]) {
      assert.equal(guessPriorityLevel(text), "critical", text);
    }
  });

  it("plainly important is high; nothing said is medium", () => {
    assert.equal(guessPriorityLevel("important: call the landlord"), "high");
    assert.equal(guessPriorityLevel("Study for the exam"), "high");
    assert.equal(guessPriorityLevel("Buy milk"), "medium");
  });

  it("a negation is low, never critical", () => {
    for (const text of [
      "not really important, just clean the garage",
      "it's not very important",
      "pas très important",
      "no es muy importante",
      "nicht sehr wichtig",
      "no rush on this one",
    ]) {
      assert.equal(guessPriorityLevel(text), "low", text);
    }
  });
});
