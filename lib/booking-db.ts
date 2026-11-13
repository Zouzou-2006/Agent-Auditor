// The small Db interface lib/booking.ts is written against, and its Supabase
// implementation. Row types come from lib/db-types.ts (Nizar's). Tests use an
// in-memory fake (tests/fakeDb.ts). All amounts are integers in USDC base units.

import type { PostgrestSingleResponse, SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
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

// supabase-js requires each table's Row/Insert/Update to be assignable to
// Record<string, unknown>. The rows in lib/db-types.ts are `interface`s, which aren't
// (interfaces get no implicit index signature), so typed insert/update calls take `never`.
// Re-declaring them as mapped types fixes that without changing Nizar's file; his client
// still assigns to it directly. Drop this once db-types.ts declares its rows with `type`.
type Plain<T> = { [K in keyof T]: T[K] };
type Tables = Database["public"]["Tables"];
export type BookingDatabase = {
  public: Omit<Database["public"], "Tables"> & {
    Tables: {
      [K in keyof Tables]: {
        Row: Plain<Tables[K]["Row"]>;
        Insert: Plain<Tables[K]["Insert"]>;
        Update: Plain<Tables[K]["Update"]>;
        Relationships: [];
      };
    };
  };
};
type Client = SupabaseClient<BookingDatabase>;

/** Every query goes through this: a Supabase error is always thrown, never read as "no row". */
function check<T>(what: string, result: PostgrestSingleResponse<T>): T {
  if (result.error) {
    const { code, message, details, hint } = result.error;
    const extra = [details, hint && `hint: ${hint}`].filter(Boolean).join("; ");
    throw new Error(`booking-db: ${what} failed${code ? ` [${code}]` : ""}: ${message}${extra ? ` (${extra})` : ""}`);
  }
  return result.data;
}

/**
 * The Supabase-backed Db. Takes a function that returns the client, so the
 * client (and lib/db.ts, which is server-only) is only loaded on the first query.
 */
export function createSupabaseDb(getClient: () => Promise<Client>): Db {
  /**
   * For the conditional updates below, which run as one statement:
   * UPDATE ... SET status = to WHERE <key> = id AND status = from RETURNING <key>.
   * Postgres returns only the rows this statement changed, so one row back means this call won.
   */
  function changedOne(what: string, rows: unknown[]): boolean {
    if (rows.length > 1) throw new Error(`booking-db: ${what} changed ${rows.length} rows`);
    return rows.length === 1;
  }

  return {
    async getOrder(order_id) {
      const client = await getClient();
      return check(
        `getOrder ${order_id}`,
        await client.from("orders").select("*").eq("order_id", order_id).maybeSingle(),
      );
    },

    async getSeller(seller_id) {
      const client = await getClient();
      return check(
        `getSeller ${seller_id}`,
        await client.from("sellers").select("*").eq("seller_id", seller_id).maybeSingle(),
      );
    },

    async getPaymentForOrder(order_id) {
      const client = await getClient();
      // payments.order_id isn't unique; two payments for one order is an anomaly, so say so.
      const rows = check(
        `getPaymentForOrder ${order_id}`,
        await client.from("payments").select("*").eq("order_id", order_id).limit(2),
      );
      if (rows.length > 1) throw new Error(`booking-db: order ${order_id} has more than one payment`);
      return rows[0] ?? null;
    },

    async getDelivery(order_id) {
      const client = await getClient();
      return check(
        `getDelivery ${order_id}`,
        await client.from("deliveries").select("*").eq("order_id", order_id).maybeSingle(),
      );
    },

    async getException(exception_id) {
      const client = await getClient();
      return check(
        `getException ${exception_id}`,
        await client.from("exceptions").select("*").eq("exception_id", exception_id).maybeSingle(),
      );
    },

    async getExceptionByTx(tx_signature) {
      const client = await getClient();
      const rows = check(
        `getExceptionByTx ${tx_signature}`,
        await client.from("exceptions").select("*").eq("tx_signature", tx_signature).limit(1),
      );
      return rows[0] ?? null;
    },

    async updateOrderStatusIf(order_id, from, to) {
      const client = await getClient();
      const what = `update orders ${order_id} status ${from} -> ${to}`;
      const rows = check(
        what,
        await client.from("orders").update({ status: to }).eq("order_id", order_id).eq("status", from).select("order_id"),
      );
      return changedOne(what, rows);
    },

    async updateExceptionStatusIf(exception_id, from, to) {
      const client = await getClient();
      const what = `update exceptions ${exception_id} status ${from} -> ${to}`;
      const rows = check(
        what,
        await client
          .from("exceptions")
          .update({ status: to })
          .eq("exception_id", exception_id)
          .eq("status", from)
          .select("exception_id"),
      );
      return changedOne(what, rows);
    },

    async insertJournalEntry(entry) {
      const client = await getClient();
      return check(
        `insertJournalEntry for order ${entry.order_id}`,
        await client.from("journal_entries").insert(entry).select("*").single(),
      );
    },

    async insertException(exception) {
      const client = await getClient();
      return check(
        `insertException ${exception.type} for tx ${exception.tx_signature ?? "none"}`,
        await client.from("exceptions").insert(exception).select("*").single(),
      );
    },

    async setSellerStatus(seller_id, status) {
      const client = await getClient();
      const rows = check(
        `setSellerStatus ${seller_id} -> ${status}`,
        await client.from("sellers").update({ status }).eq("seller_id", seller_id).select("seller_id"),
      );
      // Blocking a seller that doesn't exist must not look like it worked.
      if (rows.length === 0) throw new Error(`booking-db: setSellerStatus: seller ${seller_id} not found`);
    },
  };
}

let defaultDb: Db | null = null;

/**
 * The app's Db: Supabase, through Nizar's getServiceClient() (service role, server only).
 * lib/db.ts is imported on the first query, not here, so importing lib/booking.ts in a
 * unit test never loads `server-only`.
 */
export function getDb(): Db {
  defaultDb ??= createSupabaseDb(async () => (await import("./db")).getServiceClient());
  return defaultDb;
}
