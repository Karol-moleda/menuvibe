-- Dokładniejsze liczenie zapotrzebowania: zamiast jednego mnożnika „aktywność”
-- trzymamy składniki (tryb dnia, kroki, treningi) i przeliczamy cel co tydzień.

alter table public.profiles
  add column if not exists body_fat_pct numeric(4, 1) check (body_fat_pct between 3 and 60),
  add column if not exists job_pal numeric(4, 3) not null default 1.15 check (job_pal between 1.1 and 1.6),
  add column if not exists daily_steps integer not null default 6000 check (daily_steps between 0 and 40000),
  add column if not exists training_days smallint not null default 3 check (training_days between 0 and 14),
  add column if not exists training_minutes smallint not null default 60 check (training_minutes between 0 and 300),
  add column if not exists training_met numeric(3, 1) not null default 6 check (training_met between 2 and 14),
  -- dzień tygodnia przeliczania celu: 1 = poniedziałek … 7 = niedziela
  add column if not exists recalc_weekday smallint not null default 1 check (recalc_weekday between 1 and 7);

-- cel może teraz pamiętać, ile danych stało za zmierzonym zapotrzebowaniem
alter table public.calorie_targets
  add column if not exists measured_tdee integer,
  add column if not exists confidence numeric(3, 2);
