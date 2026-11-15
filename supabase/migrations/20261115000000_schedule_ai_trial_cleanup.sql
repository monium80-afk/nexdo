create extension if not exists pg_cron;

select cron.unschedule(jobid)
from cron.job
where jobname = 'delete-expired-ai-trials';

select cron.schedule(
  'delete-expired-ai-trials',
  '0 3 * * *',
  $$delete from public.ai_trials where created_at < now() - interval '90 days';$$
);
