// The short replies the chat answers itself, without the AI: "yes" / "no" to
// a change it is waiting to make, and "undo".
//
// A message counts only when that is ALL it says — the reply, plus at most a
// "please" or "thanks". These used to match on the first word alone, and with
// a change waiting, "Don't forget to call mom" cancelled it, "Ok also add
// milk" confirmed it and dropped "add milk", and "Los Angeles trip" confirmed
// it ("los" is German for "go ahead"). Anything longer goes to the AI.
//
// English, French, Spanish, German and Arabic are all understood, whatever
// the app language.

/** Longer than any bare reply; past this a message is always an instruction. */
const MAX_REPLY_WORDS = 6;

/**
 * Lower case, curly apostrophes made straight, Arabic written without its
 * optional marks and with one alef — so "Oui !", "oui" and "OUI." all read
 * the same, and so do "أكيد" and "اكيد".
 */
function normalize(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}'\s-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function phrases(list: string[]): string[][] {
  return list.map((phrase) => normalize(phrase).split(" ")).sort((a, b) => b.length - a.length);
}

// Polite words that may ride along with a reply without making it an
// instruction.
const FILLERS = phrases([
  "please", "pls", "plz", "thanks", "thank you", "thx", "now", "then", "it", "that", "this", "them", "all", "all of them", "both",
  "merci", "s'il te plaît", "s'il vous plaît", "stp", "svp", "ça", "ca", "tout", "tous", "maintenant",
  "gracias", "por favor", "eso", "todo", "todos", "ahora",
  "bitte", "danke", "das", "es", "alle", "jetzt",
  "شكرا", "من فضلك", "لو سمحت", "الان",
]);

const YES = phrases([
  "yes", "yep", "yup", "yeah", "yea", "ya", "sure", "ok", "okay", "k", "alright", "all right", "confirm", "confirmed",
  "correct", "right", "do it", "go ahead", "go for it", "sounds good", "perfect", "great", "fine", "absolutely",
  "definitely", "of course", "please do",
  "oui", "ouais", "ouaip", "d'accord", "dac", "vas-y", "vas y", "allez-y", "allez y", "confirme", "confirmer",
  "je confirme", "bien sûr", "parfait", "c'est bon", "carrément", "exactement", "volontiers", "fais-le", "fais le",
  "sí", "si", "claro", "vale", "dale", "de acuerdo", "adelante", "hazlo", "confirma", "confirmar", "confirmo",
  "perfecto", "por supuesto", "bueno", "está bien", "esta bien", "venga",
  "ja", "jap", "jep", "jo", "klar", "gern", "gerne", "genau", "passt", "einverstanden", "los", "mach das", "mach es",
  "mach schon", "mach's", "bestätigen", "bestätige", "in ordnung", "alles klar", "natürlich", "sicher", "perfekt",
  "richtig",
  "نعم", "اجل", "ايوه", "ايوا", "حسنا", "تمام", "موافق", "اكيد", "طيب", "اكد", "تاكيد",
]);

const NO = phrases([
  "no", "nope", "nah", "cancel", "never mind", "nevermind", "don't", "dont", "do not", "stop", "not now", "not yet",
  "no way", "forget it", "skip it", "leave it",
  "non", "annule", "annuler", "laisse tomber", "pas maintenant", "pas encore", "oublie", "surtout pas", "arrête",
  "cancela", "cancelar", "déjalo", "dejalo", "olvídalo", "olvidalo", "mejor no", "ahora no", "todavía no", "para",
  "nein", "nö", "ne", "abbrechen", "brich ab", "lass es", "lass das", "lieber nicht", "jetzt nicht", "vergiss es",
  "stopp",
  "لا", "الغ", "الغاء", "ليس الان", "انس الامر", "توقف",
]);

// "Undo" is intercepted here rather than sent to the AI — see
// TASK_MANAGER_SYSTEM_PROMPT §6.2, which is written assuming this.
const UNDO = phrases([
  "undo", "undo that", "undo it", "undo the last change", "undo last change", "revert", "revert that", "revert it",
  "take that back",
  "défaire", "defaire", "défais", "defais", "défais ça", "défaire ça", "annule la dernière action",
  "deshacer", "deshacer eso", "deshazlo", "deshaz", "deshaz eso",
  "rückgängig", "ruckgangig", "rückgängig machen", "mach das rückgängig", "mach es rückgängig", "mach's rückgängig",
  "تراجع", "تراجع عن ذلك", "تراجع عن اخر تغيير", "الغ اخر تغيير",
]);

const UNDO_FILLERS = phrases(["please", "pls", "now", "merci", "s'il te plaît", "svp", "stp", "por favor", "bitte", "من فضلك", "لو سمحت"]);

function matchAt(words: string[], start: number, list: string[][]): number {
  for (const phrase of list) {
    if (phrase.every((word, offset) => words[start + offset] === word)) return phrase.length;
  }
  return 0;
}

/** True when the text is nothing but phrases from `core` — at least one — and `fillers`. */
function isBare(text: string, core: string[][], fillers: string[][]): boolean {
  const words = normalize(text).split(" ").filter(Boolean);
  if (words.length === 0 || words.length > MAX_REPLY_WORDS) return false;
  let index = 0;
  let sawCore = false;
  while (index < words.length) {
    const coreLength = matchAt(words, index, core);
    if (coreLength > 0) {
      sawCore = true;
      index += coreLength;
      continue;
    }
    const fillerLength = matchAt(words, index, fillers);
    if (fillerLength === 0) return false;
    index += fillerLength;
  }
  return sawCore;
}

/** "Yes", "ok please", "oui merci" — a go-ahead and nothing else. */
export function isConfirmation(text: string): boolean {
  return isBare(text, YES, FILLERS);
}

/** "No", "cancel", "non merci" — a no and nothing else. */
export function isCancellation(text: string): boolean {
  return isBare(text, NO, FILLERS);
}

/** "Undo", "undo that please", "rückgängig". */
export function isUndoRequest(text: string): boolean {
  return isBare(text, UNDO, UNDO_FILLERS);
}
