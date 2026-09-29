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
-- requests; the two daily ceilings can overshoot by a request or two.
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
