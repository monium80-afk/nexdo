create extension if not exists pg_cron;

select cron.unschedule(jobid)
from cron.job
where jobname = 'delete-expired-ai-trials';

select cron.schedule(
  'delete-expired-ai-trials',
  '0 3 * * *',
  $$delete from public.ai_trials where created_at < now() - interval '90 days';$$
);

select cron.unschedule(jobid)
from cron.job
where jobname = 'delete-expired-ai-trial-daily-usage';

select cron.schedule(
  'delete-expired-ai-trial-daily-usage',
  '0 3 * * *',
  $$delete from public.ai_trial_daily_usage where usage_date < (now() at time zone 'utc')::date;$$
);
