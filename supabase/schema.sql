-- Run this in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query).
-- Requires Clerk to already be added as a Third-Party Auth provider under
-- Authentication -> Sign In / Providers, so that auth.jwt() is populated
-- from the Clerk-issued bearer token sent by the app.

-- ---------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------
create table if not exists public.tasks (
  id text primary key,
  user_id text not null,
  title text not null,
  status text not null,
  due_date timestamptz,
  estimated_minutes int not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  notes text,
  subtasks jsonb,
  current_step_id text,
  priority_score int not null default 0,
  suitability_score int not null default 0,
  importance int not null default 0,
  complexity text not null,
  ai_context jsonb not null default '{"notes":[]}'::jsonb,
  skip jsonb,
  completed_at timestamptz
);

-- Categories were removed from the app. A database created before that still
-- has a NOT NULL "category" column, which would reject every task the app
-- writes — drop it. Safe to re-run on a fresh database.
alter table public.tasks drop column if exists category;

-- Repeating tasks. Set only on occurrences of a series: the rule, the series
-- id, which rule day this occurrence stands for, and the template the next
-- occurrence is built from (types/task.ts TaskRecurrence). Occurrence rows get
-- ids derived from series id + day, so two devices generating the same
-- occurrence write one row. Nullable, so adding it touches no existing row.
alter table public.tasks add column if not exists recurrence jsonb;

create index if not exists tasks_series_id_idx on public.tasks ((recurrence ->> 'seriesId'))
  where recurrence is not null;

create index if not exists tasks_user_id_idx on public.tasks (user_id);

-- Task lifecycle, deadlines and reminders (2026-09-29). Additive only: every
-- column is nullable and no existing row is rewritten. The same statements
-- are in supabase/migrations/20260929120000_task_deadlines_reminders.sql.
--
-- A deadline is stored the way the user gave it: its calendar day, a clock
-- time only when they named one ("Oct 15" has none), and the IANA zone it was
-- given in. due_date stays as the instant it passes (the end of the day for a
-- date-only deadline), for sorting and overdue checks. Rows written before
-- these columns have only due_date; the app reads those as exact deadlines,
-- exactly as it always showed them, and fills the columns in on its next
-- save — there is deliberately no backfill here, since the server can't know
-- which time zone a bare timestamp was meant in.
alter table public.tasks add column if not exists deadline_date date;
alter table public.tasks add column if not exists deadline_time time;
alter table public.tasks add column if not exists deadline_timezone text;
-- Per-task reminder choices on top of the app-wide ones ({"muted": true}).
alter table public.tasks add column if not exists reminder_settings jsonb;
-- Put first on the Next page by the user.
alter table public.tasks add column if not exists pinned_at timestamptz;
-- When the task was archived, or (a repeating task's occurrence) skipped.
alter table public.tasks add column if not exists closed_at timestamptz;

-- The one status lifecycle every feature shares (types/task.ts TaskStatus),
-- and values the app never writes. NOT VALID: checked on every new write,
-- without re-checking rows that are already there.
do $$
begin
  alter table public.tasks add constraint tasks_status_check
    check (status in ('pending', 'completed', 'skipped', 'archived')) not valid;
exception when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.tasks add constraint tasks_deadline_time_needs_date
    check (deadline_time is null or deadline_date is not null) not valid;
exception when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.tasks add constraint tasks_importance_range
    check (importance between 0 and 100) not valid;
exception when duplicate_object then null;
end
$$;

create index if not exists tasks_user_status_idx on public.tasks (user_id, status);
create index if not exists tasks_user_deadline_idx on public.tasks (user_id, deadline_date)
  where deadline_date is not null;

-- A repeating task has at most one row per series and day. Occurrence ids are
-- already derived from both (so two devices write the same row); this makes
-- the database refuse a duplicate even if a bug ever made a different id. If
-- existing data already breaks the rule, the index is skipped with a notice
-- rather than failing the whole script.
do $$
begin
  create unique index if not exists tasks_series_occurrence_unique
    on public.tasks (user_id, (recurrence ->> 'seriesId'), (recurrence ->> 'occurrenceDate'))
    where recurrence is not null;
exception when unique_violation then
  raise notice 'tasks_series_occurrence_unique not created: duplicate occurrences exist';
end
$$;

alter table public.tasks enable row level security;

drop policy if exists "tasks_owner_all" on public.tasks;
create policy "tasks_owner_all" on public.tasks
  for all
  using (user_id = (auth.jwt() ->> 'sub'))
  with check (user_id = (auth.jwt() ->> 'sub'));

-- ---------------------------------------------------------------------
-- chat_messages
-- ---------------------------------------------------------------------
create table if not exists public.chat_messages (
  id text primary key,
  user_id text not null,
  role text not null,
  text text not null,
  created_at timestamptz not null,
  -- An array of attachments (one message can carry several files). Rows
  -- written before multi-attachment support hold a single object instead,
  -- which the client still reads — see fromMessageRow in lib/supabaseSync.ts.
  attachment jsonb,
  related_task_id text
);

create index if not exists chat_messages_user_id_idx on public.chat_messages (user_id);

alter table public.chat_messages enable row level security;

drop policy if exists "chat_messages_owner_all" on public.chat_messages;
create policy "chat_messages_owner_all" on public.chat_messages
  for all
  using (user_id = (auth.jwt() ->> 'sub'))
  with check (user_id = (auth.jwt() ->> 'sub'));

-- ---------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- Storage: private bucket for chat attachments, one folder per user
-- (objects are stored as "<clerk_user_id>/<filename>")
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('chat-attachments', 'chat-attachments', false)
on conflict (id) do nothing;

drop policy if exists "chat_attachments_owner_select" on storage.objects;
create policy "chat_attachments_owner_select" on storage.objects
  for select
  using (bucket_id = 'chat-attachments' and (storage.foldername(name))[1] = (auth.jwt() ->> 'sub'));

drop policy if exists "chat_attachments_owner_insert" on storage.objects;
create policy "chat_attachments_owner_insert" on storage.objects
  for insert
  with check (bucket_id = 'chat-attachments' and (storage.foldername(name))[1] = (auth.jwt() ->> 'sub'));

drop policy if exists "chat_attachments_owner_update" on storage.objects;
create policy "chat_attachments_owner_update" on storage.objects
  for update
  using (bucket_id = 'chat-attachments' and (storage.foldername(name))[1] = (auth.jwt() ->> 'sub'));

drop policy if exists "chat_attachments_owner_delete" on storage.objects;
create policy "chat_attachments_owner_delete" on storage.objects
  for delete
  using (bucket_id = 'chat-attachments' and (storage.foldername(name))[1] = (auth.jwt() ->> 'sub'));

-- ---------------------------------------------------------------------
-- ai_trials: the one free AI run a signed-out person gets in onboarding
-- ---------------------------------------------------------------------
-- Only the app's server touches this (lib/anonymousTrial.ts, with the
-- SUPABASE_SECRET_KEY): RLS is on with no policies, so the app's publishable
-- key can't read or write it, and the function below can only be run by the
-- service role. A row is a random id the app made up on that install plus a
-- SHA-256 hash of the caller's IP — never the IP itself.
create table if not exists public.ai_trials (
  trial_id text primary key,
  ip_hash text not null,
  created_at timestamptz not null default now(),
  -- Calls used per route, e.g. {"inbox": 1, "extract-text": 2}.
  calls jsonb not null default '{}'::jsonb
);

create index if not exists ai_trials_created_at_idx on public.ai_trials (created_at);
create index if not exists ai_trials_ip_hash_created_at_idx on public.ai_trials (ip_hash, created_at);

alter table public.ai_trials enable row level security;

-- Spends one call of p_route for this trial id. Returns 'ok', or why not:
-- 'trial_used' (this id has used its allowance for the route), 'ip_limit'
-- (too many new ids from one IP today) or 'global_limit' (too many new ids
-- today overall). The row lock makes the per-id count exact under parallel
-- requests. New ids are admitted one at a time (the advisory lock below):
-- otherwise a burst of first requests from different ids could all count
-- today's rows before any of them was inserted, and all get past the two
-- daily ceilings together.
create or replace function public.claim_ai_trial_call(
  p_trial_id text,
  p_ip_hash text,
  p_route text,
  p_route_limit int,
  p_ip_daily_limit int,
  p_global_daily_limit int
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_calls jsonb;
  v_used int;
begin
  -- Rows are only needed while they can still limit someone; the privacy
  -- policy promises they go after 90 days. Cheap on the created_at index.
  delete from ai_trials where created_at < now() - interval '90 days';

  select calls into v_calls from ai_trials where trial_id = p_trial_id for update;

  if not found then
    -- Held until this call's transaction ends. Only a first request waits on
    -- it; an id that already has its row never gets here.
    perform pg_advisory_xact_lock(hashtext('claim_ai_trial_call'));
    -- A parallel first request for this same id may have been admitted while
    -- this one waited.
    select calls into v_calls from ai_trials where trial_id = p_trial_id for update;
  end if;

  if not found then
    if (select count(*) from ai_trials
        where ip_hash = p_ip_hash and created_at > now() - interval '1 day') >= p_ip_daily_limit then
      return 'ip_limit';
    end if;
    if (select count(*) from ai_trials
        where created_at > now() - interval '1 day') >= p_global_daily_limit then
      return 'global_limit';
    end if;
    insert into ai_trials (trial_id, ip_hash) values (p_trial_id, p_ip_hash)
    on conflict (trial_id) do nothing;
    select calls into v_calls from ai_trials where trial_id = p_trial_id for update;
  end if;

  v_used := coalesce((v_calls ->> p_route)::int, 0);
  if v_used >= p_route_limit then
    return 'trial_used';
  end if;

  update ai_trials
  set calls = jsonb_set(calls, array[p_route], to_jsonb(v_used + 1))
  where trial_id = p_trial_id;
  return 'ok';
end;
$$;

revoke all on function public.claim_ai_trial_call(text, text, text, int, int, int) from public, anon, authenticated;
grant execute on function public.claim_ai_trial_call(text, text, text, int, int, int) to service_role;

-- ---------------------------------------------------------------------
-- ai_usage: a daily ceiling on each signed-in account's AI calls
-- ---------------------------------------------------------------------
-- Only the app's server touches this (lib/aiUsageLimit.ts), locked down the
-- same way as ai_trials. A row is an account's Clerk user id, an AI route and
-- a UTC day, with how many calls that route took that day — nothing about
-- what was asked. Rows go after 30 days.
create table if not exists public.ai_usage (
  user_id text not null,
  route text not null,
  day date not null,
  calls int not null default 0,
  primary key (user_id, route, day)
);

create index if not exists ai_usage_day_idx on public.ai_usage (day);

alter table public.ai_usage enable row level security;

-- Spends one of this account's calls on p_route today (UTC). True when the
-- call may go ahead, false once today's p_daily_limit is used up. The upsert
-- locks the row, so parallel requests are counted exactly.
create or replace function public.claim_ai_user_call(
  p_user_id text,
  p_route text,
  p_daily_limit int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_calls int;
begin
  delete from ai_usage where day < v_today - 30;

  insert into ai_usage (user_id, route, day, calls)
  values (p_user_id, p_route, v_today, 1)
  on conflict (user_id, route, day) do update
    set calls = ai_usage.calls + 1
    where ai_usage.calls < p_daily_limit
  returning calls into v_calls;

  -- No row comes back when the limit stopped the update.
  return v_calls is not null;
end;
$$;

revoke all on function public.claim_ai_user_call(text, text, int) from public, anon, authenticated;
grant execute on function public.claim_ai_user_call(text, text, int) to service_role;

-- ---------------------------------------------------------------------
-- ai_plan_usage: what each account has used of its plan this month
-- ---------------------------------------------------------------------
-- Same statements as supabase/migrations/20261001000000_plan_usage.sql,
-- with claim_ai_plan_usage as 20261003000000_plan_usage_fixes.sql left it.
-- Only the app's server touches this (lib/serverPlan.ts), locked down the
-- same way as ai_usage: RLS on with no policies, and the function below can
-- only be run by the service role. A row is an account's Clerk user id, a
-- meter (lib/plan.ts: chat, media, voice, live, assist) and a UTC calendar
-- month, with how much of that meter the month has used — messages, files or
-- seconds, never what was asked. Rows go after three months.
create table if not exists public.ai_plan_usage (
  user_id text not null,
  meter text not null,
  month date not null,
  used int not null default 0,
  primary key (user_id, meter, month)
);

create index if not exists ai_plan_usage_month_idx on public.ai_plan_usage (month);

alter table public.ai_plan_usage enable row level security;

-- Spends p_amount of this account's p_meter for the current month (UTC).
-- Returns the month's total afterwards, or -1 when p_amount doesn't fit in
-- what is left of p_limit — nothing is spent then.
--   p_amount 0     only asks: is there anything left? (returns what's used)
--   p_limit null   records the use with no limit
--   p_amount < 0   gives back what a failed request had spent (with
--                  p_limit null); the count never goes below zero
-- The upsert locks the row, so parallel requests are counted exactly.
create or replace function public.claim_ai_plan_usage(
  p_user_id text,
  p_meter text,
  p_amount int,
  p_limit int
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_amount int := coalesce(p_amount, 0);
  -- What has to fit: the amount, or for an "anything left?" ask, one more.
  v_needed int := greatest(coalesce(p_amount, 0), 1);
  v_used int;
begin
  delete from ai_plan_usage where month < (v_month - interval '2 months')::date;

  -- A plan that doesn't include the meter at all (Live voice on Free), or a
  -- request bigger than the whole month's allowance.
  if p_limit is not null and v_needed > p_limit then
    return -1;
  end if;

  insert into ai_plan_usage (user_id, meter, month, used)
  values (p_user_id, p_meter, v_month, greatest(v_amount, 0))
  on conflict (user_id, meter, month) do update
    set used = greatest(ai_plan_usage.used + v_amount, 0)
    where p_limit is null or ai_plan_usage.used + v_needed <= p_limit
  returning used into v_used;

  -- No row comes back when the limit stopped the update.
  return coalesce(v_used, -1);
end;
$$;

revoke all on function public.claim_ai_plan_usage(text, text, int, int) from public, anon, authenticated;
grant execute on function public.claim_ai_plan_usage(text, text, int, int) to service_role;

-- ---------------------------------------------------------------------
-- ai_live_sessions: Live voice sessions, paid for when they open
-- ---------------------------------------------------------------------
-- Same statements as supabase/migrations/20261003000000_plan_usage_fixes.sql.
-- Only the app's server touches this (lib/serverPlan.ts), locked down like
-- ai_plan_usage: RLS on with no policies, functions for the service role
-- only. The audio goes from the phone straight to Google, so this server
-- never hears how long a session ran: it takes the session's time from the
-- month's Live voice allowance when the session opens, and gives back what
-- the app reports it didn't use. A row is a session's id, the account's
-- Clerk user id, the month it was paid from, how many seconds were taken and
-- whether the app has reported back — numbers only. Rows go after three
-- months, like the monthly counts.
create table if not exists public.ai_live_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  month date not null,
  seconds int not null,
  settled boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists ai_live_sessions_month_idx on public.ai_live_sessions (month);

alter table public.ai_live_sessions enable row level security;

-- Opens a session: takes up to p_seconds of this month's Live voice time —
-- no more than is left of p_limit — and records it. Returns
-- {"id": <session id>, "seconds": <seconds taken>}, or null when nothing is
-- left. The usage row is locked first, so parallel sessions can't both take
-- the same last minutes.
create or replace function public.start_ai_live_session(
  p_user_id text,
  p_seconds int,
  p_limit int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_used int;
  v_seconds int;
  v_id uuid;
begin
  delete from ai_live_sessions where month < (v_month - interval '2 months')::date;

  if coalesce(p_seconds, 0) <= 0 or coalesce(p_limit, 0) <= 0 then
    return null;
  end if;

  insert into ai_plan_usage (user_id, meter, month, used)
  values (p_user_id, 'live', v_month, 0)
  on conflict (user_id, meter, month) do nothing;

  select used into v_used from ai_plan_usage
  where user_id = p_user_id and meter = 'live' and month = v_month
  for update;

  v_seconds := least(p_seconds, p_limit - v_used);
  if v_seconds <= 0 then
    return null;
  end if;

  update ai_plan_usage set used = used + v_seconds
  where user_id = p_user_id and meter = 'live' and month = v_month;

  insert into ai_live_sessions (user_id, month, seconds)
  values (p_user_id, v_month, v_seconds)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'seconds', v_seconds);
end;
$$;

revoke all on function public.start_ai_live_session(text, int, int) from public, anon, authenticated;
grant execute on function public.start_ai_live_session(text, int, int) to service_role;

-- Closes a session with the seconds the app says it listened, giving back
-- the rest of what start_ai_live_session took — to the month it was taken
-- from. Once only: a session already closed changes nothing, so a repeated
-- report can't give anything back twice. Returns the seconds given back.
create or replace function public.settle_ai_live_session(
  p_user_id text,
  p_session_id uuid,
  p_seconds int
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date;
  v_seconds int;
  v_refund int;
begin
  update ai_live_sessions set settled = true
  where id = p_session_id and user_id = p_user_id and not settled
  returning month, seconds into v_month, v_seconds;

  if not found then
    return 0;
  end if;

  v_refund := v_seconds - least(greatest(coalesce(p_seconds, 0), 0), v_seconds);
  if v_refund > 0 then
    update ai_plan_usage set used = greatest(used - v_refund, 0)
    where user_id = p_user_id and meter = 'live' and month = v_month;
  end if;
  return v_refund;
end;
$$;

revoke all on function public.settle_ai_live_session(text, uuid, int) from public, anon, authenticated;
grant execute on function public.settle_ai_live_session(text, uuid, int) to service_role;

-- ---------------------------------------------------------------------
-- feedback: the app's Send feedback / Report a problem, and the website's
-- public form. Same statements as
-- supabase/migrations/20260930120000_feedback.sql.
-- ---------------------------------------------------------------------
-- Nobody can read feedback back through the API. Read it in the Supabase
-- dashboard (Table Editor -> feedback), or with the secret key on a server.
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
