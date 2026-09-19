-- MenuVibe – schemat początkowy
-- Każda tabela ma user_id i RLS „tylko właściciel”.
-- Projekt ma wyłączone automatyczne udostępnianie tabel, więc granty nadajemy jawnie.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Typy
-- ---------------------------------------------------------------------------
create type public.meal_slot as enum ('breakfast', 'snack', 'lunch', 'dinner');
create type public.sex as enum ('male', 'female');
create type public.goal as enum ('cut', 'maintain', 'gain');
create type public.diary_kind as enum ('recipe', 'product', 'manual');
create type public.recipe_origin as enum ('dietitian_respo', 'dietitian_activezone', 'claude', 'own');
create type public.target_method as enum ('formula', 'adaptive', 'manual');
create type public.chat_role as enum ('user', 'assistant');

-- ---------------------------------------------------------------------------
-- Pomocnicze
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profil i cele
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  display_name text,
  sex public.sex,
  birth_date date,
  height_cm numeric(5, 1) check (height_cm between 100 and 250),
  activity_pal numeric(4, 3) check (activity_pal between 1.1 and 2.5),
  goal public.goal not null default 'cut',
  -- tempo zmiany masy ciała w % na tydzień (0,5–1% dla redukcji)
  weekly_rate_pct numeric(3, 2) not null default 0.5 check (weekly_rate_pct between 0 and 1.5),
  protein_g_per_kg numeric(3, 1) not null default 1.8,
  fat_pct numeric(4, 1) not null default 25,
  -- podział kcal na posiłki (%), suma = 100
  slot_split jsonb not null default '{"breakfast": 30, "snack": 10, "lunch": 30, "dinner": 30}',
  water_goal_ml integer not null default 3000,
  -- dzień miesiąca, w którym aplikacja przelicza cel kcal
  recalc_day smallint not null default 1 check (recalc_day between 1 and 28),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Historia celów kcal (co miesiąc nowy wpis; aktywny = najnowszy valid_from <= dziś)
create table public.calorie_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  valid_from date not null,
  kcal integer not null check (kcal between 1000 and 6000),
  protein_g integer not null,
  carbs_g integer not null,
  fat_g integer not null,
  method public.target_method not null,
  bmr integer,
  tdee integer,
  weight_kg numeric(5, 2),
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, valid_from)
);

create table public.weight_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  weight_kg numeric(5, 2) not null check (weight_kg between 30 and 300),
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

-- ---------------------------------------------------------------------------
-- Przepisy
-- ---------------------------------------------------------------------------
create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  slug text not null,
  name text not null,
  slot public.meal_slot not null,
  servings smallint not null default 1 check (servings >= 1),
  -- wartości na 1 porcję
  kcal integer not null check (kcal > 0),
  protein_g numeric(6, 1) not null,
  carbs_g numeric(6, 1) not null,
  fat_g numeric(6, 1) not null,
  macros_estimated boolean not null default false,
  steps jsonb not null default '[]',
  origin public.recipe_origin not null default 'own',
  sources jsonb not null default '[]',
  tags text[] not null default '{}',
  -- -1 nie lubię, 0 neutralnie, 1 lubię
  rating smallint not null default 0 check (rating between -1 and 1),
  prep_minutes smallint,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create index recipes_user_slot_idx on public.recipes (user_id, slot) where not archived;

create trigger recipes_updated_at before update on public.recipes
  for each row execute function public.set_updated_at();

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  position smallint not null default 0,
  name text not null,
  -- ilość na CAŁY przepis (wszystkie porcje)
  amount numeric(8, 2) not null check (amount >= 0),
  unit text not null default 'g',
  household text,
  category text not null default 'Inne',
  grp text
);

create index recipe_ingredients_recipe_idx on public.recipe_ingredients (recipe_id);

-- ---------------------------------------------------------------------------
-- Tygodniowe jadłospisy (generowane przez aplikację)
-- ---------------------------------------------------------------------------
create table public.meal_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  week_start date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_start)
);

create trigger meal_plans_updated_at before update on public.meal_plans
  for each row execute function public.set_updated_at();

create table public.meal_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.meal_plans (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  slot public.meal_slot not null,
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  -- mnożnik porcji dopasowujący kcal do celu slotu (0,5–1,5)
  portion_factor numeric(4, 2) not null default 1 check (portion_factor between 0.3 and 2),
  locked boolean not null default false,
  unique (plan_id, date, slot)
);

create index meal_plan_items_user_date_idx on public.meal_plan_items (user_id, date);

-- ---------------------------------------------------------------------------
-- Produkty (cache Open Food Facts + własne)
-- ---------------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ean text,
  name text not null,
  brand text,
  kcal_100g numeric(6, 1) not null,
  protein_100g numeric(5, 1) not null default 0,
  carbs_100g numeric(5, 1) not null default 0,
  fat_100g numeric(5, 1) not null default 0,
  default_grams numeric(6, 1),
  source text not null default 'manual' check (source in ('off', 'manual')),
  favorite boolean not null default false,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, ean)
);

-- ---------------------------------------------------------------------------
-- Dziennik
-- ---------------------------------------------------------------------------
create table public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  slot public.meal_slot not null,
  kind public.diary_kind not null,
  recipe_id uuid references public.recipes (id) on delete set null,
  product_id uuid references public.products (id) on delete set null,
  name text not null,
  grams numeric(7, 1),
  servings numeric(4, 2),
  -- wartości skopiowane w chwili wpisu, żeby edycja przepisu nie zmieniała historii
  kcal integer not null check (kcal >= 0),
  protein_g numeric(6, 1) not null default 0,
  carbs_g numeric(6, 1) not null default 0,
  fat_g numeric(6, 1) not null default 0,
  created_at timestamptz not null default now()
);

create index diary_entries_user_date_idx on public.diary_entries (user_id, date);

create table public.water_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  ml integer not null check (ml between 1 and 3000),
  created_at timestamptz not null default now()
);

create index water_entries_user_date_idx on public.water_entries (user_id, date);

-- ---------------------------------------------------------------------------
-- Lista zakupów, czat, zamienniki, zużycie AI
-- ---------------------------------------------------------------------------
create table public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date_from date not null,
  date_to date not null,
  -- [{name, amount, unit, category, checked}]
  items jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger shopping_lists_updated_at before update on public.shopping_lists
  for each row execute function public.set_updated_at();

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role public.chat_role not null,
  content text not null,
  -- przepis zaproponowany przez Claude (JSON), jeśli był
  recipe jsonb,
  created_at timestamptz not null default now()
);

create index chat_messages_user_created_idx on public.chat_messages (user_id, created_at desc);

create table public.substitutions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  section text,
  note text,
  items jsonb not null default '[]',
  position smallint not null default 0
);

create table public.ai_usage (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  requests integer not null default 0,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  primary key (user_id, date)
);

-- ---------------------------------------------------------------------------
-- RLS + granty
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'calorie_targets', 'weight_entries', 'recipes', 'recipe_ingredients',
    'meal_plans', 'meal_plan_items', 'products', 'diary_entries', 'water_entries',
    'shopping_lists', 'chat_messages', 'substitutions', 'ai_usage'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      'using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || '_owner', t
    );
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end;
$$;

-- zużycie AI zapisuje tylko Edge Function (service role); użytkownik może je tylko czytać
revoke insert, update, delete on public.ai_usage from authenticated;

grant usage on schema public to authenticated;
grant usage on type public.meal_slot, public.sex, public.goal, public.diary_kind,
  public.recipe_origin, public.target_method, public.chat_role to authenticated;

-- ---------------------------------------------------------------------------
-- Profil tworzony automatycznie przy rejestracji
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
