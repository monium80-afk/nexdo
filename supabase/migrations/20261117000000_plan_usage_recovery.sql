create table if not exists public.ai_plan_usage_claims (
  claim_id uuid primary key,
  user_id text not null,
  meter text not null,
  month date not null,
  amount int not null,
  result int not null,
  refunded boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists ai_plan_usage_claims_month_idx
  on public.ai_plan_usage_claims (month);

alter table public.ai_plan_usage_claims enable row level security;
revoke all on public.ai_plan_usage_claims from public, anon, authenticated;

drop function if exists public.claim_ai_plan_usage(text, text, int, int);

create or replace function public.claim_ai_plan_usage(
  p_user_id text,
  p_meter text,
  p_amount int,
  p_limit int,
  p_claim_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_amount int := coalesce(p_amount, 0);
  v_needed int := greatest(coalesce(p_amount, 0), 1);
  v_used int;
  v_claim ai_plan_usage_claims%rowtype;
begin
  if p_claim_id is null or p_user_id is null or p_meter is null or v_amount < 0 then
    raise exception 'Invalid plan usage claim';
  end if;

  delete from ai_plan_usage where month < (v_month - interval '2 months')::date;
  delete from ai_plan_usage_claims where month < (v_month - interval '2 months')::date;

  perform pg_advisory_xact_lock(hashtext('claim_ai_plan_usage:' || p_claim_id::text));
  select * into v_claim from ai_plan_usage_claims where claim_id = p_claim_id for update;
  if found then
    if v_claim.user_id <> p_user_id or v_claim.meter <> p_meter or v_claim.amount <> v_amount then
      raise exception 'Plan usage claim identifier was reused with different details';
    end if;
    return jsonb_build_object('result', v_claim.result, 'month', v_claim.month, 'claim_id', v_claim.claim_id);
  end if;

  if p_limit is not null and v_needed > p_limit then
    v_used := -1;
  else
    insert into ai_plan_usage (user_id, meter, month, used)
    values (p_user_id, p_meter, v_month, greatest(v_amount, 0))
    on conflict (user_id, meter, month) do update
      set used = ai_plan_usage.used + v_amount
      where p_limit is null or ai_plan_usage.used + v_needed <= p_limit
    returning used into v_used;
    v_used := coalesce(v_used, -1);
  end if;

  insert into ai_plan_usage_claims (claim_id, user_id, meter, month, amount, result)
  values (p_claim_id, p_user_id, p_meter, v_month, v_amount, v_used);

  return jsonb_build_object('result', v_used, 'month', v_month, 'claim_id', p_claim_id);
end;
$$;

revoke all on function public.claim_ai_plan_usage(text, text, int, int, uuid) from public, anon, authenticated;
grant execute on function public.claim_ai_plan_usage(text, text, int, int, uuid) to service_role;

create or replace function public.refund_ai_plan_usage(
  p_claim_id uuid,
  p_user_id text,
  p_meter text,
  p_amount int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim ai_plan_usage_claims%rowtype;
begin
  select * into v_claim
  from ai_plan_usage_claims
  where claim_id = p_claim_id
  for update;

  if not found then
    return false;
  end if;
  if v_claim.user_id <> p_user_id or v_claim.meter <> p_meter or v_claim.amount <> p_amount then
    raise exception 'Plan usage refund does not match its claim';
  end if;
  if v_claim.result < 0 then
    return false;
  end if;
  if v_claim.refunded then
    return true;
  end if;

  update ai_plan_usage
  set used = greatest(used - v_claim.amount, 0)
  where user_id = v_claim.user_id and meter = v_claim.meter and month = v_claim.month;
  if not found then
    return false;
  end if;

  update ai_plan_usage_claims set refunded = true where claim_id = p_claim_id;
  return true;
end;
$$;

revoke all on function public.refund_ai_plan_usage(uuid, text, text, int) from public, anon, authenticated;
grant execute on function public.refund_ai_plan_usage(uuid, text, text, int) to service_role;

alter table public.ai_live_sessions
  add column if not exists token_issued boolean not null default true;
alter table public.ai_live_sessions
  alter column token_issued set default false;

create or replace function public.mark_ai_live_session_token_issued(
  p_user_id text,
  p_session_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_issued boolean;
begin
  update ai_live_sessions
  set token_issued = true
  where id = p_session_id and user_id = p_user_id and not settled;
  if found then
    return true;
  end if;

  select token_issued into v_issued
  from ai_live_sessions
  where id = p_session_id and user_id = p_user_id;
  return coalesce(v_issued, false);
end;
$$;

revoke all on function public.mark_ai_live_session_token_issued(text, uuid) from public, anon, authenticated;
grant execute on function public.mark_ai_live_session_token_issued(text, uuid) to service_role;

create extension if not exists pg_cron;

select cron.unschedule(jobid)
from cron.job
where jobname = 'settle-unissued-ai-live-sessions';

select cron.schedule(
  'settle-unissued-ai-live-sessions',
  '*/5 * * * *',
  $$select public.settle_ai_live_session(user_id, id, 0)
    from public.ai_live_sessions
    where not settled and not token_issued and created_at < now() - interval '15 minutes';$$
);
