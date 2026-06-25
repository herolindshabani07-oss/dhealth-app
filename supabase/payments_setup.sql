-- ════════════════════════════════════════════════════════════════════════
--  D Health — Payments table + RLS
--  Run this ONCE in Supabase → SQL Editor.
--  Records every payment (crypto/card/…). The server function (verify-bep20)
--  writes here with the service_role key (bypasses RLS); clients can only READ
--  their own row, and staff (doctor/admin) can read ALL rows for the dashboard.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete set null,
  email        text,
  method       text not null default 'crypto',   -- crypto | card | paypal | gpay
  asset        text,                              -- USDT | USDC
  network      text,                              -- BEP20
  amount       numeric(18,6),                     -- amount actually received
  tx_hash      text unique,                       -- on-chain tx; UNIQUE = can't be reused
  status       text not null default 'pending',   -- pending | confirmed | rejected
  plan         text default 'premium',
  raw          jsonb,                             -- on-chain proof / details
  created_at   timestamptz not null default now(),
  confirmed_at timestamptz
);

-- Fast lookups for the dashboard + dedup
create index if not exists payments_created_idx on public.payments (created_at desc);
create index if not exists payments_user_idx    on public.payments (user_id);
create index if not exists payments_status_idx  on public.payments (status);

alter table public.payments enable row level security;

-- A user can read THEIR OWN payments
drop policy if exists payments_select_own on public.payments;
create policy payments_select_own on public.payments
  for select using (auth.uid() = user_id);

-- Staff (doctor/admin) can read ALL payments — powers the dashboard rubric
drop policy if exists payments_select_staff on public.payments;
create policy payments_select_staff on public.payments
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('doctor','admin')
    )
  );

-- NOTE: there is intentionally NO insert/update policy for clients.
-- Only the Netlify function (service_role) writes here, so Premium can never
-- be self-granted from the browser.

-- ── Realtime: let the dashboard receive new payments live ──
alter publication supabase_realtime add table public.payments;
