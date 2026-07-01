-- ════════════════════════════════════════════════════════════════════════
--  D Health — Medical report AI summaries table + RLS
--  Run this ONCE in Supabase → SQL Editor.
--  Stores the D Health AI SUMMARY of an uploaded medical report (Raporte).
--  The raw report file itself lives in the `documents` bucket + `documents`
--  table; THIS table keeps the AI analysis so it follows the user across
--  devices (and feeds the AI chat/verdict) instead of living only in that one
--  phone's localStorage (dh_reports). Isolated per-user via RLS.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.report_summaries (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references auth.users(id) on delete cascade,
  report_date  text,                               -- pretty date shown in context (e.g. "1 Jul 2026")
  ts           bigint,                             -- epoch ms when analyzed (ordering)
  name         text,                               -- original file name
  summary      text,                               -- AI clinical summary (trimmed)
  path         text,                               -- storage path of the report file in `documents` bucket (may be empty)
  created_at   timestamptz not null default now()
);

-- Fast per-user lookups
create index if not exists report_summaries_patient_idx on public.report_summaries (patient_id, ts desc);

alter table public.report_summaries enable row level security;

-- A patient can READ their own report summaries
drop policy if exists report_summaries_select_own on public.report_summaries;
create policy report_summaries_select_own on public.report_summaries
  for select using (auth.uid() = patient_id);

-- A patient can INSERT their own report summaries
drop policy if exists report_summaries_insert_own on public.report_summaries;
create policy report_summaries_insert_own on public.report_summaries
  for insert with check (auth.uid() = patient_id);

-- A patient can DELETE their own report summaries
drop policy if exists report_summaries_delete_own on public.report_summaries;
create policy report_summaries_delete_own on public.report_summaries
  for delete using (auth.uid() = patient_id);

-- Staff (doctor/admin) can READ ALL report summaries — for the clinical dashboard
drop policy if exists report_summaries_select_staff on public.report_summaries;
create policy report_summaries_select_staff on public.report_summaries
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('doctor','admin')
    )
  );
