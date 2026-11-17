-- Free vs Pro monthly allowances (2026-10-01).
--
-- The same statements as the ai_plan_usage block in supabase/schema.sql, for
-- anyone applying changes one migration at a time. Running either one is
-- enough; both are safe to re-run.

-- ---------------------------------------------------------------------
-- ai_plan_usage: what each account has used of its plan this month
-- ---------------------------------------------------------------------
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
-- Returns the month's total afterwards, or -1 when p_limit was already
-- reached and nothing was spent. The last use of a month may run past the
-- limit (a 40-second voice note with 10 seconds left still goes through);
-- the one after it is refused.
--   p_amount 0     only asks: is there anything left? (returns what's used)
--   p_limit null   records the use with no limit (Live voice reports its
--                  seconds once a session is over)
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
  v_used int;
begin
  delete from ai_plan_usage where month < (v_month - interval '2 months')::date;

  -- A plan that doesn't include the meter at all (Live voice on Free).
  if p_limit is not null and p_limit <= 0 then
    return -1;
  end if;

  insert into ai_plan_usage (user_id, meter, month, used)
  values (p_user_id, p_meter, v_month, greatest(v_amount, 0))
  on conflict (user_id, meter, month) do update
    set used = greatest(ai_plan_usage.used + v_amount, 0)
    where p_limit is null or ai_plan_usage.used < p_limit
  returning used into v_used;

  -- No row comes back when the limit stopped the update.
  return coalesce(v_used, -1);
end;
$$;

revoke all on function public.claim_ai_plan_usage(text, text, int, int) from public, anon, authenticated;
grant execute on function public.claim_ai_plan_usage(text, text, int, int) to service_role;
