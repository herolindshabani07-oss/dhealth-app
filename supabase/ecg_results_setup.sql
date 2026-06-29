-- ════════════════════════════════════════════════════════════════════════
--  D Health — ECG analysis results table + RLS
--  Run this ONCE in Supabase → SQL Editor.
--  Stores the D Health AI ECG ANALYSIS (summary + status + link to the stored
--  ECG file). The raw ECG image/PDF itself lives in the `documents` bucket +
--  `documents` table; this table keeps the analysis so the ECG History (with
--  its status colours) follows the user across devices instead of living only
--  in that one phone's localStorage.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.ecg_results (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references auth.users(id) on delete cascade,
  ecg_date    text,                               -- pretty date shown in the list (e.g. "9 Apr 2026")
  ts          bigint,                             -- epoch ms when analyzed (for the 24h limit + ordering)
  summary     text,                               -- AI analysis text (trimmed)
  status      text default 'normal',              -- normal | warning | urgent
  path        text,                               -- storage path of the ECG file in `documents` bucket (may be empty)
  created_at  timestamptz not null default now()
);

-- Fast per-user history lookups
create index if not exists ecg_results_patient_idx on public.ecg_results (patient_id, ts desc);

alter table public.ecg_results enable row level security;

-- A patient can READ their own ECG results
drop policy if exists ecg_results_select_own on public.ecg_results;
create policy ecg_results_select_own on public.ecg_results
  for select using (auth.uid() = patient_id);

-- A patient can INSERT their own ECG results
drop policy if exists ecg_results_insert_own on public.ecg_results;
create policy ecg_results_insert_own on public.ecg_results
  for insert with check (auth.uid() = patient_id);

-- A patient can DELETE their own ECG results
drop policy if exists ecg_results_delete_own on public.ecg_results;
create policy ecg_results_delete_own on public.ecg_results
  for delete using (auth.uid() = patient_id);

-- Staff (doctor/admin) can READ ALL ECG results — for the clinical dashboard
drop policy if exists ecg_results_select_staff on public.ecg_results;
create policy ecg_results_select_staff on public.ecg_results
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('doctor','admin')
    )
  );
