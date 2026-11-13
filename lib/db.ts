// Row types for the Agent Auditor tables, plus the small Db interface that
// lib/booking.ts is written against. Back it with Supabase later; tests use an
// in-memory fake. All amounts are integers in USDC base units (1 USDC = 1_000_000).

export type OrderStatus = "pending_review" | "denied" | "paid" | "booked" | "exception";
export type ExceptionStatus = "open" | "approved" | "seller_blocked";
export type SellerStatus = "approved" | "blocked";

export type ExceptionType =
  | "wallet_mismatch"
  | "amount_mismatch"
  | "nothing_delivered"
  | "bad_format"
  | "wrong_data"
  | "no_order";
export type Severity = "critical" | "high" | "medium";

export interface Order {
  order_id: string;
  seller_id: string;
  item: string; // e.g. "price_quote"
  params: Record<string, unknown>; // jsonb, e.g. {"ticker":"SOL","date":"2026-11-14"}
  status: OrderStatus;
  quote_amount: number | null; // null until the seller's 402 arrives (e.g. denied by rules 1–3)
  quote_wallet: string | null;
}

export interface Payment {
  tx_signature: string;
  from_wallet: string;
  to_wallet: string;
  amount: number;
  memo: string | null;
  order_id: string | null; // null = we couldn't match it to an order
  block_time: string; // timestamptz, arrives as ISO 8601, e.g. "2026-11-13T15:30:00+00:00"
}

export interface DeliveryChecks {
  received: boolean;
  format: boolean;
  matches_order: boolean;
}

export interface Delivery {
  order_id: string;
  checks: DeliveryChecks;
  passed: boolean;
}

export interface JournalEntry {
  entry_id: string;
  order_id: string;
  tx_signature: string;
  entry_date: string; // YYYY-MM-DD (UTC)
  debit_account: string;
  credit_account: string;
  amount: number;
  description: string;
}

export interface ExceptionRow {
  exception_id: string;
  order_id: string | null; // null for the stolen-key case
  tx_signature: string | null; // null if no payment happened
  type: ExceptionType;
  severity: Severity;
  summary: string;
  status: ExceptionStatus;
}

export interface Seller {
  seller_id: string;
  name: string;
  wallet: string;
  status: SellerStatus;
}

export interface Db {
  getOrder(order_id: string): Promise<Order | null>;
  getSeller(seller_id: string): Promise<Seller | null>;
  getPaymentForOrder(order_id: string): Promise<Payment | null>;
  getDelivery(order_id: string): Promise<Delivery | null>;
  getException(exception_id: string): Promise<ExceptionRow | null>;
  /** Any exception already raised for this transaction, or null. */
  getExceptionByTx(tx_signature: string): Promise<ExceptionRow | null>;

  /**
   * Atomic compare-and-set: set status to `to` only if it is currently `from`.
   * Returns true if this call made the change, false if someone else got there first.
   * Supabase: update({status: to}).eq("order_id", id).eq("status", from).select()
   * and return true when exactly one row comes back.
   */
  updateOrderStatusIf(order_id: string, from: OrderStatus, to: OrderStatus): Promise<boolean>;
  /** Same compare-and-set, for exceptions. */
  updateExceptionStatusIf(
    exception_id: string,
    from: ExceptionStatus,
    to: ExceptionStatus,
  ): Promise<boolean>;

  /** The database assigns entry_id / exception_id. */
  insertJournalEntry(entry: Omit<JournalEntry, "entry_id">): Promise<JournalEntry>;
  insertException(exception: Omit<ExceptionRow, "exception_id">): Promise<ExceptionRow>;

  setSellerStatus(seller_id: string, status: SellerStatus): Promise<void>;
}

/**
 * STUB, not the real implementation. The Supabase-backed Db is the next step,
 * once Nizar's table migration lands. Until then this throws, so every booking
 * function must be passed a Db explicitly (the tests pass FakeDb).
 */
export function getDb(): Db {
  throw new Error("getDb: Supabase Db not implemented yet; pass a Db explicitly");
}
