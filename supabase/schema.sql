-- Run this in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query).
-- Requires Clerk to already be added as a Third-Party Auth provider under
-- Authentication -> Sign In / Providers, so that auth.jwt() is populated
-- from the Clerk-issued bearer token sent by the app.

-- ---------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------
create table if not exists public.tasks (
  id text primary key,
  user_id text not null,
  title text not null,
  status text not null,
  due_date timestamptz,
  estimated_minutes int not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  notes text,
  subtasks jsonb,
  current_step_id text,
  priority_score int not null default 0,
  suitability_score int not null default 0,
  importance int not null default 0,
  complexity text not null,
  ai_context jsonb not null default '{"notes":[]}'::jsonb,
  skip jsonb,
  completed_at timestamptz
);

-- Categories were removed from the app. A database created before that still
-- has a NOT NULL "category" column, which would reject every task the app
-- writes — drop it. Safe to re-run on a fresh database.
alter table public.tasks drop column if exists category;

create index if not exists tasks_user_id_idx on public.tasks (user_id);

alter table public.tasks enable row level security;

drop policy if exists "tasks_owner_all" on public.tasks;
create policy "tasks_owner_all" on public.tasks
  for all
  using (user_id = (auth.jwt() ->> 'sub'))
  with check (user_id = (auth.jwt() ->> 'sub'));

-- ---------------------------------------------------------------------
-- chat_messages
-- ---------------------------------------------------------------------
create table if not exists public.chat_messages (
  id text primary key,
  user_id text not null,
  role text not null,
  text text not null,
  created_at timestamptz not null,
  -- An array of attachments (one message can carry several files). Rows
  -- written before multi-attachment support hold a single object instead,
  -- which the client still reads — see fromMessageRow in lib/supabaseSync.ts.
  attachment jsonb,
  related_task_id text
);

create index if not exists chat_messages_user_id_idx on public.chat_messages (user_id);

alter table public.chat_messages enable row level security;

drop policy if exists "chat_messages_owner_all" on public.chat_messages;
create policy "chat_messages_owner_all" on public.chat_messages
  for all
  using (user_id = (auth.jwt() ->> 'sub'))
  with check (user_id = (auth.jwt() ->> 'sub'));

-- ---------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- Storage: private bucket for chat attachments, one folder per user
-- (objects are stored as "<clerk_user_id>/<filename>")
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('chat-attachments', 'chat-attachments', false)
on conflict (id) do nothing;

drop policy if exists "chat_attachments_owner_select" on storage.objects;
create policy "chat_attachments_owner_select" on storage.objects
  for select
  using (bucket_id = 'chat-attachments' and (storage.foldername(name))[1] = (auth.jwt() ->> 'sub'));

drop policy if exists "chat_attachments_owner_insert" on storage.objects;
create policy "chat_attachments_owner_insert" on storage.objects
  for insert
  with check (bucket_id = 'chat-attachments' and (storage.foldername(name))[1] = (auth.jwt() ->> 'sub'));

drop policy if exists "chat_attachments_owner_update" on storage.objects;
create policy "chat_attachments_owner_update" on storage.objects
  for update
  using (bucket_id = 'chat-attachments' and (storage.foldername(name))[1] = (auth.jwt() ->> 'sub'));

drop policy if exists "chat_attachments_owner_delete" on storage.objects;
create policy "chat_attachments_owner_delete" on storage.objects
  for delete
  using (bucket_id = 'chat-attachments' and (storage.foldername(name))[1] = (auth.jwt() ->> 'sub'));
