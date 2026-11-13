# Production deploy (Vercel)

Production URL: **https://agentauditor-kappa.vercel.app** (auto-deploys from `main`).
Streams webhook: **https://agentauditor-kappa.vercel.app/api/webhooks/streams**

## Project settings

- Git: `Zouzou-2006/Agent-Auditor`, production branch `main`.
- Node.js: 26.x (Vercel's default; `package.json` asks for `>=26.0.0`, which maps to 26.x).
- Deployment Protection: the **production** domain must stay public (no Vercel Authentication on
  production), because QuickNode Streams and the sellers' callers must reach it.
- Function durations come from `export const maxDuration` in each route: 300 s for
  `/api/orders`, `/api/orders/[id]/approve` and `/api/assistant` (the Vercel maximum on every
  plan with Fluid compute), 60 s for `/api/webhooks/streams`.

## Environment variables (Production scope)

Paste the values from your own `.env.local` in the Vercel dashboard. Never in chat or Slack.

| Name | Notes |
|---|---|
| `GATEWAY_WALLET_SECRET` | gateway signing key (secret) |
| `GATEWAY_WALLET_ADDRESS` | gateway public address |
| `SOLANA_RPC_URL` | devnet RPC |
| `X402_FACILITATOR_URL` | `https://facilitator.payai.network` |
| `DATACO_WALLET` | DataCo's owner wallet (must match `sellers.wallet`) |
| `NEXT_PUBLIC_SUPABASE_URL` | baked in at build time |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | baked in at build time |
| `SUPABASE_SERVICE_ROLE_KEY` | server only (secret) |
| `ANTHROPIC_API_KEY` | copilot + summaries (secret) |
| `USDC_MINT` | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| `QUICKNODE_STREAMS_SECRET` | the Stream's security token, added once the Stream exists (secret) |

Do **not** add `TEST_SELLER_*`, `ATTACKER_*` or `ENABLE_MEMO_TEST_SELLER` (local-only test tools).

After adding or changing any `NEXT_PUBLIC_*` value, **redeploy** (they are compiled into the build).

## Point the sellers at production

Run once in Supabase → SQL Editor (and again after any re-run of `supabase/seed_sellers.sql`,
which resets the urls to localhost). It changes only `url`; ids, wallets and status stay.

```sql
update public.sellers
set url = 'https://agentauditor-kappa.vercel.app/api/sellers/' || seller_id
where seller_id in ('dataco', 'cheapdata', 'sketchynews');

select seller_id, url, wallet, status from public.sellers order by seller_id;
```

## Smoke checks

```bash
B=https://agentauditor-kappa.vercel.app
curl -s -o /dev/null -w "%{http_code}\n" $B/                         # 200
curl -s -D - -o /dev/null "$B/api/sellers/dataco?ticker=SOL&date=$(date -u +%F)" \
  -H "X-Order-Id: 11111111-1111-4111-8111-111111111111"            # 402 + payment-required header
curl -s -w " %{http_code}\n" -X POST $B/api/webhooks/streams -d '{}' # 401 bad signature (500 until the secret is set)
GATEWAY_URL=$B node --import ./scripts/ts-resolve.mjs demo/beat1.ts  # one real purchase
```
