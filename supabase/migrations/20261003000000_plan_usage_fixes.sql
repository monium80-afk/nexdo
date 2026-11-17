-- Plan usage fixes (2026-10-03).
--
-- The same statements as in supabase/schema.sql, for anyone applying changes
-- one migration at a time. Needs 20261001000000_plan_usage.sql (or
-- schema.sql) to have run first. Safe to re-run.
--
-- 1. claim_ai_plan_usage only lets a request through when it fits in what is
--    left of the month. It used to check only that something was left, so a
--    15-minute voice note with one second to go still went through.
-- 2. Live voice ("Magic mic") sessions are paid for when they open
--    (start_ai_live_session), and given back what the app then reports they
--    didn't use (settle_ai_live_session). Before, a session only counted if
--    the app reported it, so one it never reported was free.

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
