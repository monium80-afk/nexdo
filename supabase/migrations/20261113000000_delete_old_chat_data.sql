-- Deletes the Assistant chat's leftover data (review 2026-11-13).
--
-- The chat was removed on 2026-10-08; nothing in the app reads or writes
-- chat_messages since. The privacy policy says those messages are kept until
-- the account is deleted or the user asks; deleting them all now keeps less
-- personal data than that promise allows. Update the policy's "From earlier
-- versions" line once this has run.
--
-- RUN IT YOURSELF in the Supabase SQL editor (it can't be undone). The table
-- itself stays: account deletion (lib/serverAccount.ts) still lists it, and
-- dropping it is a schema change for another day.
--
-- The chat's attachments are files in Storage, not rows: Supabase deletes a
-- file only through the Storage API, so empty them in the dashboard instead —
-- Storage → chat-attachments → select all → Delete. (Deleting rows from
-- storage.objects in SQL would leave the files themselves behind.)

delete from public.chat_messages;
