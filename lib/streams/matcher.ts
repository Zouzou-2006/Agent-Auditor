// Streams matcher (SPEC.md sections 3, 4 and 8). Written by Fabi as backup back-end coder for
// Nizar's part: turns the transactions QuickNode Streams sends us into `payments` rows, then
// either books them (memo = a known order) or flags them (no order = the stolen-key case).
//
// Only OUTGOING USDC payments from our gateway wallet are recorded. Incoming money (faucet
// funding) and transactions that failed on chain are ignored, so they never raise a false alarm.

import rules from "../../config/rules.json";
import type { Json, PaymentRow } from "../db-types";
import { parsePayment, type ParsedTransaction } from "../solana/parse-payment";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const isTransaction = (v: unknown): v is ParsedTransaction =>
  isRecord(v) && isRecord(v.transaction) && Array.isArray((v.transaction as Record<string, unknown>).signatures);

/**
 * Pull every transaction out of a Streams payload. Accepted shapes (the Stream's filter decides
 * which one arrives, so we take all of them):
 *   [tx, ...]   {data: [tx, ...]}   [block, ...]   {data: [block, ...]}   a single tx or block
 * where tx is a jsonParsed getTransaction result and block has `transactions` and `blockTime`.
 * Nested arrays (Streams batching) are flattened.
 */
export function extractTransactions(payload: unknown): ParsedTransaction[] {
  const out: ParsedTransaction[] = [];
  const visit = (node: unknown, blockTime: number | null) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, blockTime);
    } else if (isTransaction(node)) {
      out.push(node.blockTime == null && blockTime != null ? { ...node, blockTime } : node);
    } else if (isRecord(node)) {
      const bt = typeof node.blockTime === "number" ? node.blockTime : blockTime;
      if (Array.isArray(node.transactions)) visit(node.transactions, bt);
      else if ("data" in node) visit(node.data, bt);
    }
  };
  visit(payload, null);
  return out;
}

/** The payment row for one transaction, or null if it isn't an outgoing USDC payment from us. */
export function toPaymentRow(tx: ParsedTransaction, gatewayWallet: string, receivedAt: Date): PaymentRow | null {
  const facts = parsePayment(tx);
  if (!facts.succeeded || !facts.signature) return null;

  const outgoing = facts.transfers.filter(
    (t) => t.sourceOwner === gatewayWallet && (t.mint === null || t.mint === rules.usdc_mint),
  );
  if (outgoing.length === 0) return null;

  // Every x402 or stolen-key payment we've seen is a single transfer. If there were several,
  // record the total and the first recipient; the full transaction is kept in `raw`.
  const amount = outgoing.reduce((sum, t) => sum + Number(t.amount), 0);
  const first = outgoing[0];
  const memo = facts.memos[0] ?? null;

  return {
    tx_signature: facts.signature,
    block_time: new Date((facts.blockTime ?? Math.floor(receivedAt.getTime() / 1000)) * 1000).toISOString(),
    from_wallet: gatewayWallet,
    // Owner wallet (SPEC 0.16). Falls back to the token account only if the owner isn't in the tx.
    to_wallet: first.destinationOwner ?? first.destination,
    amount,
    memo,
    order_id: null, // set by matchPayments once we know the memo is a real order
    raw: tx as unknown as Json,
  };
}

export interface MatcherDeps {
  /** True if an order with this id exists. */
  orderExists(order_id: string): Promise<boolean>;
  /** Insert the payment. Returns false if this tx_signature was already saved (Streams retries). */
  insertPayment(payment: PaymentRow): Promise<boolean>;
  tryBook(order_id: string): Promise<unknown>;
  flagUnmatchedPayment(payment: PaymentRow): Promise<unknown>;
}

export type MatchResult =
  | { tx_signature: string; result: "matched"; order_id: string }
  | { tx_signature: string; result: "no_order" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Save each outgoing payment, link it to its order by memo, then hand it to booking:
 * tryBook(order_id) when matched, flagUnmatchedPayment(payment) when not. Both are safe to call
 * again, so a retried delivery from Streams does no harm.
 */
export async function matchPayments(
  payload: unknown,
  gatewayWallet: string,
  deps: MatcherDeps,
  now: Date = new Date(),
): Promise<MatchResult[]> {
  const results: MatchResult[] = [];
  for (const tx of extractTransactions(payload)) {
    const row = toPaymentRow(tx, gatewayWallet, now);
    if (!row) continue;

    const memo = row.memo?.trim() ?? "";
    const order_id = UUID.test(memo) && (await deps.orderExists(memo)) ? memo.toLowerCase() : null;
    const payment: PaymentRow = { ...row, order_id };
    await deps.insertPayment(payment);

    if (order_id) {
      await deps.tryBook(order_id);
      results.push({ tx_signature: payment.tx_signature, result: "matched", order_id });
    } else {
      await deps.flagUnmatchedPayment(payment);
      results.push({ tx_signature: payment.tx_signature, result: "no_order" });
    }
  }
  return results;
}
