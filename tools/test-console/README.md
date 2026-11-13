# Test console (dev tool)

A local page for testing the gateway by hand. **It is not the dashboard.** The demo dashboard is
Aidan's (`app/`, SPEC.md section 11). This console only reads the tables and calls the public API routes.

## Run it

```
npm run build && npm start              # the app on http://localhost:3000
node tools/test-console/server.mjs      # the console on http://localhost:4000
```

It reads `.env.local` (Supabase URL and service-role key, gateway wallet address, Solana RPC).
The keys stay in the Node process: the browser only gets table rows and API replies. It listens
on `127.0.0.1` only.

## What it shows

- Live `orders`, `exceptions`, `payments`, `deliveries`, `journal_entries` and `sellers`, refreshed every 3 s.
- USDC and SOL balances for the gateway and each seller wallet, and a warning when a wallet has
  no USDC token account (payments to it fail).
- A test order form with presets (clean buy, needs review, over the limit, unknown seller, bad body).
- Approve on `pending_review` orders (`POST /api/orders/[id]/approve`), Approve and Block Seller on
  open exceptions (`POST /api/exceptions/[id]`).
- Buttons that run `demo/beat1.ts`–`beat4.ts`. Each calls Claude (about a cent) and may pay devnet USDC.

Test orders land in the shared Supabase tables, so clear them before recording the demo.
