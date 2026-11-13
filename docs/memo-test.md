# Memo test: can an x402 payment on Solana devnet carry our `order_id`?

**Result: PASS.** An x402 v2 `exact` payment on Solana devnet carries the `order_id` as an SPL Memo,
exactly, when the seller's 402 quote sets `extra.memo = order_id`. Verified on-chain via `getTransaction`.
SPEC.md §13 question 1. Owner: Nizar. Run 2026-11-13.

## Summary

| Test | Result | Evidence |
|---|---|---|
| Positive: memo = order_id, 100000 USDC base units, correct mint, correct owners | **PASS (12/12)** | [`3Hu4pk…kX2`](https://explorer.solana.com/tx/3Hu4pkagn4Lm9New9HoUWG89iJJ1t9R86FLRuCjr8ZY6AMaPXYE4BEaAE6MroYxasivi4qKoMnfgxsrR236o2kX2?cluster=devnet) |
| Negative A: seller quotes a different memo → gateway refuses before signing | **PASS (4/4)** | no tx, gateway USDC unchanged |
| Negative B: seller quotes no memo → what lands on-chain | **PASS (4/4)** | random nonce `34803c44215f62017758441e8f44df71`, [`3XcTuf…Xvb`](https://explorer.solana.com/tx/3XcTufZLEmyrrMGyqxXVFTGG9Ava7CAkWFRMXPGLoQsGRW2Vq2Qc8JpkBaikMKoi43Tk94u644PukCRp9jH9rXvb?cluster=devnet) |

## Setup

| Item | Value |
|---|---|
| Packages | `@x402/core`, `@x402/svm`, `@x402/fetch`, `@x402/next`, `@x402/paywall` **2.30.0**; `@solana/kit` 8.6.0; `@solana-program/token` 0.16.1; Next.js 16.4.6 |
| Network | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` (devnet, x402 v2 CAIP-2 id) |
| USDC mint | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`: SPL Token program `Tokenkeg…`, 6 decimals (checked on-chain) |
| Gateway wallet | `HsyoZYyJCdDiGAvQgokFPGdvEUQy2p5byzeZvEhRRbgr` (funded by Cooper: 1 SOL, 20 USDC) |
| Test seller wallet | `bcSuSumf9ChahaHsvz92xDnXSMABkSo6qcYV1kwrnWa`, USDC token account `3ed9SZXpwxnaT4HGPdECWysr1n2JT82xCevX53JqPbQK` ([created](https://explorer.solana.com/tx/2hPLe7TqmybTNBMcQE5RfAfo2Dyr6g6tixHcdMbLrBPe7d77jrdre5iHvz3WG19jTZWynfRQeYdCsr6DXUZiL8D5?cluster=devnet); the gateway paid the rent) |
| Attacker address | `6QUTX4jCxJiBXpX2VjC66tKuodmkhvVf2qtEvbwBEfaN` (no key kept) |

## Facilitators

| Facilitator | Auth | Solana devnet (v2 `exact`) | Settlement |
|---|---|---|---|
| **PayAI** `https://facilitator.payai.network` (**selected**) | none | yes, feePayer `2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4` | **works** (both paid tests landed) |
| x402.org `https://x402.org/facilitator` | none | yes, feePayer `CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5` | **failed 13/13** (16:08–18:07 UTC): `settlement_pending`, Solana error 8100002 = its RPC returned HTTP 429. No tx ever landed (`getSignatureStatuses` null), no money moved. Its fee payer landed nothing for anyone after 16:06:41 UTC. |
| CDP `https://api.cdp.coinbase.com/platform/v2/x402` | `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET` | per docs | not tested: `/supported` returns 401 without a key |

The **seller** chooses the facilitator (`X402_FACILITATOR_URL` on the seller side). The gateway (x402 client)
never talks to it.

## Positive test (PASS)

Order `c1aa992e-1dd8-4294-8e1f-771de9c54157`. Instruction layout from `getTransaction(jsonParsed, v0)`:
`ComputeBudget SetComputeUnitLimit → ComputeBudget SetComputeUnitPrice → spl-token TransferChecked → spl-memo`.

```
PASS  seller response: HTTP 200 {"ok":true}
PASS  quote memo: c1aa992e-1dd8-4294-8e1f-771de9c54157
PASS  settlement response: success, transaction 3Hu4pkagn4Lm…, network solana:EtWTRA…
PASS  transaction succeeded on-chain: meta.err null
PASS  SPL Memo == order_id: ["c1aa992e-1dd8-4294-8e1f-771de9c54157"]
PASS  exactly one token transfer: 1
PASS  TransferChecked: transferChecked
PASS  amount == 100000: 100000
PASS  mint == USDC_MINT: 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
PASS  destination token account owner == test seller: 3ed9SZXp… owned by bcSuSumf…
PASS  source token account owner == gateway: 3fZwecM9… owned by HsyoZYyJ…
PASS  transfer authority == gateway: HsyoZYyJ…
```
Token accounts are resolved to their **owner wallets** from `meta.pre/postTokenBalances` (fallback:
`getAccountInfo`), never assumed. That's what `payments.from_wallet`/`to_wallet` store (SPEC §0.16).

## Negative A: wrong memo (PASS)

Seller quoted a fresh UUID instead of the order_id.
```
PASS  gateway refused the quote: Payment creation aborted: seller quote memo does not match order_id
PASS  nothing was signed: signed=false
PASS  no new transaction for the gateway: newest signature unchanged
PASS  gateway USDC unchanged: 20000000 -> 20000000
```

## Negative B: no memo (PASS; shows why the guard is needed)

Seller quoted no `extra.memo`; the guard was deliberately bypassed for this test only.
```
PASS  quote had no memo
PASS  settled anyway (facilitator only checks memo when extra.memo is set): HTTP 200
on-chain memo: ["34803c44215f62017758441e8f44df71"]
PASS  memo is a random 16-byte hex nonce
PASS  memo is NOT the order_id (unmatchable)
```
That payment can never be matched to an order. The matcher would raise a critical `no_order`, so this
path can't be trusted.

## How it works (verified in the `@x402/svm` 2.30.0 source and on-chain)

1. The seller answers 402 with `extra.memo` (≤ 256 bytes). **The seller chooses the memo, not the gateway.**
2. The client builds a v0 tx, `SetComputeUnitLimit`, `SetComputeUnitPrice`, `TransferChecked`, `Memo`, and
   partially signs it. A Memo instruction is always present: `extra.memo`, else a random 16-byte hex nonce.
3. The facilitator verifies (layout, amount, mint, destination ATA, **memo == extra.memo when set**,
   simulation), adds its fee-payer signature, broadcasts and confirms. It pays the SOL fee.
4. The seller's USDC token account must already exist. The tx doesn't create it, and verify-time simulation
   fails without it.

**Gateway requirement (proposed; implemented in `lib/gateway/memo-guard.ts`):** before signing, the gateway
checks `extra.memo === order_id` in `x402Client.onBeforePaymentCreation` and refuses otherwise.
**Every seller must echo the gateway's `X-Order-Id` header as `extra.memo`**, on the 402 and the paid retry.

## Raw 402 quote (for rule 6)

```json
{
  "x402Version": 2,
  "accepts": [{
    "scheme": "exact",
    "network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    "amount": "100000",
    "asset": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    "payTo": "bcSuSumf9ChahaHsvz92xDnXSMABkSo6qcYV1kwrnWa",
    "maxTimeoutSeconds": 120,
    "extra": {
      "memo": "be48cea1-86af-4686-97b6-0abf2f115dd5",
      "feePayer": "CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5",
      "transactionVersions": [0, 1],
      "recentBlockhash": "2qYrVsEdZcnba4agWF3aNJoWXXbssSQmHXwh6xjNY1Qq",
      "lastValidBlockHeight": "509008014"
    }
  }]
}
```
`amount` is a base-units **string** (convert it to an integer before `checkQuote`); `asset` is the mint;
`network` is the CAIP-2 id.

## Surprising findings

- The memo is **mandatory** in the current scheme (exactly one Memo instruction), not optional.
- The facilitator enforces memo equality only when `extra.memo` is present (negative B).
- `@x402/next` route config supports per-request `price`/`payTo` but not per-request `extra`. The test
  seller builds the `withX402` wrapper per request around one shared, pre-initialised resource server.
- The x402.org public facilitator can be down for hours (RPC 429) while `/supported` still looks healthy.
- The canonical x402 repo moved to `x402-foundation/x402`; `coinbase/x402` is stale.

## Known limitations

- One successful settlement per path. PayAI is a third-party service with no SLA, so CDP stays the fallback.
- Owner checks rely on `meta.pre/postTokenBalances`; `getAccountInfo` is only the fallback.

## Reproduce

```bash
npx tsx scripts/create-wallets.ts      # once; secrets go to .env.local only
# fund the gateway (faucet.solana.com, faucet.circle.com)
npx tsx scripts/memo-test-setup.ts     # balances, mint, facilitator, seller token account
echo ENABLE_MEMO_TEST_SELLER=1 >> .env.local
npm run build && npx next start -p 3456
npx tsx scripts/memo-test.ts --base http://localhost:3456
```
