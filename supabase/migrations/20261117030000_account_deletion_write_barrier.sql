create table if not exists public.account_deletion_barriers (
  user_id text primary key,
  created_at timestamptz not null default now()
);

alter table public.account_deletion_barriers enable row level security;
revoke all on public.account_deletion_barriers from public, anon, authenticated;

create or replace function public.account_write_allowed()
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user_id text := auth.jwt() ->> 'sub';
begin
  if v_user_id is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext('account-deletion:' || v_user_id));
  return not exists (
    select 1 from account_deletion_barriers where user_id = v_user_id
  );
end;
$$;

revoke all on function public.account_write_allowed() from public, anon, authenticated;
grant execute on function public.account_write_allowed() to authenticated;

create or replace function public.begin_account_deletion(p_user_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'An account id is required to begin deletion';
  end if;

  perform pg_advisory_xact_lock(hashtext('account-deletion:' || p_user_id));
  insert into account_deletion_barriers (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;
  return true;
end;
$$;

revoke all on function public.begin_account_deletion(text) from public, anon, authenticated;
grant execute on function public.begin_account_deletion(text) to service_role;

create or replace function public.feedback_account_deletion_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source = 'mobile_app' and not public.account_write_allowed() then
    raise exception 'Feedback cannot be added while this account is being deleted';
  end if;
  return new;
end;
$$;

revoke all on function public.feedback_account_deletion_guard() from public, anon, authenticated;

drop trigger if exists feedback_account_deletion_guard on public.feedback;
create trigger feedback_account_deletion_guard
  before insert on public.feedback
  for each row execute function public.feedback_account_deletion_guard();

drop policy if exists "feedback_screenshots_owner_insert" on storage.objects;
create policy "feedback_screenshots_owner_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'feedback-screenshots'
    and (storage.foldername(name))[1] = (auth.jwt() ->> 'sub')
    and public.account_write_allowed()
  );
