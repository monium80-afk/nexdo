// A photo or document given to Nexdo as context for one task (Task Details'
// "Add context for AI", or the session's Add context): the AI reads the file
// once (/api/extract-text), and what it read is kept as one of the task's
// context notes — so every later breakdown, advice and reassessment knows it
// too, and the user can see exactly what Nexdo took from their file. The
// file itself is never stored.
//
// Pure string work with no imports: the app and the server (lib/serverRequest.ts)
// both use it.

export type ContextFileKind = "photo" | "document";

// The block's first line. English on purpose: it is read by the AI as much as
// by the app, which shows it in the user's language instead (ContextNoteCard).
const MARKERS: Record<ContextFileKind, string> = {
  photo: "[From a photo]",
  document: "[From a document]",
};

/** The most of a file's text one note keeps. A page or two — what a task needs from it. */
export const MAX_FILE_TEXT_LENGTH = 4_000;

/** The longest note the AI is sent: a file's text, plus the user's own words. */
export const MAX_CONTEXT_NOTE_LENGTH = MAX_FILE_TEXT_LENGTH + 1_000;

/**
 * All of a task's notes together, as the AI is sent them — the newest kept
 * first. Bounds what every advice or breakdown costs, however many files a
 * task has been given.
 */
export const MAX_CONTEXT_NOTES_TOTAL = 8_000;

export type ParsedContextNote = {
  /** The user's own words — may be empty for a file sent on its own. */
  text: string;
  file?: { kind: ContextFileKind; text: string };
};

/** One note from the user's words and a file's text: their words first, then the file's block. */
export function composeFileNote(kind: ContextFileKind, fileText: string, userText = ""): string {
  const trimmed = fileText.trim();
  const body = trimmed.length > MAX_FILE_TEXT_LENGTH ? `${trimmed.slice(0, MAX_FILE_TEXT_LENGTH).trimEnd()}…` : trimmed;
  const block = `${MARKERS[kind]}\n${body}`;
  const words = userText.trim();
  return words ? `${words}\n\n${block}` : block;
}

/** A note split back into the user's words and the file block, if it has one. */
export function parseContextNote(note: string): ParsedContextNote {
  for (const kind of Object.keys(MARKERS) as ContextFileKind[]) {
    const marker = MARKERS[kind];
    const at = note.startsWith(`${marker}\n`) ? 0 : note.indexOf(`\n${marker}\n`);
    if (at < 0) continue;
    const blockStart = at === 0 ? 0 : at + 1;
    return {
      text: note.slice(0, blockStart).trim(),
      file: { kind, text: note.slice(blockStart + marker.length + 1).trim() },
    };
  }
  return { text: note.trim() };
}

/** The same note with the user's words replaced — or added to — keeping its file block. */
export function withNoteText(note: string, text: string): string {
  const parsed = parseContextNote(note);
  return parsed.file ? composeFileNote(parsed.file.kind, parsed.file.text, text) : text.trim();
}

/**
 * A task's notes as the AI is sent them: each cut to MAX_CONTEXT_NOTE_LENGTH,
 * and all of them to MAX_CONTEXT_NOTES_TOTAL — the newest whole, the oldest
 * cut or left out. Order kept (oldest first).
 */
export function capContextNotes(notes: string[]): string[] {
  const kept: string[] = [];
  let left = MAX_CONTEXT_NOTES_TOTAL;
  for (let index = notes.length - 1; index >= 0 && left > 0; index -= 1) {
    const note = notes[index].trim().slice(0, Math.min(MAX_CONTEXT_NOTE_LENGTH, left));
    if (!note) continue;
    kept.unshift(note);
    left -= note.length;
  }
  return kept;
}
