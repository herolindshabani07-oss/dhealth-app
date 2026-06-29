-- ════════════════════════════════════════════════════════════════════════
--  D Health — Emergency contact table + RLS
--  Run this ONCE in Supabase → SQL Editor.
--  One row per patient (patient_id is the primary key, so saving upserts the
--  single row). Keeps the emergency contact + blood type with the user instead
--  of only in that phone's localStorage, isolated per user via RLS.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.emergency_contacts (
  patient_id  uuid primary key references auth.users(id) on delete cascade,
  name        text,
  phone       text,
  relation    text,
  blood       text,
  updated_at  timestamptz not null default now()
);

alter table public.emergency_contacts enable row level security;

-- A patient can READ their own emergency contact
drop policy if exists emergency_select_own on public.emergency_contacts;
create policy emergency_select_own on public.emergency_contacts
  for select using (auth.uid() = patient_id);

-- A patient can INSERT their own emergency contact
drop policy if exists emergency_insert_own on public.emergency_contacts;
create policy emergency_insert_own on public.emergency_contacts
  for insert with check (auth.uid() = patient_id);

-- A patient can UPDATE their own emergency contact (upsert path)
drop policy if exists emergency_update_own on public.emergency_contacts;
create policy emergency_update_own on public.emergency_contacts
  for update using (auth.uid() = patient_id) with check (auth.uid() = patient_id);

-- Staff (doctor/admin) can READ ALL — useful in an emergency from the dashboard
drop policy if exists emergency_select_staff on public.emergency_contacts;
create policy emergency_select_staff on public.emergency_contacts
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('doctor','admin')
    )
  );
