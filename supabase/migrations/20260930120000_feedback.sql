-- Feedback from the app (signed in) and the public website (anonymous), in
-- one table. The same statements are in supabase/schema.sql. Safe to re-run.
--
-- Nobody can read feedback back through the API — not the sender, not anyone
-- else. Read it in the Supabase dashboard (Table Editor → feedback), or with
-- the secret key on a server.

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  -- The Clerk user id for app feedback, set by the trigger below from the
  -- verified token — never taken from the request. Null for the website.
  user_id text,
  source text not null check (source in ('mobile_app', 'website')),
  feedback_type text not null check (feedback_type in ('suggestion', 'bug', 'general', 'other')),
  message text not null check (char_length(btrim(message)) between 1 and 5000),
  details text check (details is null or char_length(details) <= 10000),
  -- Website only, and only if the visitor gave one. App feedback is linked to
  -- the account instead (look the email up in Clerk by user_id).
  contact_email text check (
    contact_email is null or
    (char_length(contact_email) <= 254 and contact_email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$')
  ),
  -- A path in the private feedback-screenshots bucket: "<user_id>/<file>".
  screenshot_path text check (
    screenshot_path is null or
    (char_length(screenshot_path) <= 300 and screenshot_path ~ '^[^/]+/[A-Za-z0-9._-]+$')
  ),
  app_version text check (app_version is null or char_length(app_version) <= 50),
  platform text check (platform is null or platform in ('ios', 'android', 'web')),
  status text not null default 'new' check (status in ('new', 'reviewing', 'resolved')),
  created_at timestamptz not null default now(),
  constraint feedback_source_user_check check (
    (source = 'mobile_app' and user_id is not null) or
    (source = 'website' and user_id is null and screenshot_path is null)
  )
);

create index if not exists feedback_created_at_idx on public.feedback (created_at desc);
create index if not exists feedback_user_id_idx on public.feedback (user_id, created_at desc)
  where user_id is not null;
create index if not exists feedback_status_idx on public.feedback (status, created_at desc);

-- Website rate limiting. A row is a SHA-256 hash of the sender's IP address
-- (never the IP itself) and when they sent something. Kept one day. Only the
-- trigger below touches it: RLS on, no policies, no grants.
create table if not exists public.feedback_rate_limits (
  ip_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists feedback_rate_limits_ip_idx on public.feedback_rate_limits (ip_hash, created_at);
create index if not exists feedback_rate_limits_created_at_idx on public.feedback_rate_limits (created_at);

alter table public.feedback_rate_limits enable row level security;
revoke all on public.feedback_rate_limits from anon, authenticated;

-- Runs before every insert, ahead of the RLS checks:
--   * app feedback gets the sender's user id from their Clerk token, so a
--     client can't file feedback under someone else's account;
--   * a screenshot has to sit in the sender's own folder;
--   * rate limits: 10 an hour per account; 5 an hour per IP and 300 a day in
--     total from the website. Over a limit, the API answers 429.
create or replace function public.feedback_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  v_ip text;
  v_ip_hash text;
begin
  new.contact_email := nullif(btrim(new.contact_email), '');
  new.details := nullif(btrim(new.details), '');
  new.message := btrim(new.message);

  if new.source = 'mobile_app' then
    new.user_id := auth.jwt() ->> 'sub';

    if new.screenshot_path is not null and split_part(new.screenshot_path, '/', 1) is distinct from new.user_id then
      raise exception 'screenshot_path must be in the sender''s own folder';
    end if;

    if new.user_id is not null and (
      select count(*) from feedback
      where user_id = new.user_id and created_at > now() - interval '1 hour'
    ) >= 10 then
      raise sqlstate 'PGRST' using
        message = '{"code":"rate_limited","message":"Too much feedback in a short time.","details":null,"hint":"Try again later."}',
        detail = '{"status":429,"headers":{}}';
    end if;

    return new;
  end if;

  new.user_id := null;

  -- Supabase sits behind Cloudflare, which sets cf-connecting-ip itself (a
  -- client can't forge it). The others are fallbacks; the first entry of
  -- x-forwarded-for can be forged, which the daily total still caps.
  v_ip := coalesce(
    nullif(v_headers ->> 'cf-connecting-ip', ''),
    nullif(v_headers ->> 'x-real-ip', ''),
    nullif(btrim(split_part(v_headers ->> 'x-forwarded-for', ',', 1)), '')
  );
  -- No address at all (e.g. an insert from the SQL editor): only the daily
  -- total applies, rather than everyone sharing one per-IP allowance.
  v_ip_hash := coalesce(encode(sha256(convert_to(v_ip, 'UTF8')), 'hex'), 'unknown');

  -- One website submission at a time, so a burst can't all count the table
  -- before any of them is recorded.
  perform pg_advisory_xact_lock(hashtext('feedback_website_insert'));
  delete from feedback_rate_limits where created_at < now() - interval '1 day';

  if (v_ip is not null and (
    select count(*) from feedback_rate_limits
    where ip_hash = v_ip_hash and created_at > now() - interval '1 hour'
  ) >= 5) or (
    select count(*) from feedback_rate_limits
  ) >= 300 then
    raise sqlstate 'PGRST' using
      message = '{"code":"rate_limited","message":"Too many messages in a short time.","details":null,"hint":"Try again later."}',
      detail = '{"status":429,"headers":{}}';
  end if;

  insert into feedback_rate_limits (ip_hash) values (v_ip_hash);
  return new;
end;
$$;

revoke all on function public.feedback_before_insert() from public, anon, authenticated;

drop trigger if exists feedback_before_insert on public.feedback;
create trigger feedback_before_insert
  before insert on public.feedback
  for each row execute function public.feedback_before_insert();

-- Insert-only. The trigger has already set user_id when these are checked.
alter table public.feedback enable row level security;

drop policy if exists "feedback_mobile_insert_own" on public.feedback;
create policy "feedback_mobile_insert_own" on public.feedback
  for insert to authenticated
  with check (source = 'mobile_app' and user_id = (auth.jwt() ->> 'sub'));

drop policy if exists "feedback_website_insert_anonymous" on public.feedback;
create policy "feedback_website_insert_anonymous" on public.feedback
  for insert to anon
  with check (source = 'website' and user_id is null);

-- Column grants: user_id, status, id and created_at can't be written by
-- anyone but the database; the website can't send app-only fields.
revoke all on public.feedback from anon, authenticated;
grant insert (source, feedback_type, message, details, screenshot_path, app_version, platform)
  on public.feedback to authenticated;
grant insert (source, feedback_type, message, contact_email)
  on public.feedback to anon;

-- Account deletion (components/AccountSheet.tsx) removes the account's
-- feedback along with everything else. Users can't select or delete feedback
-- directly, so this is the one way in, and it only ever touches their own rows.
create or replace function public.delete_my_feedback()
returns void
language sql
security definer
set search_path = public
as $$
  delete from feedback where user_id = (auth.jwt() ->> 'sub');
$$;

revoke all on function public.delete_my_feedback() from public, anon;
grant execute on function public.delete_my_feedback() to authenticated;

-- Screenshots attached to app feedback: a private bucket, one folder per
-- user ("<clerk_user_id>/<file>"), images only, 5 MB each. Users can add to
-- and clear out their own folder (account deletion); nothing is public.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feedback-screenshots',
  'feedback-screenshots',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "feedback_screenshots_owner_insert" on storage.objects;
create policy "feedback_screenshots_owner_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'feedback-screenshots' and (storage.foldername(name))[1] = (auth.jwt() ->> 'sub'));

drop policy if exists "feedback_screenshots_owner_select" on storage.objects;
create policy "feedback_screenshots_owner_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'feedback-screenshots' and (storage.foldername(name))[1] = (auth.jwt() ->> 'sub'));

drop policy if exists "feedback_screenshots_owner_delete" on storage.objects;
create policy "feedback_screenshots_owner_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'feedback-screenshots' and (storage.foldername(name))[1] = (auth.jwt() ->> 'sub'));
