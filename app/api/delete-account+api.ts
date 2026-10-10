import { deleteAccountData, deleteClerkUser } from "@/lib/serverAccount";
import { authenticate, unauthorized } from "@/lib/serverAuth";
import { RpcConfigError } from "@/lib/serverRpc";

// Settings → Account → Delete account (components/AccountSheet.tsx). Deletes
// the signed-in account and everything stored for it — see lib/serverAccount.ts
// for what, and in which order.

export type DeleteAccountResponseBody = {
  ok: true;
};

/** Where it stopped, for the app's message: whether anything is already gone. */
export type DeleteAccountErrorBody = {
  error: "delete_failed";
  /** False when the data is gone and only the account itself is left. */
  dataRemains: boolean;
};

export async function POST(request: Request) {
  const auth = await authenticate(request);
  if ("failed" in auth) return auth.failed;
  if (!auth.userId) return unauthorized();

  try {
    await deleteAccountData(auth.userId);
  } catch (error) {
    if (error instanceof RpcConfigError) console.error("[api/delete-account] SUPABASE_SECRET_KEY is missing");
    else console.error("[api/delete-account] couldn't delete the account's data", error);
    // Some of it may be gone: the steps run one after another.
    return Response.json({ error: "delete_failed", dataRemains: true } satisfies DeleteAccountErrorBody, { status: 502 });
  }

  try {
    await deleteClerkUser(auth.userId);
  } catch (error) {
    console.error("[api/delete-account] data deleted, but Clerk didn't delete the user", error);
    return Response.json({ error: "delete_failed", dataRemains: false } satisfies DeleteAccountErrorBody, { status: 502 });
  }

  return Response.json({ ok: true } satisfies DeleteAccountResponseBody);
}
