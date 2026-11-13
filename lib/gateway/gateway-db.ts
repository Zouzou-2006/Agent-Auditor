// Database access for the gateway (owner: Nizar). Writes `orders`, reads `sellers` and `payments`.
// Server only: built on the service-role client from lib/db.ts. The gateway is written against
// the GatewayDb interface so tests use an in-memory fake (tests/gateway/fakeGatewayDb.ts).

import type { PostgrestSingleResponse, SupabaseClient } from "@supabase/supabase-js";
import type { Database, OrderRow, OrderStatus, SellerRow } from "../db-types";

export type NewOrder = Omit<OrderRow, "created_at" | "summary">;
export type OrderPatch = Partial<Pick<OrderRow, "status" | "deny_reason" | "quote_amount" | "quote_wallet">>;

export interface GatewayDb {
  getSeller(seller_id: string): Promise<SellerRow | null>;
  getOrder(order_id: string): Promise<OrderRow | null>;
  insertOrder(order: NewOrder): Promise<OrderRow>;
  /** Compare-and-set: apply `patch` only if the order's status is currently `from`. */
  updateOrderIf(order_id: string, from: OrderStatus, patch: OrderPatch): Promise<boolean>;
  /**
   * todaySpent (SPEC section 5): sum of payments.amount from `wallet` with block_time in the
   * current UTC day, matched or not. Integer base units.
   */
  todaySpent(wallet: string, now: Date): Promise<number>;
}

type Client = SupabaseClient<Database>;

/** Every query goes through this: a Supabase error is always thrown, never read as "no row". */
function check<T>(what: string, result: PostgrestSingleResponse<T>): T {
  if (result.error) {
    const { code, message } = result.error;
    throw new Error(`gateway-db: ${what} failed${code ? ` [${code}]` : ""}: ${message}`);
  }
  return result.data;
}

export function utcDayBounds(now: Date): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function createSupabaseGatewayDb(getClient: () => Promise<Client>): GatewayDb {
  return {
    async getSeller(seller_id) {
      const client = await getClient();
      return check(`getSeller ${seller_id}`, await client.from("sellers").select("*").eq("seller_id", seller_id).maybeSingle());
    },

    async getOrder(order_id) {
      const client = await getClient();
      return check(`getOrder ${order_id}`, await client.from("orders").select("*").eq("order_id", order_id).maybeSingle());
    },

    async insertOrder(order) {
      const client = await getClient();
      return check(`insertOrder ${order.order_id}`, await client.from("orders").insert(order).select("*").single());
    },

    async updateOrderIf(order_id, from, patch) {
      const client = await getClient();
      const rows = check(
        `updateOrderIf ${order_id}`,
        await client.from("orders").update(patch).eq("order_id", order_id).eq("status", from).select("order_id"),
      );
      if (rows.length > 1) throw new Error(`gateway-db: updateOrderIf ${order_id} changed ${rows.length} rows`);
      return rows.length === 1;
    },

    async todaySpent(wallet, now) {
      const client = await getClient();
      const { start, end } = utcDayBounds(now);
      const rows = check(
        `todaySpent ${wallet}`,
        await client
          .from("payments")
          .select("amount")
          .eq("from_wallet", wallet)
          .gte("block_time", start)
          .lt("block_time", end),
      );
      return rows.reduce((sum, row) => sum + row.amount, 0);
    },
  };
}

let defaultDb: GatewayDb | null = null;

export function getGatewayDb(): GatewayDb {
  defaultDb ??= createSupabaseGatewayDb(async () => (await import("../db")).getServiceClient());
  return defaultDb;
}
