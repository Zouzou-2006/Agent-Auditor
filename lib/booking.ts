import { getDb } from "./db";
import type {
  Db,
  Delivery,
  DeliveryChecks,
  ExceptionRow,
  ExceptionType,
  JournalEntry,
  Order,
  Payment,
  Seller,
  Severity,
} from "./db";

export const ACCOUNTS = {
  dataExpense: "Data purchases expense",
  agentWallet: "USDC - agent wallet",
  undeliveredLoss: "Loss on undelivered purchases",
} as const;

export type TryBookResult =
  | { result: "waiting" } // payment or delivery hasn't arrived yet
  | { result: "skipped" } // order isn't in "paid" state, or another call already claimed it
  | { result: "booked"; entry: JournalEntry }
  | { result: "exception"; exception: ExceptionRow };

interface Problem {
  type: ExceptionType;
  severity: Severity;
  summary: string;
}

// Delivery checks in the order they're evaluated; the first failure names the problem.
const DELIVERY_CHECKS: { check: keyof DeliveryChecks; type: ExceptionType; severity: Severity }[] = [
  { check: "received", type: "nothing_delivered", severity: "high" },
  { check: "format", type: "bad_format", severity: "medium" },
  { check: "matches_order", type: "wrong_data", severity: "medium" },
];

/**
 * Returns the single most severe problem, or null if the purchase is clean.
 * Checks run from most to least severe, so the first hit wins:
 * wallet_mismatch (critical) > amount_mismatch (high) > nothing_delivered (high)
 * > bad_format (medium) > wrong_data (medium).
 * The summary is a factual fallback; the AI summary may overwrite it later.
 */
export function findProblem(order: Order, payment: Payment, delivery: Delivery): Problem | null {
  if (payment.to_wallet !== order.quote_wallet) {
    return {
      type: "wallet_mismatch",
      severity: "critical",
      summary: `Paid ${payment.to_wallet}, but the quote's wallet was ${order.quote_wallet ?? "missing"}`,
    };
  }
  if (payment.amount !== order.quote_amount) {
    return {
      type: "amount_mismatch",
      severity: "high",
      summary: `Paid ${payment.amount}, but the quote was ${order.quote_amount ?? "missing"}`,
    };
  }
  const failed = DELIVERY_CHECKS.find((c) => !delivery.checks[c.check]);
  if (failed) {
    return {
      type: failed.type,
      severity: failed.severity,
      summary: `Delivery failed the "${failed.check}" check`,
    };
  }
  if (!delivery.passed) {
    // passed=false with no failed check shouldn't happen; treat it as wrong data.
    return { type: "wrong_data", severity: "medium", summary: "Delivery did not pass" };
  }
  return null;
}

/**
 * Journal description, per SPEC.md: "SOL price quote from DataCo" for a price_quote,
 * "<item> from <seller name>" for anything else. Falls back to seller_id if the
 * seller row is missing, so booking never fails on a label.
 */
export function describePurchase(order: Order, seller: Seller | null): string {
  const sellerName = seller?.name ?? order.seller_id;
  const ticker = order.params.ticker;
  if (order.item === "price_quote" && typeof ticker === "string") {
    return `${ticker} price quote from ${sellerName}`;
  }
  return `${order.item} from ${sellerName}`;
}

/** UTC calendar date (YYYY-MM-DD) of the payment's timestamptz block_time. */
function entryDate(payment: Payment): string {
  const t = new Date(payment.block_time);
  if (Number.isNaN(t.getTime())) {
    throw new Error(`payment ${payment.tx_signature} has an invalid block_time: ${payment.block_time}`);
  }
  return t.toISOString().slice(0, 10);
}

function purchaseEntry(order: Order, payment: Payment, seller: Seller | null): Omit<JournalEntry, "entry_id"> {
  return {
    order_id: order.order_id,
    tx_signature: payment.tx_signature,
    entry_date: entryDate(payment),
    debit_account: ACCOUNTS.dataExpense,
    credit_account: ACCOUNTS.agentWallet,
    amount: payment.amount, // what actually left the wallet
    description: describePurchase(order, seller),
  };
}

/**
 * Called by both the payment webhook and the delivery check, in either order.
 * Books the order once both a matched payment and a delivery exist.
 * Assumes the gateway set the order to "paid" after paying.
 */
export async function tryBook(order_id: string, db: Db = getDb()): Promise<TryBookResult> {
  const order = await db.getOrder(order_id);
  if (!order || order.status !== "paid") return { result: "skipped" };

  const [payment, delivery, seller] = await Promise.all([
    db.getPaymentForOrder(order_id),
    db.getDelivery(order_id),
    db.getSeller(order.seller_id),
  ]);
  if (!payment || !delivery) return { result: "waiting" };

  const problem = findProblem(order, payment, delivery);

  // Claim the order: only one caller can move it out of "paid".
  const won = await db.updateOrderStatusIf(order_id, "paid", problem ? "exception" : "booked");
  if (!won) return { result: "skipped" };

  if (!problem) {
    return { result: "booked", entry: await db.insertJournalEntry(purchaseEntry(order, payment, seller)) };
  }
  const exception = await db.insertException({
    order_id,
    tx_signature: payment.tx_signature,
    type: problem.type,
    severity: problem.severity,
    summary: problem.summary,
    status: "open",
  });
  return { result: "exception", exception };
}

/**
 * A payment we couldn't tie to any order. Flag it; never book it.
 * Webhooks retry, so if this transaction already has an exception, do nothing and return null.
 */
export async function flagUnmatchedPayment(payment: Payment, db: Db = getDb()): Promise<ExceptionRow | null> {
  if (await db.getExceptionByTx(payment.tx_signature)) return null;
  return db.insertException({
    order_id: null,
    tx_signature: payment.tx_signature,
    type: "no_order",
    severity: "critical",
    summary: `Payment of ${payment.amount} to ${payment.to_wallet} matches no order`,
    status: "open",
  });
}

async function loadExceptionContext(db: Db, exception_id: string) {
  const exception = await db.getException(exception_id);
  if (!exception) throw new Error(`exception ${exception_id} not found`);
  if (exception.order_id === null) {
    throw new Error(`exception ${exception_id} has no order (type ${exception.type})`);
  }
  const order = await db.getOrder(exception.order_id);
  const payment = await db.getPaymentForOrder(exception.order_id);
  if (!order || !payment) throw new Error(`order or payment missing for exception ${exception_id}`);
  const seller = await db.getSeller(order.seller_id);
  return { exception, order, payment, seller };
}

/**
 * A human accepts the purchase despite the problem: book the normal entry.
 * Returns null if the exception was already resolved (e.g. a double click).
 */
export async function approveException(exception_id: string, db: Db = getDb()): Promise<JournalEntry | null> {
  const { order, payment, seller } = await loadExceptionContext(db, exception_id);
  if (!(await db.updateExceptionStatusIf(exception_id, "open", "approved"))) return null;

  const entry = await db.insertJournalEntry(purchaseEntry(order, payment, seller));
  await db.updateOrderStatusIf(order.order_id, "exception", "booked");
  return entry;
}

/**
 * A human decides the seller cheated: block them and write the money off as a loss.
 * Returns null if the exception was already resolved.
 */
export async function blockSeller(exception_id: string, db: Db = getDb()): Promise<JournalEntry | null> {
  const { order, payment, seller } = await loadExceptionContext(db, exception_id);
  if (!(await db.updateExceptionStatusIf(exception_id, "open", "seller_blocked"))) return null;

  await db.setSellerStatus(order.seller_id, "blocked");
  return db.insertJournalEntry({
    order_id: order.order_id,
    tx_signature: payment.tx_signature,
    entry_date: entryDate(payment),
    debit_account: ACCOUNTS.undeliveredLoss,
    credit_account: ACCOUNTS.agentWallet,
    amount: payment.amount,
    description: `Loss on undelivered ${describePurchase(order, seller)}`,
  });
}
