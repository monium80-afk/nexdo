import AsyncStorage from "@react-native-async-storage/async-storage";

// This install's one free onboarding AI run, before any account exists. The
// id goes out with every signed-out API request, and the server counts what it
// has used (lib/anonymousTrial.ts) — that count is the limit that holds. The
// "used" flag here only decides what onboarding shows: after the run, it asks
// the user to create their account instead of offering the AI again.
//
// Both live under one key, so they're lost together: a reinstall starts over
// with a new id, and the server's per-IP and per-day ceilings cover that.
const STORAGE_KEY = "nexdo-ai-trial";

type TrialRecord = { id: string; used: boolean };

function createTrialId(): string {
  const random = Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join("");
  return `trial-${Date.now().toString(36)}-${random}`;
}

function isTrialRecord(value: unknown): value is TrialRecord {
  const record = value as Partial<TrialRecord> | null;
  return typeof record?.id === "string" && typeof record.used === "boolean";
}

// One read per app launch, shared: the first few requests can go out at once,
// and each making up its own id would split one install into several.
let recordPromise: Promise<TrialRecord> | null = null;

function loadRecord(): Promise<TrialRecord> {
  recordPromise ??= (async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      const parsed: unknown = stored ? JSON.parse(stored) : null;
      if (isTrialRecord(parsed)) return parsed;
    } catch (error) {
      console.warn("[aiTrial] couldn't read the trial record", error);
    }
    const record = { id: createTrialId(), used: false };
    await saveRecord(record);
    return record;
  })();
  return recordPromise;
}

async function saveRecord(record: TrialRecord) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch (error) {
    console.warn("[aiTrial] couldn't save the trial record", error);
  }
}

export async function getTrialId(): Promise<string> {
  return (await loadRecord()).id;
}

export async function isTrialUsed(): Promise<boolean> {
  return (await loadRecord()).used;
}

/** Called as onboarding sends the brain dump to the AI — the run the trial is for. */
export async function markTrialUsed(): Promise<void> {
  const record = await loadRecord();
  if (record.used) return;
  const updated = { ...record, used: true };
  recordPromise = Promise.resolve(updated);
  await saveRecord(updated);
}
