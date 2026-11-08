create table if not exists public.planner_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  tasks jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.planner_data enable row level security;

grant select, insert, update on public.planner_data to authenticated;

drop policy if exists "Users can read their own planner data" on public.planner_data;
create policy "Users can read their own planner data"
  on public.planner_data for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own planner data" on public.planner_data;
create policy "Users can create their own planner data"
  on public.planner_data for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own planner data" on public.planner_data;
create policy "Users can update their own planner data"
  on public.planner_data for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'planner_data'
    ) then
    alter publication supabase_realtime add table public.planner_data;
  end if;
end
$$;
