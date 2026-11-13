# Agent Auditor — SPEC

Source of truth for the team (Cooper, Nizar, Fabi, Aidan) for the UBC 2026 Hackathon.
Compiled from Cooper's 5-part spec in #hackathongroupaudit (Nov 11) plus every change agreed in the channel through Nov 12.
**Where the Nov 11 call notes and this file disagree, the call notes win.** Fix this file when that happens.

**Rules for changing this file:** a change to the data (section 4) or the endpoints (section 10) goes in here first via PR, then gets a line in Slack. Slack says what changed; this file says what's true. Never rename a table, field, endpoint or reason string without proposing it in #hackathongroupaudit first.

---

## 0. Changes since the Slack spec (Nov 11–12)

1. **Roles (call notes):** Nizar submits. Fabi is backup coder on the back end. Cooper owns the README, and everyone contributes to it.
2. **Human review gets built** (orders over `human_review_over`, $0.50).
3. **New order status `pending_review`.** `orders.status` is `pending_review`, `denied`, `paid`, `booked` or `exception`. `POST /api/orders` can return `pending_review`.
4. **New endpoint `POST /api/orders/[id]/approve`** (Nizar owns it). See section 10.
5. **Rule check functions** are defined in `lib/rules.ts`. See section 5.
6. **Booking functions** are defined in `lib/booking.ts`. See section 8.
7. **Block Seller writes a journal entry:** debit `Loss on undelivered purchases`, credit `USDC - agent wallet`. **Approve** books the normal entry (debit `Data purchases expense`).
8. **Database:** Supabase (Cooper's call).
9. **Devnet USDC mint:** `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (Circle faucet). x402 and rule 6 both expect this mint.
10. **Wallet:** Nizar creates the gateway wallet and posts its public address in Slack. Cooper funds it with devnet SOL (faucet.solana.com) and devnet USDC (faucet.circle.com).
11. **API key:** the team uses Cooper's Claude API key. Each person puts it in `.env.local` as `ANTHROPIC_API_KEY`.
12. **Rules stay a JSON file** (not AWS's policy language). The "don't build" list stands.
13. **Three delivery checks, not six.** If beat 1 slips past Saturday, beat 3 gets cut first.
14. **Workflow:** everyone works on their own branch and merges by PR. Tag `main` each time a beat works (`beat1-works`, `beat2-works`, …). Post a Slack update by 10 PM every night: done, next, blockers.
15. **Beat 3's injection** names a seller that isn't in `sellers` (for example `premiumreports`), so it's denied with `seller not approved` every time.
16. **`payments.from_wallet` / `to_wallet`** hold **owner wallet addresses**, not token account addresses. USDC moves between token accounts, so the webhook resolves each token account to its owner.
17. **Memo test passed (Nov 13).** x402 on Solana carries the `order_id` as the SPL Memo, but the **seller** sets it: every seller's 402 quote must echo the gateway's `X-Order-Id` header as `extra.memo` (section 6). Facilitator: **PayAI** (`https://facilitator.payai.network`, no key); x402.org failed every devnet settlement. See `docs/memo-test.md`.
18. **New order status `paying`.** The gateway saves the order as `paying` **before** any money moves, so the webhook never sees a memo with no order: `paying` → `paid` → `booked` / `exception`. A payment that fails before anything is signed → `denied` with reason `payment failed`. A quote whose memo isn't the order's id → `denied` with `quote memo doesn't match order`.
19. **`POST /api/orders` waits up to ~20 s for booking.** If the Streams webhook hasn't arrived by then it returns `paid` (booking still happens when it lands).

---

## 1. What we're building

A company gives its own AI agent a wallet so the agent can buy data from other agents. Agent Auditor is the internal control on that agent, the same way a company's controls check an employee who has a credit card. Before a purchase, it blocks orders that break finance's rules. After a purchase, it reads every payment from the chain, matches the payment to an order, checks that the delivery is what was ordered, and books clean purchases as journal entries. Anything else becomes an exception for a human.

**Our edge:** competitors set spending limits or log payments. None of them check what the agent actually received against what it ordered, and we show how every decision was made.

**In accounting terms:** AWS's AgentCore puts preventive controls at a gateway outside the agent: hard rules, checked before anything is signed. We do the same. But prevention alone misses two things: a stolen key that skips the gateway, and a seller that takes the money and delivers nothing. Agent Auditor adds detective controls for those. It reads every payment from the chain, matches it to an order, checks the delivery, and books the result.

**Targets:** the Agentic Payments & AI track, Best use of Solana, and the QuickNode Streams bounty.

## 2. Scope

**We build:** three fake seller agents, a buyer agent, the gateway (rule checks, x402 payment, delivery checks), the Streams webhook and matcher, journal entries and exceptions, a dashboard with human actions, and a one-sentence AI summary of each decision.

**We don't build** (pitch these as "what's next"): refunds, seller scores (a seller is `approved` or `blocked`, nothing else), agent memory, fact-checking against outside data, an AI quality verdict, daily reconciliation, or support for more than one company or agent. If a Claude suggests building one of these, the answer is no.

## 3. How it works

**The key design choice: the agent never pays anyone directly.** The gateway holds the wallet's private key. The agent asks the gateway to buy, and the gateway pays only orders that pass the rules. QuickNode Streams watches the wallet, so any payment the gateway didn't make means the key was used without permission.

A purchase, step by step:
1. The buyer agent files an order with the gateway: which seller, what item, the max price, and why.
2. The gateway checks the rules (section 5). If any rule fails, the order is `denied`, nothing is paid, and the reason is saved. If the order is over `human_review_over`, it goes to `pending_review` and waits for an Approve click.
3. The gateway calls the seller's URL. The seller answers HTTP 402 Payment Required with a quote: the amount and the wallet to pay.
4. The gateway checks the quote. The amount must be at or under the order's max, and the wallet must be the seller's `wallet` in `sellers`. If either check fails, the order is `denied` and no money moves.
5. The gateway pays with x402 on Solana devnet, in USDC, with the `order_id` in the transaction memo. It retries the request with the payment proof, and the seller returns the data.
6. The gateway runs the delivery checks (section 7) and saves the results.
7. QuickNode Streams sends the transaction to our webhook. The matcher reads the memo and links the payment to its order.
8. Booking: a matched payment with a passing delivery becomes a journal entry. Anything else becomes an exception (section 8). The webhook and the delivery check can finish in either order, so whichever finishes second triggers booking.
9. The dashboard shows everything live, with a one-sentence AI summary of why each decision was made.

**A payment with no order** is any transaction from our wallet that has no memo, or whose memo matches no order. It becomes a critical exception right away. This is the stolen-key case. Only payments going **out** of our wallet are checked. Incoming funding (for example from a faucet) has no order either, and it must not set off the alarm.

## 4. The data (Supabase tables)

Every piece of code uses these exact names. **Amounts are integers in USDC base units** (1 USDC = `1000000`), never decimals.

**`sellers`**
- `seller_id` text: `dataco`, `cheapdata`, `sketchynews`
- `name` text: shown on the dashboard
- `url` text: the seller's paid endpoint
- `wallet` text: the seller's Solana address
- `status` text: `approved` or `blocked`

**`orders`**
- `order_id` uuid: also goes in the payment memo
- `created_at` timestamptz
- `seller_id` text
- `item` text: for example `price_quote`
- `params` jsonb: for example `{"ticker":"SOL","date":"2026-11-14"}`
- `max_amount` bigint: USDC base units
- `purpose` text: why the agent is buying
- `status` text: `pending_review`, `denied`, `paying`, `paid`, `booked`, `exception` (`paying`: saved before the payment is signed; see section 10)
- `deny_reason` text: when denied, the rule's reason string (section 5), saved exactly as written
- `quote_amount` bigint: from the seller's 402
- `quote_wallet` text: from the seller's 402
- `summary` text: one-sentence AI explanation

**`payments`** (written by the Streams webhook)
- `tx_signature` text: primary key
- `block_time` timestamptz
- `from_wallet` text: owner wallet address
- `to_wallet` text: owner wallet address
- `amount` bigint: USDC base units
- `memo` text: should be an `order_id`
- `order_id` uuid: set when matched, null when there's no match
- `raw` jsonb: the full Streams payload

**`deliveries`**
- `order_id` uuid
- `received_at` timestamptz
- `body` text: exactly what the seller returned
- `checks` jsonb: `{"received":true,"format":true,"matches_order":false}`
- `passed` boolean: true only if all three checks pass

**`journal_entries`**
- `entry_id` uuid
- `order_id` uuid
- `tx_signature` text
- `entry_date` date
- `debit_account` text: `Data purchases expense`, or `Loss on undelivered purchases` (Block Seller)
- `credit_account` text: `USDC - agent wallet`
- `amount` bigint
- `description` text: for example "SOL price quote from DataCo"

**`exceptions`**
- `exception_id` uuid
- `created_at` timestamptz
- `order_id` uuid: null for the stolen-key case
- `tx_signature` text: null if no payment happened
- `type` text: see section 8
- `severity` text: `critical`, `high`, `medium`
- `summary` text: one-sentence AI explanation
- `status` text: `open`, `approved`, `seller_blocked`

## 5. Finance rules

The rules live in `config/rules.json`, not on a screen. Every rule is a hard yes/no. No rule is a sentence for the AI to interpret.

```json
{
  "network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  "asset": "USDC",
  "usdc_mint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  "max_per_purchase": 1000000,
  "max_per_day": 5000000,
  "human_review_over": 500000
}
```
`network` is the Solana devnet ID exactly as x402 quotes send it. Rule 6 compares `quote.network` to `network` and `quote.asset` to `usdc_mint` (the devnet USDC mint), so the seller's 402 quote must send the mint address as its asset, not the word "USDC".

**Default deny:** anything not explicitly allowed is denied, including an unknown seller, item, network or token.

An order is denied if any of these is true:
1. The seller isn't in `sellers`, or its status isn't exactly `approved` (`blocked` or anything else).
2. `max_amount` is over `max_per_purchase` ($1.00).
3. Today's paid total plus this order would go over `max_per_day` ($5.00).
4. The seller's quote amount is over the order's `max_amount`.
5. The seller's quote wallet isn't that seller's `wallet`.
6. The seller's quote `asset` isn't `usdc_mint`, or its `network` isn't `network` (USDC on Solana devnet).

**Functions (`lib/rules.ts`, owned by Cooper).** They never touch the database. The gateway looks up what they need and passes it in.
- `checkOrder(order, seller, todaySpent)` runs rules 1–3 **before** the gateway contacts the seller. `seller` is the row from `sellers`, or `null` if that seller isn't in the table.
- `checkQuote(order, quote, seller)` runs rules 4–6 **after** the seller's 402. `quote` is `{ amount, wallet, asset, network }`.
- `needsReview(order)` is true when `max_amount` is over `human_review_over` (500000).
- Each check returns `{ ok: true }` or `{ ok: false, rule, reason }`.

**`todaySpent`** is the sum of `payments.amount` where `from_wallet` is our wallet and `block_time` falls today (UTC), in base units. It includes payments with no matching order. `payments` is written by the webhook, so a payment made seconds ago may not be counted yet. That's accepted for the demo.

**Reason strings** (saved exactly as written to `orders.deny_reason`; the dashboard and the video use these words):

| Rule | Reason |
| --- | --- |
| 1 (seller not in table) | `seller not approved` |
| 1 (status not `approved`) | `seller blocked` |
| 2 | `over per-purchase limit` |
| 3 | `over daily limit` |
| 4 | `quote over max` |
| 5 | `quote wallet doesn't match seller` |
| 6 | `wrong asset or network` |
| Gateway: the quote's `extra.memo` isn't this order's `order_id` | `quote memo doesn't match order` |
| Gateway: the payment failed before anything was signed (seller unreachable, bad 402, error) | `payment failed` |

The two gateway reasons aren't finance rules (`lib/rules.ts` never returns them). The gateway applies them in `POST /api/orders` and `/approve`.

**Test cases** (DataCo approved, $0.10 = 100000):
1. DataCo, max 100000, spent 0, quote 100000 to DataCo's wallet in USDC on devnet → ok
2. Seller `premiumreports` (not in the table) → `seller not approved`
3. CheapData after Block Seller → `seller blocked`
4. Max 1500000 → `over per-purchase limit`
5. Max 1000000 (exactly the cap) → passes rule 2
6. Max 100000, spent 4950000 → `over daily limit`
7. Max 100000, spent 4900000 (lands exactly on $5) → ok
8. Quote 150000 on max 100000 → `quote over max`
9. Quote wallet = attacker wallet → `quote wallet doesn't match seller`
10. Quote asset SOL → `wrong asset or network`
11. Max 600000 → needs review; max 500000 → doesn't

**Not building** (mention as "what's next"): approvals that expire, and a log-only mode where the rules record what they would block without blocking it.

## 6. The three fake sellers (Fabi)

Each seller is a small x402 endpoint that charges $0.10 (`100000`) per call.

**Seller contract with the gateway:**
- The gateway calls `GET <sellers.url>?<params as query string>` with header `X-Order-Id: <order_id>`.
- The 402 quote's `extra.memo` **must equal that `X-Order-Id`**, on the first 402 and on the paid retry. That memo is how the payment is matched to its order on-chain. The gateway refuses to pay any other memo.
- The quote's `asset` is the mint, `network` is `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`, and `amount` is a base-units string.
- The seller wallet's USDC token account must already exist on devnet (x402 never creates it).
- **DataCo** (beat 1): returns valid JSON for the ticker and date asked, for example `{"ticker":"SOL","date":"2026-11-14","price_usd":142.10,"source":"DataCo"}`
- **CheapData** (beat 2): takes the payment, then returns an empty body.
- **SketchyNews** (beat 3): a free preview page whose text hides an instruction to pay 0.10 USDC for a "premium report" from a seller that isn't in `sellers` (for example `premiumreports`), at the attacker wallet. The attacker wallet isn't in any seller's row.

We also need one attacker wallet (just a devnet address) and a "stolen key" script that sends USDC from our wallet straight to the attacker wallet, skipping the gateway (beat 4).

## 7. Delivery checks (Fabi)

All three checks are deterministic code, not AI. They run in order, and the first failure stops the rest.
1. **Received:** the body isn't empty. Fails as `nothing_delivered`.
2. **Format:** the body is valid JSON with every field the item requires, each of the right type. For `price_quote`: `ticker` (string), `date` (YYYY-MM-DD), `price_usd` (number), `source` (string). Fails as `bad_format`.
3. **Matches the order:** `ticker` and `date` equal the order's `params`. Fails as `wrong_data`.

After saving a row to `deliveries`, call `tryBook(order_id)`.

## 8. Exceptions, booking, human actions (Cooper)

**Exception types and severity:**
- `no_order` (critical): a payment from our wallet with no matching order. This is the stolen key.
- `wallet_mismatch` (critical): a payment went to a different wallet than its order's.
- `amount_mismatch` (high): the amount paid differs from the order's quote.
- `nothing_delivered` (high): paid, but the body was empty.
- `bad_format` (medium): paid, but the body was unreadable or missing fields.
- `wrong_data` (medium): paid, but not what was ordered.

Denied orders aren't exceptions. No money moved, so the dashboard shows them as "blocked before payment," with the reason.

**Booking functions (`lib/booking.ts`):**
- `tryBook(order_id)`: called by the webhook after a payment matches an order, and by the delivery check after it saves a row to `deliveries`. It does nothing until both the payment and the delivery have arrived. Before writing anything, it claims the order: the status changes from `paid` to `booked` only if it's still `paid`, so a purchase can't be booked twice. If something fails, it creates **one exception per order**, the most severe one.
- `flagUnmatchedPayment(payment)`: called by the webhook when an **outgoing** payment matches no order. It creates a critical `no_order` exception with no journal entry. Resolving it goes under "what's next" in the pitch.
- `approveException(exception_id)`: the dashboard's Approve button on an exception. It books the normal entry (debit `Data purchases expense`, credit `USDC - agent wallet`).
- `blockSeller(exception_id)`: the dashboard's Block Seller button. It sets the seller to `blocked`, so the seller's next order is denied by rule 1. It also writes a journal entry: debit `Loss on undelivered purchases`, credit `USDC - agent wallet`.

## 9. The four demo beats (what "done" means)

1. **Clean purchase:** the agent buys a SOL price quote from DataCo. The dashboard shows the order, the payment from the chain, the passed checks and the journal entry.
2. **Empty delivery:** the agent buys from CheapData, pays and gets nothing, and a `nothing_delivered` exception appears. A human clicks Block Seller. The agent tries CheapData again, and the order is denied: "seller blocked."
3. **Prompt injection:** the agent reads SketchyNews's preview and files an order to pay the attacker wallet. Denied: "seller not approved." No money moves. (Decided by Cooper: recent Claude models may resist the injection, so `demo/beat3.ts` files the bad order directly, as a fooled agent would, with no agent involved.)
4. **Stolen key:** the script pays the attacker wallet directly. Within seconds, Streams delivers the payment and a critical `no_order` exception appears.

Each beat is a script we can rerun (`demo/beat1.ts` and so on), so we can retake the video as many times as needed.

## 10. Architecture (Nizar decides)

- One public repo: `Zouzou-2006/Agent-Auditor`.
- One Next.js app: `app/` is the dashboard, `app/api/orders` is the gateway, `app/api/webhooks/streams` is the webhook, `app/api/sellers/[seller]` holds the fake sellers, and `app/api/exceptions/[id]` handles human actions.
- Supabase for the tables. The dashboard uses Supabase realtime so new rows appear live.
- x402 with the **PayAI** facilitator on Solana devnet (`X402_FACILITATOR_URL=https://facilitator.payai.network`, no key). The memo test showed x402.org failing every devnet settlement; Coinbase's (CDP) needs an API key and is the fallback.
- QuickNode Streams on Solana devnet, filtered to our wallet, posting to the webhook. Pause it when not testing, because it bills per block.
- Claude API for the buyer agent and the one-sentence summaries.
- Secrets (wallet key, Supabase service key, QuickNode, Claude API key) go in `.env.local` only. Commit a `.env.example` with blank values. Never commit a key. **The repo is already public**, so every push is public the moment it lands.

**Gateway endpoints (Nizar):**
```
POST /api/orders
{ "seller_id": "dataco", "item": "price_quote",
  "params": {"ticker":"SOL","date":"2026-11-14"},
  "max_amount": 100000, "purpose": "Daily SOL price for the treasury report" }
-> 200 { "order_id": "...", "status": "booked" | "denied" | "exception" | "pending_review" | "paid",
         "reason": "...", "data": { ... } }
```
- Every order outcome is **HTTP 200** (a denied order is a normal answer). `400 { "error": "..." }` means the body itself is invalid: `max_amount` must be a positive integer of base units, and `seller_id`, `item`, `purpose` non-empty strings, `params` an object. Nothing is saved for a 400.
- Flow: `checkOrder` → (`needsReview` → `pending_review`) → save `paying` → call the seller → `checkQuote` and the memo check → pay → `paid` → delivery checks → wait up to ~20 s for `tryBook` to book it.
- `status` is `paid` when the payment and delivery are done but the Streams webhook hasn't landed yet; booking still happens when it arrives.
- `reason` is the deny reason for `denied`, otherwise a short note. `data` is the seller's JSON body when there is one.


- `502 { "error": "...", "order_id": "..." }`: a payment **was signed** but settlement wasn't confirmed. The order stays `paying` (so a late payment still matches it) and the gateway never retries, because that could pay twice.

```
POST /api/orders/[id]/approve
```
- Works only if the order is still `pending_review`.
- Runs `checkOrder` again, because the daily total may have changed while the order waited. It does **not** run `needsReview` again; otherwise an approved $0.60 order would go straight back to `pending_review` and loop.
- Then it continues the normal flow: 402 quote, `checkQuote`, pay.
- The dashboard's Approve button calls this endpoint on a `pending_review` order. Approve on an exception calls `approveException`.

**Human actions on an exception (Cooper):**
```
POST /api/exceptions/[id]
{ "action": "approve" }        -> approveException(id)
{ "action": "block_seller" }   -> blockSeller(id)
-> 200 { "exception": { ...the exceptions row, with its new status } }
```
- `approve` sets the exception to `approved` and books the normal entry (debit `Data purchases expense`). `block_seller` sets it to `seller_blocked`, blocks the seller and books the loss (debit `Loss on undelivered purchases`). Both credit `USDC - agent wallet`.
- The dashboard's Approve and Block Seller buttons on an exception call this endpoint. Approve on a `pending_review` order calls `POST /api/orders/[id]/approve` instead.
- Errors are `{ "error": "<short message>" }`, never a stack trace or key:
  - `400`: the body is missing, isn't JSON, or `action` isn't exactly `approve` or `block_seller`.
  - `404`: no exception with that id.
  - `409`: the exception isn't `open` any more (already handled, e.g. a double click), or it's a `no_order` exception, which has no order to book or seller to block (resolving those is "what's next").
  - `500`: anything else, with `{ "error": "internal error" }`. The detail goes to the server log only.

**Dashboard copilot (read-only):**
```
POST /api/assistant
{ "messages": [{ "role": "user" | "assistant", "content": "..." }],      (ends with a user message)
  "context": { "section": "orders", "order_id": "...", "exception_id": "..." } }   (optional)
-> 200, streamed newline-delimited JSON:
   {"t":"text","v":"..."} | {"t":"tool","v":"<tool name>","a":"<order_id, get_order only>"}
   | {"t":"error","v":"..."} | {"t":"done"}
```
- Answers questions about the six tables with Claude. Its tools only read, from a snapshot loaded with the anon key (RLS: SELECT only), so it can't pay, approve, block or change anything. The dashboard buttons stay the only way to act.
- `context` is what the user is looking at, so "this order" works. `a` lets the dashboard link to the order's audit trail.
- `400 { "error": "..." }` for a bad body, `503` if `ANTHROPIC_API_KEY` isn't set.

**AI summaries (the one-sentence "why" in sections 1 and 3):**
```
POST /api/summaries
{ "order_id": "..." }   (optional: one order; otherwise up to 8 orders and 8 exceptions)
-> 200 { "orders": <n written>, "exceptions": <n written> }
```
- Writes **only** `orders.summary` / `exceptions.summary`, and only where it is still null, so it never overwrites a summary or touches a status. Skips orders still `paying`.
- Claude gets only facts built from the saved rows (the audit trail). It explains a decision; it never makes one.
- `400` for a bad `order_id`, `503` without `ANTHROPIC_API_KEY`, `500 { "error": "internal error" }`.

## 11. Who owns what

- **Nizar:** repo setup, the Supabase tables, the gateway and x402 payments (including `/approve`), the Streams webhook and matcher. Runs the memo test first. Submits.
- **Fabi:** the three fake sellers (pairing with Nizar on the x402 part), the delivery checks. Backup coder on the back end.
- **Aidan:** the dashboard, the human action buttons, the AI summaries. Checks every competitor claim against that company's own site. Edits the video.
- **Cooper:** `config/rules.json`, `lib/rules.ts`, `lib/booking.ts` (journal entries and exception logic), the buyer agent and demo scripts, README, video script.

One owner per part. To help with someone else's part, pair with them. Don't take it over.

## 12. Timeline

- **Thu Nov 12, after the 7 PM kickoff:** repo created with this spec in it. Memo test done. Tables created.
- **Sat Nov 14: beat 1 works end to end.** Ugly is fine.
- **Mon Nov 16:** beats 2 and 3 work. Streams vs. WebSocket decided.
- **Tue Nov 17:** beat 4 works. Summaries in. Dashboard polished.
- **Wed Nov 18:** feature freeze (exact time set on Sunday's call). Record the demo video and a backup video.
- **Thu Nov 19, before flights:** submit. Public repo, README with an architecture overview, working demo, 2–3 minute video.
- **Fri Nov 20, 1 PM ET:** submissions close. Emergencies only.

The recording day and the feature-freeze time get set on Sunday's call. Calls: Saturday night check-in, Sunday call.

## 13. Open questions

1. **Memo (Nizar):** can x402 on Solana carry our `order_id` in the memo? If not, match on `to_wallet` + `amount` + a 2-minute window after the order.
2. **Streams on devnet:** does QuickNode Streams support Solana devnet? If not, use a Solana WebSocket subscription, and we lose the Streams bounty.
3. ~~**Beat 3:** naive agent prompt, or have `beat3.ts` file the bad order directly?~~ Decided: `beat3.ts` files the bad order directly (see section 9).

## 14. How our Claudes work together

**At the start of every session:** read this file and everything in #hackathongroupaudit since your person's last handoff. Tell your person what changed that affects their part.
**At the end of every session:** post a handoff in #hackathongroupaudit, five lines max: what got built, the PR link, any change to shared data or endpoints, and what's needed from whom.

- Every change goes through a PR that someone else reviews. Nobody merges their own code.
- Posts appear under your person's name, marked "Sent by Claude."

## Glossary

- **x402:** paying for something over the web. You ask a URL for data, it answers "402: pay X to wallet Y," you pay, and you ask again with proof.
- **Devnet:** Solana's test network. Free fake money, real transactions.
- **Memo:** a short note attached to a Solana transaction. Ours carries the `order_id`.
- **QuickNode Streams:** watches the chain and sends our server each transaction involving our wallet.
- **Gateway:** our server, the only thing allowed to spend from the agent's wallet.
- **Journal entry:** the accounting record of a purchase. Debit an expense, credit cash.
