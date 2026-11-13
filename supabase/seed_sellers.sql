-- Seed the three fake sellers (SPEC.md sections 4 and 6). Owner: Fabi.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run: it overwrites
-- the three rows, which also puts a blocked seller back to approved before a demo retake.
--
-- `wallet` is each seller's OWNER wallet address (the Phantom address), not its USDC token
-- account (SPEC section 0.16). DataCo's wallet must equal DATACO_WALLET in .env.local, or
-- rule 5 denies every DataCo order ("quote wallet doesn't match seller").
-- `url` points at the local dev server; change the host once the app is deployed.

insert into public.sellers (seller_id, name, url, wallet, status) values
  ('dataco',      'DataCo',      'http://localhost:3000/api/sellers/dataco',      'ATDBWGF9hk38MJZ9QHiDKw7ujZXh8nwEnqFF4D7iPXQc', 'approved'),
  ('cheapdata',   'CheapData',   'http://localhost:3000/api/sellers/cheapdata',   '9umxy5AaLN4v8uVowiT6RpWi97Jwj7ttRtTdnSoCsrK2', 'approved'),
  ('sketchynews', 'SketchyNews', 'http://localhost:3000/api/sellers/sketchynews', '6RUKNLfR6dwpACr1zTHswgYkq2ve6gV1UoDii2q6YVnW', 'approved')
on conflict (seller_id) do update
  set name = excluded.name, url = excluded.url, wallet = excluded.wallet, status = excluded.status;

-- Check: expect 3 rows, all approved.
select seller_id, name, url, wallet, status from public.sellers order by seller_id;