-- Weekly wearable-health (WHOOP-style) tracking table.
-- One row per ISO week. Metrics are weekly averages from the wearable.
-- Benchmarks for "average" vs "top 10%" live in the front-end scoring engine,
-- not the DB, so they can be tuned without a migration.

create table if not exists public.whoop_weekly (
  id                     uuid primary key default gen_random_uuid(),
  week_start             date not null unique,           -- Monday of the tracked week
  recovery_pct           numeric check (recovery_pct between 0 and 100),
  hrv_ms                 numeric check (hrv_ms >= 0),     -- avg RMSSD
  resting_hr             numeric check (resting_hr between 20 and 120),
  sleep_performance_pct  numeric check (sleep_performance_pct between 0 and 100),
  sleep_hours            numeric check (sleep_hours between 0 and 16),
  day_strain             numeric check (day_strain between 0 and 21),
  respiratory_rate       numeric check (respiratory_rate between 5 and 40),
  weight_kg              numeric check (weight_kg between 20 and 400),
  fitness_score          numeric,                         -- 0-100 overall, computed client-side
  notes                  text,
  created_at             timestamptz not null default now()
);

comment on table public.whoop_weekly is 'Weekly wearable-health metrics with elite (top-10%) benchmarking.';

-- Keep history queries fast and ordered by week.
create index if not exists whoop_weekly_week_start_idx
  on public.whoop_weekly (week_start desc);

-- RLS: this is a single-user personal tracker fronted only by the anon
-- publishable key. We enable RLS and grant the anon role read/write so the
-- static Netlify page works without an auth flow.
-- NOTE: anyone holding the anon key + URL can read/write this table. That is an
-- accepted tradeoff for a personal tool; add Supabase Auth + per-user policies
-- before this ever holds data for more than one person.
alter table public.whoop_weekly enable row level security;

drop policy if exists "anon can read weekly"   on public.whoop_weekly;
drop policy if exists "anon can insert weekly" on public.whoop_weekly;
drop policy if exists "anon can update weekly" on public.whoop_weekly;
drop policy if exists "anon can delete weekly" on public.whoop_weekly;

create policy "anon can read weekly"   on public.whoop_weekly for select using (true);
create policy "anon can insert weekly" on public.whoop_weekly for insert with check (true);
create policy "anon can update weekly" on public.whoop_weekly for update using (true) with check (true);
create policy "anon can delete weekly" on public.whoop_weekly for delete using (true);
