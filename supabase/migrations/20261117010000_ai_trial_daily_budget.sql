create table if not exists public.ai_trial_daily_usage (
  usage_date date not null,
  ip_hash text not null,
  calls int not null default 0,
  primary key (usage_date, ip_hash)
);

create index if not exists ai_trial_daily_usage_date_idx on public.ai_trial_daily_usage (usage_date);

alter table public.ai_trial_daily_usage enable row level security;
revoke all on public.ai_trial_daily_usage from public, anon, authenticated;

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
  v_ip_calls int;
  v_daily_calls int;
  v_day date := (now() at time zone 'utc')::date;
begin
  delete from ai_trials where created_at < now() - interval '90 days';

  select calls into v_calls from ai_trials where trial_id = p_trial_id for update;

  if not found then
    perform pg_advisory_xact_lock(hashtext('claim_ai_trial_call'));
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

  perform pg_advisory_xact_lock(hashtext('claim_ai_trial_daily'));
  select calls into v_ip_calls from ai_trial_daily_usage
  where usage_date = v_day and ip_hash = p_ip_hash
  for update;
  if coalesce(v_ip_calls, 0) >= p_ip_daily_limit then
    return 'ip_limit';
  end if;
  select coalesce(sum(calls), 0) into v_daily_calls
  from ai_trial_daily_usage where usage_date = v_day;
  if v_daily_calls >= p_global_daily_limit then
    return 'global_limit';
  end if;

  insert into ai_trial_daily_usage (usage_date, ip_hash, calls)
  values (v_day, p_ip_hash, 1)
  on conflict (usage_date, ip_hash) do update
    set calls = ai_trial_daily_usage.calls + 1;

  update ai_trials
  set calls = jsonb_set(calls, array[p_route], to_jsonb(v_used + 1))
  where trial_id = p_trial_id;
  return 'ok';
end;
$$;

revoke all on function public.claim_ai_trial_call(text, text, text, int, int, int) from public, anon, authenticated;
grant execute on function public.claim_ai_trial_call(text, text, text, int, int, int) to service_role;

create extension if not exists pg_cron;

select cron.unschedule(jobid)
from cron.job
where jobname = 'delete-expired-ai-trial-daily-usage';

select cron.schedule(
  'delete-expired-ai-trial-daily-usage',
  '0 3 * * *',
  $$delete from public.ai_trial_daily_usage where usage_date < (now() at time zone 'utc')::date;$$
);
