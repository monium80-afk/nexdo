import Constants from "expo-constants";
import { Platform } from "react-native";

import { getTrialId } from "@/lib/aiTrial";
import { isPlanLimitBody, PLAN_HEADER, PlanLimitError } from "@/lib/plan";
import { useSubscriptionStore } from "@/store/useSubscriptionStore";

// Expo Router API routes (app/api/**/+api.ts) are served by the same Metro
// dev server as the app. On web that's same-origin, so a relative fetch
// works. On native there's no "origin" to resolve against, so we build an
// absolute URL from the dev server's host — or from EXPO_PUBLIC_API_URL in
// a production build, where there is no dev server to ask.
function getBaseUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  if (Platform.OS === "web") return "";
  const hostUri = Constants.expoConfig?.hostUri;
  return hostUri ? `http://${hostUri}` : "";
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

// The API routes verify a Clerk session JWT (see lib/serverAuth.ts), so every
// request needs a fresh one. Same indirection as lib/supabase.ts: Clerk's
// getToken() only exists inside a component tree, so it's handed down once
// from a component that has useAuth() (see hooks/useAuthSync.ts) rather than
// making every caller of apiPost pass a token through.
let getClerkToken: (() => Promise<string | null>) | null = null;

export function setApiTokenGetter(fn: () => Promise<string | null>) {
  getClerkToken = fn;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = getClerkToken ? await getClerkToken() : null;
  if (token) {
    // Pro gets Pro's monthly allowance. The server checks the claim with
    // RevenueCat itself (lib/serverPlan.ts) — this only tells it to look.
    const isPro = useSubscriptionStore.getState().pro !== null;
    return { Authorization: `Bearer ${token}`, ...(isPro ? { [PLAN_HEADER]: "pro" } : {}) };
  }
  // Signed out, the only AI anyone gets is onboarding's one free run, which
  // the server counts against this install's trial id.
  return { "X-Nexdo-Trial": await getTrialId() };
}

function parsePlanLimit(detail: string): PlanLimitError | null {
  try {
    const body: unknown = JSON.parse(detail);
    return isPlanLimitBody(body) ? new PlanLimitError(body.meter, body.plan) : null;
  } catch {
    return null;
  }
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", forwardAbort);
  }

  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${getBaseUrl()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      // The body carries the route's own reason (see the `error` field on
      // app/api/extract-text+api.ts). Without it a failure reaches the caller
      // as a bare status code, which says that something broke but never what.
      const detail = await response.text().catch(() => "");
      // The month's allowance is used up (lib/serverPlan.ts). Its own error,
      // so callers can say that instead of "the AI is unreachable".
      if (response.status === 429) {
        const limit = parsePlanLimit(detail);
        if (limit) throw limit;
      }
      throw new Error(`${path} failed: ${response.status}${detail ? ` ${detail.slice(0, 300)}` : ""}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", forwardAbort);
  }
}
