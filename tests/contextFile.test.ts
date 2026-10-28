/// <reference types="node" />
// A photo's or document's text kept as a task's context note (lib/contextFile.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  capContextNotes,
  composeFileNote,
  MAX_CONTEXT_NOTE_LENGTH,
  MAX_CONTEXT_NOTES_TOTAL,
  MAX_FILE_TEXT_LENGTH,
  parseContextNote,
  withNoteText,
} from "@/lib/contextFile";

describe("notes made from a file", () => {
  it("the user's words come first, then the file's block", () => {
    const note = composeFileNote("photo", "  Question 1: solve for x  ", "the worksheet");
    assert.equal(note, "the worksheet\n\n[From a photo]\nQuestion 1: solve for x");
    assert.deepEqual(parseContextNote(note), { text: "the worksheet", file: { kind: "photo", text: "Question 1: solve for x" } });
  });

  it("a file on its own, and a plain note, read back as they were", () => {
    assert.deepEqual(parseContextNote(composeFileNote("document", "Rubric")), { text: "", file: { kind: "document", text: "Rubric" } });
    assert.deepEqual(parseContextNote("I already did the research."), { text: "I already did the research." });
  });

  it("a long file is cut to what a note keeps", () => {
    const note = composeFileNote("document", "x".repeat(MAX_FILE_TEXT_LENGTH + 500));
    const parsed = parseContextNote(note);
    assert.equal(parsed.file?.text.length, MAX_FILE_TEXT_LENGTH + 1);
    assert.ok(parsed.file?.text.endsWith("…"));
  });

  it("editing changes the words and keeps what was read", () => {
    const note = composeFileNote("photo", "Page 12", "old words");
    assert.equal(withNoteText(note, "new words"), composeFileNote("photo", "Page 12", "new words"));
    assert.equal(withNoteText(note, ""), composeFileNote("photo", "Page 12"));
    assert.equal(withNoteText("just a note", "edited"), "edited");
  });
});

describe("what the AI is sent of a task's notes", () => {
  it("short notes all go, in order", () => {
    assert.deepEqual(capContextNotes(["one", "two", "three"]), ["one", "two", "three"]);
  });

  it("each note is cut, and all of them together stay within the total — newest kept first", () => {
    const big = "a".repeat(MAX_CONTEXT_NOTE_LENGTH + 2_000);
    const notes = ["oldest", big, big, big];
    const sent = capContextNotes(notes);
    assert.ok(sent.every((note) => note.length <= MAX_CONTEXT_NOTE_LENGTH));
    assert.ok(sent.join("").length <= MAX_CONTEXT_NOTES_TOTAL);
    assert.ok(!sent.includes("oldest"), "the oldest note is the one left out");
    assert.equal(sent[sent.length - 1].length, MAX_CONTEXT_NOTE_LENGTH);
  });
});
