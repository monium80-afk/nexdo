// Stands in for lib/api.ts: a test decides what "/api/inbox" answers, and can
// look at exactly what the app sent it.
type Handler = (path: string, body: unknown) => unknown;

let handler: Handler = () => {
  throw new Error("no API handler set for this test");
};

export const apiCalls: { path: string; body: unknown }[] = [];

export function setApiHandler(next: Handler) {
  handler = next;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  apiCalls.push({ path, body });
  return handler(path, body) as T;
}

export function setApiTokenGetter() {}
