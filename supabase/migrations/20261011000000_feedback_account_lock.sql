-- 2026-10-11: one feedback submission per account at a time.
--
-- The app's rate limit (10 an hour per account) counted the account's
-- feedback rows before inserting, so several inserts sent at the same moment
-- could each count fewer than ten and all go in. An advisory lock per account
-- now makes them take turns, as the website's submissions already did.
--
-- Only the trigger function changes (create or replace): the table, its
-- policies and the trigger itself stay as they are. Safe to run more than once.
-- Mirrors supabase/schema.sql.

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

    -- One submission per account at a time, like the website's lock below,
    -- so parallel inserts can't all count fewer than ten.
    if new.user_id is not null then
      perform pg_advisory_xact_lock(hashtext('feedback_mobile_insert:' || new.user_id));
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
