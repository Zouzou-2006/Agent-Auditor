// Input checks for the gateway (owner: Nizar). SPEC.md section 10.
// Pure functions: no I/O, so every edge case is unit-tested.

import type { Json } from "../db-types";
import type { Quote } from "../rules";

export interface OrderRequest {
  seller_id: string;
  item: string;
  params: { [key: string]: Json | undefined };
  /** integer USDC base units */
  max_amount: number;
  purpose: string;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/**
 * Validate a POST /api/orders body. `max_amount` must be a positive safe integer of base units:
 * no strings, decimals, negatives, NaN or Infinity (money is never a float here).
 */
export function parseOrderRequest(body: unknown): Parsed<OrderRequest> {
  if (!isObject(body)) return { ok: false, error: "body must be a JSON object" };
  const { seller_id, item, params, max_amount, purpose } = body;
  if (!nonEmpty(seller_id)) return { ok: false, error: "seller_id must be a non-empty string" };
  if (!nonEmpty(item)) return { ok: false, error: "item must be a non-empty string" };
  if (!isObject(params)) return { ok: false, error: "params must be a JSON object" };
  if (typeof max_amount !== "number" || !Number.isSafeInteger(max_amount) || max_amount <= 0) {
    return { ok: false, error: "max_amount must be a positive integer of USDC base units" };
  }
  if (!nonEmpty(purpose)) return { ok: false, error: "purpose must be a non-empty string" };
  for (const [key, value] of Object.entries(params)) {
    if (!["string", "number", "boolean"].includes(typeof value)) {
      return { ok: false, error: `params.${key} must be a string, number or boolean` };
    }
  }
  return {
    ok: true,
    value: { seller_id, item, params: params as OrderRequest["params"], max_amount, purpose },
  };
}

/**
 * x402 sends `amount` as a base-units STRING. Convert it to a safe integer for checkQuote
 * (Cooper's rule 4). Anything that isn't a plain non-negative integer string is rejected.
 */
export function parseQuoteAmount(amount: unknown): number | null {
  if (typeof amount !== "string" || !/^\d+$/.test(amount)) return null;
  const n = Number(amount);
  return Number.isSafeInteger(n) ? n : null;
}

/** The `{ amount, wallet, asset, network }` quote that rules.checkQuote expects. */
export function toQuote(requirements: {
  amount: unknown;
  payTo: unknown;
  asset: unknown;
  network: unknown;
}): Quote | null {
  const amount = parseQuoteAmount(requirements.amount);
  if (amount === null) return null;
  if (typeof requirements.payTo !== "string" || typeof requirements.asset !== "string") return null;
  if (typeof requirements.network !== "string") return null;
  return { amount, wallet: requirements.payTo, asset: requirements.asset, network: requirements.network };
}

/** `?ticker=SOL&date=2026-11-14` for the seller call (SPEC section 6 seller contract). */
export function sellerUrl(base: string, params: OrderRequest["params"]): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}
