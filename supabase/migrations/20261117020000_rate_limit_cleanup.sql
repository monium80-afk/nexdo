create extension if not exists pg_cron;

select cron.unschedule(jobid)
from cron.job
where jobname in ('delete-expired-feedback-account-rate-limits', 'delete-expired-feedback-rate-limits');

select cron.schedule(
  'delete-expired-feedback-account-rate-limits',
  '5 * * * *',
  $$delete from public.feedback_account_rate_limits where created_at < now() - interval '1 hour';$$
);

select cron.schedule(
  'delete-expired-feedback-rate-limits',
  '0 4 * * *',
  $$delete from public.feedback_rate_limits where created_at < now() - interval '1 day';$$
);
