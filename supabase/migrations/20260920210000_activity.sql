-- Ruch: kroki i treningi z zegarka albo wpisane ręcznie.
-- Na tej podstawie liczymy rzeczywistą aktywność zamiast deklarowanej średniej z profilu.

create type public.activity_kind as enum ('steps', 'workout');
create type public.activity_source as enum ('manual', 'strava', 'health');

create table public.activity_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  kind public.activity_kind not null,
  -- dla kind = 'steps'
  steps integer check (steps between 0 and 100000),
  -- dla kind = 'workout'
  sport text,
  minutes smallint check (minutes between 1 and 600),
  -- kcal z zegarka albo policzone z METów; zawsze netto (bez przemiany spoczynkowej)
  kcal integer check (kcal between 0 and 5000),
  source public.activity_source not null default 'manual',
  external_id text,
  note text,
  created_at timestamptz not null default now()
);

-- jeden wpis kroków na dzień; treningi mogą się powtarzać
create unique index activity_steps_per_day on public.activity_entries (user_id, date) where kind = 'steps';
create unique index activity_external on public.activity_entries (user_id, source, external_id) where external_id is not null;
create index activity_user_date_idx on public.activity_entries (user_id, date);

alter table public.activity_entries enable row level security;

create policy "activity owner" on public.activity_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.activity_entries to authenticated;
