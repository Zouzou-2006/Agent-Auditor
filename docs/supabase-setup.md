# Supabase setup: running `0001_init.sql`

Creates the six tables from SPEC.md section 4 with RLS and Realtime. Run it once per Supabase
project (it's safe to re-run). It doesn't seed any sellers: Fabi adds those.

## Run it

1. Open https://supabase.com/dashboard and select the **Agent Auditor** project.
2. Left sidebar: **SQL Editor** → **New query**.
3. Paste the whole of `supabase/migrations/0001_init.sql` and click **Run**.
   Expected result: "Success. No rows returned."
   Then do the same with `supabase/migrations/0002_order_status_paying.sql` (adds the `paying` order status).
   Run them in number order; both are safe to re-run.
4. Run the verification queries below.

Then put the keys in your own `.env.local` (never commit them):
**Project Settings → API**: Project URL → `NEXT_PUBLIC_SUPABASE_URL`, the anon / publishable key →
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, the service_role / secret key → `SUPABASE_SERVICE_ROLE_KEY`
(server only, never in browser code).

## Verify

```sql
-- 1. The six tables, all with RLS on (expect 6 rows, rls = true)
select tablename, rowsecurity as rls
from pg_tables where schemaname = 'public'
  and tablename in ('sellers','orders','payments','deliveries','journal_entries','exceptions')
order by 1;

-- 2. Policies: one SELECT policy per table for anon/authenticated, no write policies (expect 6 rows)
select tablename, policyname, cmd, roles
from pg_policies where schemaname = 'public' order by 1;

-- 3. Realtime: all six tables in the publication (expect 6 rows)
select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public' order by 1;

-- 4. Enum CHECK constraints (expect sellers/orders/exceptions status, exceptions type + severity)
select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid) as definition
from pg_constraint where contype = 'c' and connamespace = 'public'::regnamespace order by 1, 2;

-- 5. anon is read-only (expect SELECT only, for each of the six tables)
select table_name, string_agg(privilege_type, ', ' order by privilege_type) as anon_privileges
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public' group by 1 order by 1;

-- 6. The todaySpent index
select indexdef from pg_indexes where indexname = 'payments_from_wallet_block_time_idx';
```

## Design notes (for review)

- **No foreign key on `orders.seller_id`.** Rule 1 denies orders for sellers that aren't in `sellers`
  (beat 3: `premiumreports` → "seller not approved"), and the denied order is still saved. An FK would
  reject that insert.
- **No foreign keys on `tx_signature` columns** (`journal_entries`, `exceptions`). SPEC doesn't define that
  relationship, and an FK would make booking depend on the webhook row being written first.
- **Foreign keys to `orders(order_id)`:** `payments.order_id` (nullable: no match = stolen key),
  `deliveries.order_id` (also its primary key: one delivery per order), `journal_entries.order_id`
  (unique: one entry per order), `exceptions.order_id` (nullable: stolen key).
- **NOT NULL** only where SPEC says the value is always present. Nullable: `orders.deny_reason`,
  `quote_amount`, `quote_wallet`, `summary`; `payments.memo`, `order_id`; `deliveries.body`;
  `journal_entries.tx_signature`; `exceptions.order_id`, `tx_signature`, `summary`.
- **Defaults** only for UUID keys (`gen_random_uuid()`) and the timestamps (`now()`). Status columns have
  **no default**: SPEC doesn't define one, so code must always set the status explicitly.
- **Writes** go through the service-role key (server code), which bypasses RLS. anon/authenticated
  have SELECT only; INSERT/UPDATE/DELETE/TRUNCATE are revoked.
- **Tested** against Postgres (PGlite) with stub `anon`/`authenticated`/`service_role` roles: runs twice
  cleanly; every enum CHECK rejects bad values; anon can read and is denied insert/update/delete;
  service_role can write.
