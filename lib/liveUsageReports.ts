import AsyncStorage from "@react-native-async-storage/async-storage";

import type { LiveUsageRequestBody } from "@/app/api/live-usage+api";
import { apiPost } from "@/lib/api";

// A Live voice session's time is taken from the month when it opens; the
// report sent once it stops (app/api/live-usage+api.ts) gives back what it
// didn't use. A report lost to a dropped connection or a closed app would
// leave the session counted in full, so each one waits here, saved on the
// phone, until it gets through. The server settles a session only once, so
// sending a report again can never count twice.
//
// A report belongs to the account whose session it was: sent while another
// is signed in, it would settle nothing, so it waits for its own account.

type PendingReport = LiveUsageRequestBody & { userId: string; at: number };

const STORAGE_KEY = "nexdo-live-usage-reports";
const MAX_PENDING = 50;
// The server keeps a session for months; past this, one isn't worth sending.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000];

async function load(): Promise<PendingReport[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as PendingReport[]) : [];
  } catch (error) {
    console.warn("[liveUsageReports] couldn't read the saved reports", error);
    return [];
  }
}

async function save(reports: PendingReport[]) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
  } catch (error) {
    console.warn("[liveUsageReports] couldn't save the reports", error);
  }
}

// One change to the saved list at a time, so a report added mid-send isn't lost.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task);
  chain = next.catch(() => undefined);
  return next;
}

/** Sends this account's waiting reports. Resolves to whether any of them still couldn't be sent. */
export function flushLiveUsageReports(userId: string): Promise<boolean> {
  return serial(async () => {
    const now = Date.now();
    const kept: PendingReport[] = [];
    for (const report of await load()) {
      if (now - report.at > MAX_AGE_MS) continue;
      if (report.userId !== userId) {
        kept.push(report);
        continue;
      }
      try {
        await apiPost("/api/live-usage", { sessionId: report.sessionId, seconds: report.seconds } satisfies LiveUsageRequestBody);
      } catch (error) {
        console.warn("[liveUsageReports] couldn't report listening time yet", error);
        kept.push(report);
      }
    }
    await save(kept);
    return kept.some((report) => report.userId === userId);
  });
}

/** Saves a session's report and sends it — again a few times, and at the next sign-in, until it gets through. */
export async function reportLiveUsage(userId: string, report: LiveUsageRequestBody): Promise<void> {
  await serial(async () => {
    const others = (await load()).filter((pending) => pending.sessionId !== report.sessionId);
    await save([...others, { ...report, userId, at: Date.now() }].slice(-MAX_PENDING));
  });
  if (!(await flushLiveUsageReports(userId))) return;
  for (const delay of RETRY_DELAYS_MS) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (!(await flushLiveUsageReports(userId))) return;
  }
}
