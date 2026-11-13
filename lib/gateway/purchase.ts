// The gateway's purchase flow (owner: Nizar). SPEC.md sections 3, 5 and 10.
//
//   checkOrder -> (needsReview -> pending_review) -> save `paying` -> call seller (402 quote)
//   -> checkQuote + memo guard (before signing) -> pay -> `paid` -> delivery checks
//   -> wait up to ~20 s for tryBook (via the webhook) to move the order to booked/exception.
//
// All I/O is injected (GatewayDeps), so tests cover every branch with fakes and no chain.

import type { Json, OrderRow, SellerRow } from "../db-types";
import { checkOrder, checkQuote, needsReview } from "../rules";
import type { RecordDelivery } from "./delivery";
import type { GatewayDb } from "./gateway-db";
import { checkPaymentMemo } from "./memo-guard";
import type { Pay } from "./pay";
import { sellerUrl, type OrderRequest } from "./validate";

/** Gateway-only deny reasons (SPEC section 5). The rule reasons come from lib/rules.ts. */
export const REASON_PAYMENT_FAILED = "payment failed";
export const REASON_MEMO_MISMATCH = "quote memo doesn't match order";

export type ResponseStatus = "booked" | "denied" | "exception" | "pending_review" | "paid";

export interface OrderResponse {
  order_id: string;
  status: ResponseStatus;
  reason: string;
  data: Json | null;
}

export type GatewayResult =
  | { http: 200; body: OrderResponse }
  | { http: 404 | 409 | 502; body: { error: string; order_id?: string } };

export interface GatewayDeps {
  db: GatewayDb;
  pay: Pay;
  recordDelivery: RecordDelivery;
  /** GATEWAY_WALLET_ADDRESS: todaySpent counts payments from this wallet. */
  gatewayWallet: string;
  newOrderId: () => string;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** How long to wait for booking after the delivery is saved (SPEC 0.19: ~20 s). */
  bookingWaitMs: number;
  pollMs: number;
}

const ok = (body: OrderResponse): GatewayResult => ({ http: 200, body });

/** POST /api/orders */
export async function placeOrder(request: OrderRequest, deps: GatewayDeps): Promise<GatewayResult> {
  const order_id = deps.newOrderId();
  const base = {
    order_id,
    seller_id: request.seller_id,
    item: request.item,
    params: request.params,
    max_amount: request.max_amount,
    purpose: request.purpose,
    deny_reason: null,
    quote_amount: null,
    quote_wallet: null,
  };

  const seller = await deps.db.getSeller(request.seller_id);
  const spent = await deps.db.todaySpent(deps.gatewayWallet, deps.now());
  const rule = checkOrder(request, seller, spent);
  if (!rule.ok) {
    await deps.db.insertOrder({ ...base, status: "denied", deny_reason: rule.reason });
    return ok({ order_id, status: "denied", reason: rule.reason, data: null });
  }
  if (needsReview(request)) {
    await deps.db.insertOrder({ ...base, status: "pending_review" });
    return ok({ order_id, status: "pending_review", reason: "waiting for human approval", data: null });
  }

  // Saved BEFORE any money can move, so the webhook always finds this order by its memo.
  const order = await deps.db.insertOrder({ ...base, status: "paying" });
  return purchase(order, seller as SellerRow, deps);
}

/** POST /api/orders/[id]/approve: re-run checkOrder (not needsReview), then the normal flow. */
export async function approveOrder(order_id: string, deps: GatewayDeps): Promise<GatewayResult> {
  const order = await deps.db.getOrder(order_id);
  if (!order) return { http: 404, body: { error: "order not found" } };
  if (order.status !== "pending_review") {
    return { http: 409, body: { error: `order is not pending_review (status ${order.status})`, order_id } };
  }

  const seller = await deps.db.getSeller(order.seller_id);
  const spent = await deps.db.todaySpent(deps.gatewayWallet, deps.now());
  const rule = checkOrder(order, seller, spent);
  if (!rule.ok) {
    const won = await deps.db.updateOrderIf(order_id, "pending_review", { status: "denied", deny_reason: rule.reason });
    if (!won) return { http: 409, body: { error: "order was already handled", order_id } };
    return ok({ order_id, status: "denied", reason: rule.reason, data: null });
  }

  // Claim it: a double click on Approve must not pay twice.
  const won = await deps.db.updateOrderIf(order_id, "pending_review", { status: "paying" });
  if (!won) return { http: 409, body: { error: "order was already handled", order_id } };
  return purchase({ ...order, status: "paying" }, seller as SellerRow, deps);
}

function parseData(body: string): Json | null {
  try {
    return JSON.parse(body) as Json;
  } catch {
    return null;
  }
}

async function purchase(order: OrderRow, seller: SellerRow, deps: GatewayDeps): Promise<GatewayResult> {
  const { order_id } = order;

  const outcome = await deps.pay({
    url: sellerUrl(seller.url, order.params as OrderRequest["params"]),
    orderId: order_id,
    decide: async (requirements, quote) => {
      if (!quote) return { ok: false, reason: "wrong asset or network" };
      const rule = checkQuote(order, quote, seller);
      if (!rule.ok) return { ok: false, reason: rule.reason };
      const memo = checkPaymentMemo(requirements, order_id);
      if (!memo.ok) return { ok: false, reason: REASON_MEMO_MISMATCH };
      // Record the accepted quote before signing: tryBook compares the payment against it.
      await deps.db.updateOrderIf(order_id, "paying", { quote_amount: quote.amount, quote_wallet: quote.wallet });
      return { ok: true };
    },
  });

  const quoteFields = outcome.quote
    ? { quote_amount: outcome.quote.amount, quote_wallet: outcome.quote.wallet }
    : {};

  switch (outcome.kind) {
    case "refused": {
      await deps.db.updateOrderIf(order_id, "paying", { status: "denied", deny_reason: outcome.reason, ...quoteFields });
      return ok({ order_id, status: "denied", reason: outcome.reason, data: null });
    }
    case "failed": {
      console.error(`gateway: payment for order ${order_id} failed before signing: ${outcome.error}`);
      await deps.db.updateOrderIf(order_id, "paying", { status: "denied", deny_reason: REASON_PAYMENT_FAILED, ...quoteFields });
      return ok({ order_id, status: "denied", reason: REASON_PAYMENT_FAILED, data: null });
    }
    case "unknown": {
      // Signed but unconfirmed: money MAY move. Leave the order `paying` so a late payment still
      // matches it instead of raising a false no_order. Never retry here (that could pay twice).
      console.error(`gateway: payment for order ${order_id} signed but unconfirmed: ${outcome.error}`);
      return {
        http: 502,
        body: { error: `payment outcome unknown (${outcome.error}); order left as paying`, order_id },
      };
    }
    case "paid":
      break;
  }

  await deps.db.updateOrderIf(order_id, "paying", { status: "paid", ...quoteFields });
  const paidOrder: OrderRow = { ...order, status: "paid", ...quoteFields };
  const data = parseData(outcome.body);

  const delivery = await deps.recordDelivery(paidOrder, outcome.body);
  if (!delivery) {
    return ok({ order_id, status: "paid", reason: `paid (${outcome.signature}); delivery checks not connected yet`, data });
  }

  // Booking needs both the delivery (saved) and the Streams webhook; wait a little for the webhook.
  const deadline = deps.now().getTime() + deps.bookingWaitMs;
  for (;;) {
    const current = await deps.db.getOrder(order_id);
    if (current?.status === "booked") return ok({ order_id, status: "booked", reason: "booked", data });
    if (current?.status === "exception") {
      return ok({ order_id, status: "exception", reason: "exception raised for human review", data });
    }
    if (deps.now().getTime() >= deadline) break;
    await deps.sleep(deps.pollMs);
  }
  return ok({ order_id, status: "paid", reason: `paid (${outcome.signature}); waiting for the payment from Streams`, data });
}
