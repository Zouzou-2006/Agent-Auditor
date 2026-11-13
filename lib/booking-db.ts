// The small Db interface lib/booking.ts is written against. Row types come from
// lib/db-types.ts (Nizar's). Tests use an in-memory fake (tests/fakeDb.ts); the
// Supabase-backed version is the next PR. All amounts are integers in USDC base units.

import type {
  DeliveryRow,
  ExceptionRow,
  ExceptionStatus,
  JournalEntryRow,
  OrderRow,
  OrderStatus,
  PaymentRow,
  SellerRow,
  SellerStatus,
} from "./db-types";

/** The database assigns entry_id. */
export type NewJournalEntry = Omit<JournalEntryRow, "entry_id">;
/** The database assigns exception_id and created_at. */
export type NewException = Omit<ExceptionRow, "exception_id" | "created_at">;

export interface Db {
  getOrder(order_id: string): Promise<OrderRow | null>;
  getSeller(seller_id: string): Promise<SellerRow | null>;
  getPaymentForOrder(order_id: string): Promise<PaymentRow | null>;
  getDelivery(order_id: string): Promise<DeliveryRow | null>;
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

  insertJournalEntry(entry: NewJournalEntry): Promise<JournalEntryRow>;
  insertException(exception: NewException): Promise<ExceptionRow>;

  setSellerStatus(seller_id: string, status: SellerStatus): Promise<void>;
}

/**
 * STUB, not the real implementation. The Supabase-backed Db (built on
 * getServiceClient() from lib/db.ts) is the next PR. Until then this throws, so
 * every booking function must be passed a Db explicitly (the tests pass FakeDb).
 */
export function getDb(): Db {
  throw new Error("getDb: Supabase Db not implemented yet; pass a Db explicitly");
}
