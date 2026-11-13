// Delivery checks (SPEC.md section 7). Owner: Fabi.
//
// After the gateway pays a seller, it hands us exactly what the seller returned. We run three
// plain-code checks (no AI), save a `deliveries` row, then call tryBook(order_id) so booking can
// happen once the Streams payment has also arrived.
//
// The checks run in order and the first failure stops the rest (later checks are saved as false):
//   1. received       the body isn't empty                                -> nothing_delivered
//   2. format         valid JSON with every field the item needs, typed   -> bad_format
//   3. matches_order  ticker and date equal the order's params            -> wrong_data
// Which exception each failure becomes is decided in lib/booking.ts (Cooper).

import { tryBook as realTryBook } from "./booking";
import type { DeliveryRow, Json, OrderRow } from "./db-types";

export interface DeliveryChecks {
  received: boolean;
  format: boolean;
  matches_order: boolean;
}

export interface CheckResult {
  checks: DeliveryChecks;
  passed: boolean;
}

type JsonObject = { [key: string]: Json | undefined };

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * The fields each item must have, and their types. Default deny: an item that isn't listed here
 * fails the format check.
 */
const ITEM_FORMATS: Record<string, Record<string, (value: unknown) => boolean>> = {
  price_quote: {
    ticker: (v) => typeof v === "string",
    date: isIsoDate,
    price_usd: (v) => typeof v === "number" && Number.isFinite(v),
    source: (v) => typeof v === "string",
  },
};

/** The fields that must equal the order's params, per item. */
const ITEM_MATCH_FIELDS: Record<string, string[]> = {
  price_quote: ["ticker", "date"],
};

function parseObject(body: string): JsonObject | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Runs the three checks. Pure: no database, so it's easy to test. */
export function runChecks(order: Pick<OrderRow, "item" | "params">, body: string): CheckResult {
  const fail = (checks: DeliveryChecks): CheckResult => ({ checks, passed: false });

  // 1. Received
  if (body.trim() === "") return fail({ received: false, format: false, matches_order: false });

  // 2. Format
  const format = ITEM_FORMATS[order.item];
  const data = parseObject(body);
  if (!format || !data || !Object.entries(format).every(([field, ok]) => ok(data[field]))) {
    return fail({ received: true, format: false, matches_order: false });
  }

  // 3. Matches the order
  const params = order.params;
  const fields = ITEM_MATCH_FIELDS[order.item] ?? [];
  const matches = isObject(params) && fields.every((field) => params[field] !== undefined && data[field] === params[field]);
  if (!matches) return fail({ received: true, format: true, matches_order: false });

  return { checks: { received: true, format: true, matches_order: true }, passed: true };
}

export type NewDelivery = Pick<DeliveryRow, "order_id" | "body" | "checks" | "passed">;

export interface DeliveryDeps {
  insertDelivery(delivery: NewDelivery): Promise<DeliveryRow>;
  tryBook(order_id: string): Promise<unknown>;
}

/** Real dependencies. lib/db.ts (server-only) is loaded on the first insert, not on import. */
const realDeps: DeliveryDeps = {
  async insertDelivery(delivery) {
    const client = (await import("./db")).getServiceClient();
    // `as never`: supabase-js types reject interface rows on insert (see the note in lib/booking-db.ts).
    const { data, error } = await client.from("deliveries").insert(delivery as never).select("*").single();
    if (error) throw new Error(`delivery: insert for order ${delivery.order_id} failed [${error.code}]: ${error.message}`);
    return data as DeliveryRow;
  },
  tryBook: (order_id) => realTryBook(order_id),
};

/**
 * Called by the gateway right after the seller returns data (interface agreed with Nizar in
 * Slack, Nov 13). Runs the checks, saves the `deliveries` row, then calls tryBook(order_id).
 */
export async function recordDelivery(order: OrderRow, body: string, deps: DeliveryDeps = realDeps): Promise<DeliveryRow> {
  const { checks, passed } = runChecks(order, body);
  const delivery = await deps.insertDelivery({ order_id: order.order_id, body, checks: { ...checks }, passed });
  await deps.tryBook(order.order_id);
  return delivery;
}
