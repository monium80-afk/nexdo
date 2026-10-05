// The slice of expo-web-browser that lib/authSession.ts calls.

/** How many times an open sign-in sheet was closed, for a test to look at. */
export const dismissCalls = { count: 0 };

export function dismissAuthSession() {
  dismissCalls.count += 1;
}

export function maybeCompleteAuthSession() {
  return { type: "failed", message: "Not supported on this platform" };
}
