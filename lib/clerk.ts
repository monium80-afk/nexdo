import { isClerkAPIResponseError, isClerkRuntimeError } from "@clerk/expo";

export { tokenCache } from "@clerk/expo/token-cache";

export const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

if (!publishableKey) {
  throw new Error("Add EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY to your .env file");
}

type ClerkErrorDetails = {
  code: string | null;
  longMessage: string | null;
  status: number | null;
};

/**
 * The readable parts of an error Clerk threw. A Clerk error's own `message`
 * can be empty, so error reports and on-screen messages read these instead.
 */
export function clerkErrorDetails(err: unknown): ClerkErrorDetails {
  if (isClerkAPIResponseError(err)) {
    const first = err.errors[0];
    return {
      code: first?.code ?? null,
      longMessage: first?.longMessage ?? first?.message ?? null,
      status: err.status,
    };
  }
  if (isClerkRuntimeError(err)) {
    return { code: err.code, longMessage: err.message || null, status: null };
  }
  return { code: null, longMessage: null, status: null };
}
