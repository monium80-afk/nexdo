-- Chat attachment limits (2026-10-04).
--
-- The same statement as in supabase/schema.sql, for anyone applying changes
-- one migration at a time. Safe to re-run.
--
-- The chat-attachments bucket had no limits of its own: the app only uploads
-- photos, voice notes and documents up to 6 MB (lib/supabaseStorage.ts), but
-- a modified client could have stored anything, of any size, in its own
-- folder. Now the bucket refuses the rest itself, like feedback-screenshots.
-- Files already stored are not touched.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-attachments',
  'chat-attachments',
  false,
  6291456,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'audio/aac', 'audio/mp4', 'audio/m4a', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm',
    'application/pdf', 'text/plain', 'text/csv', 'text/markdown'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
