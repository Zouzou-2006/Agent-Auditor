-- Agent Auditor: initial schema (SPEC.md section 4). Owner: Nizar.
--
-- Names, types and enum values are copied exactly from SPEC.md. Amounts are bigint USDC base units.
-- Safe to re-run: tables/indexes use IF NOT EXISTS, policies are dropped and recreated, and
-- tables are only added to the realtime publication when not already in it.
--
-- Access model:
--   anon (dashboard, browser)  -> SELECT only, on all six tables
--   service_role (server code) -> full access; bypasses RLS
--   no write policies exist, so anon/authenticated can never insert, update or delete.

begin;

-- gen_random_uuid() is built into Postgres 13+ (Supabase runs 15+), so no extension is needed.

-- ---------------------------------------------------------------- sellers
create table if not exists public.sellers (
  seller_id text primary key,
  name      text not null,
  url       text not null,
  wallet    text not null,
  status    text not null check (status in ('approved', 'blocked'))
);

-- ---------------------------------------------------------------- orders
create table if not exists public.orders (
  order_id     uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  seller_id    text not null,
  item         text not null,
  params       jsonb not null,
  max_amount   bigint not null,
  purpose      text not null,
  status       text not null check (status in ('pending_review', 'denied', 'paid', 'booked', 'exception')),
  deny_reason  text,
  quote_amount bigint,
  quote_wallet text,
  summary      text
);
-- No FK on orders.seller_id: rule 1 must be able to record a DENIED order for a seller that
-- isn't in `sellers` (beat 3: `premiumreports` -> "seller not approved").

-- ---------------------------------------------------------------- payments (written by the Streams webhook)
create table if not exists public.payments (
  tx_signature text primary key,
  block_time   timestamptz not null,
  from_wallet  text not null,
  to_wallet    text not null,
  amount       bigint not null,
  memo         text,
  order_id     uuid references public.orders (order_id),
  raw          jsonb not null
);

-- todaySpent: sum(amount) where from_wallet = our wallet and block_time is today (UTC)
create index if not exists payments_from_wallet_block_time_idx
  on public.payments (from_wallet, block_time);

-- ---------------------------------------------------------------- deliveries
create table if not exists public.deliveries (
  order_id    uuid primary key references public.orders (order_id),
  received_at timestamptz not null default now(),
  body        text,
  checks      jsonb not null,
  passed      boolean not null
);

-- ---------------------------------------------------------------- journal_entries
create table if not exists public.journal_entries (
  entry_id       uuid primary key default gen_random_uuid(),
  order_id       uuid not null unique references public.orders (order_id),
  tx_signature   text,
  entry_date     date not null,
  debit_account  text not null,
  credit_account text not null,
  amount         bigint not null,
  description    text not null
);

-- ---------------------------------------------------------------- exceptions
create table if not exists public.exceptions (
  exception_id uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  order_id     uuid references public.orders (order_id),
  tx_signature text,
  type         text not null check (type in (
                 'no_order', 'wallet_mismatch', 'amount_mismatch',
                 'nothing_delivered', 'bad_format', 'wrong_data')),
  severity     text not null check (severity in ('critical', 'high', 'medium')),
  summary      text,
  status       text not null check (status in ('open', 'approved', 'seller_blocked'))
);

-- ---------------------------------------------------------------- privileges + RLS
do $$
declare
  t text;
begin
  foreach t in array array['sellers', 'orders', 'payments', 'deliveries', 'journal_entries', 'exceptions'] loop
    execute format('alter table public.%I enable row level security', t);

    -- Browser key: read only. Revoke writes explicitly (Supabase grants them by default).
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);

    execute format('drop policy if exists "anon can read %s" on public.%I', t, t);
    execute format('create policy "anon can read %s" on public.%I for select to anon, authenticated using (true)', t, t);
  end loop;
end
$$;

-- ---------------------------------------------------------------- realtime (dashboard live updates)
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array array['sellers', 'orders', 'payments', 'deliveries', 'journal_entries', 'exceptions'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

commit;
