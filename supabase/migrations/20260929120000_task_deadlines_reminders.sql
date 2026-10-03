-- Task lifecycle, deadlines and reminders (2026-09-29).
--
-- The same statements as the matching block in supabase/schema.sql, for
-- anyone applying changes one migration at a time. Running either one is
-- enough; both are safe to re-run. Additive only: every column is nullable,
-- no existing row is rewritten, and the constraints are NOT VALID (checked on
-- new writes only). Row Level Security is unchanged: the existing
-- "tasks_owner_all" policy already covers every column of public.tasks.

-- The unique occurrence index below needs the repeating-task column from the
-- 2026-09-27 change; a no-op where it's already there.
alter table public.tasks add column if not exists recurrence jsonb;

alter table public.tasks add column if not exists deadline_date date;
alter table public.tasks add column if not exists deadline_time time;
alter table public.tasks add column if not exists deadline_timezone text;
alter table public.tasks add column if not exists reminder_settings jsonb;
alter table public.tasks add column if not exists pinned_at timestamptz;
alter table public.tasks add column if not exists closed_at timestamptz;

do $$
begin
  alter table public.tasks add constraint tasks_status_check
    check (status in ('pending', 'completed', 'skipped', 'archived')) not valid;
exception when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.tasks add constraint tasks_deadline_time_needs_date
    check (deadline_time is null or deadline_date is not null) not valid;
exception when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.tasks add constraint tasks_importance_range
    check (importance between 0 and 100) not valid;
exception when duplicate_object then null;
end
$$;

create index if not exists tasks_user_status_idx on public.tasks (user_id, status);
create index if not exists tasks_user_deadline_idx on public.tasks (user_id, deadline_date)
  where deadline_date is not null;

do $$
begin
  create unique index if not exists tasks_series_occurrence_unique
    on public.tasks (user_id, (recurrence ->> 'seriesId'), (recurrence ->> 'occurrenceDate'))
    where recurrence is not null;
exception when unique_violation then
  raise notice 'tasks_series_occurrence_unique not created: duplicate occurrences exist';
end
$$;
