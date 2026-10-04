-- AI spending limits (2026-09-29).
--
-- The same statements as the ai_trials and ai_usage blocks in
-- supabase/schema.sql, for anyone applying changes one migration at a time.
-- Running either one is enough; both are safe to re-run.
--
--  - ai_trials / claim_ai_trial_call: the signed-out onboarding trial, in full
--    (the table was first added to schema.sql only). The function now admits
--    new trial ids one at a time, so a burst of them can't all get past the
--    per-IP and per-day ceilings together.
--  - ai_usage / claim_ai_user_call: new — a daily ceiling on each signed-in
--    account's AI calls (lib/aiUsageLimit.ts).

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
