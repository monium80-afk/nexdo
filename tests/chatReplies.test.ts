/// <reference types="node" />
// The replies the chat answers itself (lib/chatReplies.ts): a bare yes or no
// to a waiting change, and "undo". Anything that says more must reach the AI.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isCancellation, isConfirmation, isUndoRequest } from "@/lib/chatReplies";

describe("yes / no to a waiting change", () => {
  it("a bare yes, in every language, with or without please/thanks and punctuation", () => {
    for (const text of [
      "yes",
      "Yes!",
      "ok",
      "OK please",
      "yes please",
      "Sure, go ahead",
      "do it",
      "oui",
      "Oui merci",
      "d'accord",
      "vas-y",
      "sí",
      "Vale, gracias",
      "de acuerdo",
      "ja",
      "Ja bitte",
      "alles klar",
      "mach's",
      "نعم",
      "حسناً",
      "أكيد",
    ]) {
      assert.equal(isConfirmation(text), true, text);
    }
  });

  it("a bare no, in every language", () => {
    for (const text of ["no", "No thanks", "cancel", "never mind", "Don't", "non merci", "laisse tomber", "cancela", "nein", "lass es", "لا", "لا شكرا"]) {
      assert.equal(isCancellation(text), true, text);
    }
  });

  it("a message that only starts like a reply is an instruction, not a reply", () => {
    for (const text of [
      "Don't forget to call mom",
      "Ok also add buy milk",
      "Los Angeles trip next week",
      "No, move it to Friday instead",
      "yes but make it 30 minutes",
      "Sure, and add a dentist appointment",
      "Si tengo tiempo, llamo al banco",
      "Non, mets-le à vendredi",
      "Ja, und füge Einkaufen hinzu",
      "نعم واضف مهمة جديدة",
    ]) {
      assert.equal(isConfirmation(text), false, text);
      assert.equal(isCancellation(text), false, text);
    }
  });

  it("yes and no together is neither", () => {
    assert.equal(isConfirmation("yes no"), false);
    assert.equal(isCancellation("yes no"), false);
  });

  it("only polite words, or nothing, is neither", () => {
    for (const text of ["please", "thanks", "", "   ", "!!"]) {
      assert.equal(isConfirmation(text), false, JSON.stringify(text));
      assert.equal(isCancellation(text), false, JSON.stringify(text));
    }
  });
});

describe("undo", () => {
  it("undo, in every language", () => {
    for (const text of ["undo", "Undo that!", "undo the last change please", "revert it", "défais ça", "deshazlo", "rückgängig machen", "mach das rückgängig", "تراجع", "تراجع عن ذلك"]) {
      assert.equal(isUndoRequest(text), true, text);
    }
  });

  it("a task that mentions undoing something is not an undo", () => {
    for (const text of ["undo the shelf screws tomorrow", "revert the git commit before Friday", "no", "annule"]) {
      assert.equal(isUndoRequest(text), false, text);
    }
  });
});
