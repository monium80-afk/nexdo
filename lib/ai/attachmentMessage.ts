// How a message carrying files is written out for the Task Manager layer.
// Pure string work, no expo/network imports, so both the client pipeline and
// the offline heuristic can use it.
import type { ChatAttachment } from "@/types/chat";

export type ExtractedAttachment = { kind: ChatAttachment["kind"]; text: string };

const BLOCK_LABEL: Record<ChatAttachment["kind"], string> = {
  photo: "Attached image",
  voice: "Attached voice note",
  document: "Attached document",
};

/**
 * Frames what was read out of the files and what the user typed as two
 * clearly separate blocks. Without the framing the model reads an
 * instruction like "pull out the assignments and their deadlines" as a task
 * to create — see ATTACHED FILES in TASK_MANAGER_SYSTEM_PROMPT, which is
 * written against exactly this format.
 */
export function composeAttachmentMessage(extracted: ExtractedAttachment[], userText: string): string {
  const numbered = extracted.length > 1;
  const blocks = extracted.map(
    (item, index) => `[${BLOCK_LABEL[item.kind]}${numbered ? ` ${index + 1}` : ""}]\n${item.text}`,
  );
  if (userText) blocks.push(`[User's instruction]\n${userText}`);
  return blocks.join("\n\n");
}

const BLOCK_MARKER_PATTERN = /^\[Attached (?:image|voice note|document)(?: \d+)?\]$/gm;
const USER_INSTRUCTION_BLOCK_PATTERN = /^\[User's instruction\][\s\S]*?(?=^\[Attached (?:image|voice note|document)(?: \d+)?\]$|$)/gm;

/** The offline heuristic classifier reads raw words, so the markers come back out first. */
export function stripAttachmentBlocks(text: string): string {
  return text
    .replace(USER_INSTRUCTION_BLOCK_PATTERN, "")
    .replace(BLOCK_MARKER_PATTERN, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
