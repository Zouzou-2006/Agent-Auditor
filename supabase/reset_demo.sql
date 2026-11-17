-- Reset the shared demo data before recording (owner: Nizar). DESTRUCTIVE: deletes every order,
-- payment, delivery, journal entry and exception, then puts the three sellers back as approved.
-- Agree with the team in #hackathongroupaudit before running it; it affects everyone's data.
--
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. One transaction: all or nothing.
--
-- Unlike seed_sellers.sql, this keeps each seller's url on the PRODUCTION host, so the live gateway
-- (https://agentauditor-kappa.vercel.app) can still reach them. Ids and wallets match seed_sellers.sql.

begin;

-- Children first (they reference orders), then orders.
delete from public.journal_entries;
delete from public.exceptions;
delete from public.deliveries;
delete from public.payments;
delete from public.orders;

insert into public.sellers (seller_id, name, url, wallet, status) values
  ('dataco',      'DataCo',      'https://agentauditor-kappa.vercel.app/api/sellers/dataco',      'ATDBWGF9hk38MJZ9QHiDKw7ujZXh8nwEnqFF4D7iPXQc', 'approved'),
  ('cheapdata',   'CheapData',   'https://agentauditor-kappa.vercel.app/api/sellers/cheapdata',   '9umxy5AaLN4v8uVowiT6RpWi97Jwj7ttRtTdnSoCsrK2', 'approved'),
  ('sketchynews', 'SketchyNews', 'https://agentauditor-kappa.vercel.app/api/sellers/sketchynews', '6RUKNLfR6dwpACr1zTHswgYkq2ve6gV1UoDii2q6YVnW', 'approved')
on conflict (seller_id) do update
  set name = excluded.name, url = excluded.url, wallet = excluded.wallet, status = excluded.status;

commit;

-- Check: every table empty except sellers (3 rows, all approved, production urls).
select 'orders' as t, count(*) from public.orders
union all select 'payments', count(*) from public.payments
union all select 'deliveries', count(*) from public.deliveries
union all select 'journal_entries', count(*) from public.journal_entries
union all select 'exceptions', count(*) from public.exceptions
union all select 'sellers (approved)', count(*) from public.sellers where status = 'approved';
