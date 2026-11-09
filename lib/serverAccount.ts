// Server-only: imported exclusively by app/api/delete-account+api.ts.
//
// Deleting an account, done by the server rather than the phone. The phone
// used to do it step by step with the user's own token — which RLS needs —
// and only then ask Clerk to delete the user. Clerk can refuse that last
// step (the instance's "users can delete their account" setting, a session
// that needs re-verifying), and the user was left signed in to an empty
// account. Here every step uses the server's own keys, so nothing depends on
// the session, and Clerk's backend API deletes the user whatever those
// settings say.
//
// Data first, account last: if anything fails, the account still exists, the
// user is still signed in, and trying again finishes the job — every step is
// safe to repeat. The other way round, a failure would leave data behind with
// no account left to delete it from.
//
// What goes is what the privacy policy and the delete-account page promise:
// tasks, the Assistant conversation, attachments, app feedback with its
// screenshots, and the account itself. The monthly usage counts (numbers
// only) expire on their own within three months, as the policy says.
import { createClerkClient } from "@clerk/backend";

import { deleteServerRows, emptyServerFolder } from "@/lib/serverRpc";

/** The storage buckets laid out one folder per user ("<clerk_user_id>/<file>"). */
const USER_FOLDER_BUCKETS = ["chat-attachments", "feedback-screenshots"] as const;

/** Tables whose rows belong to one account, by its Clerk user id in `user_id`. */
const USER_TABLES = ["feedback", "chat_messages", "tasks"] as const;

/** The account's data in Supabase: files first, so no message is left pointing at one. */
export async function deleteAccountData(userId: string): Promise<void> {
  for (const bucket of USER_FOLDER_BUCKETS) await emptyServerFolder(bucket, userId);
  for (const table of USER_TABLES) await deleteServerRows(table, { user_id: `eq.${userId}` });
}

/** The Clerk user. Already gone counts as done, so a retry after a lost answer doesn't fail. */
export async function deleteClerkUser(userId: string): Promise<void> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY is not set");
  try {
    await createClerkClient({ secretKey }).users.deleteUser(userId);
  } catch (error) {
    if ((error as { status?: number } | null)?.status === 404) return;
    throw error;
  }
}
