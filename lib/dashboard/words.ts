// Plain-language words for the dashboard (owner: Aidan). Pure functions: rows in, sentences out.
// Every screen prefers the Claude-written `summary` columns; these are the fallback when a summary
// is still null, and the labels a controller reads instead of raw status codes. Deny reasons are
// always quoted exactly (SPEC.md section 5). Money is integer base units until it is formatted here.

import type { ExceptionRow, ExceptionStatus, ExceptionType, OrderRow, OrderStatus, PaymentRow, SellerRow } from "../db-types";
import { formatUsd } from "./model";

/** 100000 -> "$0.10". Integer math (formatUsd); null -> "—". */
export function dollars(baseUnits: number | null | undefined): string {
  return formatUsd(baseUnits);
}

/** The seller's display name, or its raw id plus "(not approved)" when it isn't in the sellers table. */
export function sellerName(sellerId: string, sellers: SellerRow[]): string {
  return sellers.find((s) => s.seller_id === sellerId)?.name ?? `${sellerId} (not approved)`;
}

const withArticle = (label: string) => `${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}`;

/** "price_quote" with ticker SOL -> "a SOL price"; anything else -> "a premium report". */
export function itemPhrase(order: Pick<OrderRow, "item" | "params">): string {
  const params = order.params && typeof order.params === "object" && !Array.isArray(order.params) ? order.params : {};
  const ticker = typeof params.ticker === "string" ? params.ticker.trim() : "";
  if (order.item === "price_quote" && ticker) return `a ${ticker.toUpperCase()} price`;
  return withArticle(order.item.replace(/_/g, " ").trim() || "data purchase");
}

/** One plain line per order, no amount (screens show the amount in its own column). */
export function orderSentence(order: OrderRow, seller: string): string {
  const what = itemPhrase(order);
  switch (order.status) {
    case "booked":
      return `Bought ${what} from ${seller}`;
    case "paid":
      return `Paid ${seller} for ${what}, confirming on chain`;
    case "paying":
      return `Paying ${seller} for ${what}`;
    case "denied":
      return `Blocked ${what} from ${seller}: ${order.deny_reason ?? "no reason saved"}`;
    case "pending_review":
      return `Wants your approval to buy ${what} from ${seller}`;
    case "exception":
      return `Bought ${what} from ${seller}, but something went wrong`;
  }
}

/** The fixed review line for a pending_review order: the numbers a human decides on. */
export function reviewSentence(order: OrderRow, seller: string, reviewOver: number): string {
  return `Your agent wants to buy ${itemPhrase(order)} from ${seller} for ${dollars(order.max_amount)}. Over your ${dollars(reviewOver)} review limit.`;
}

/** One sentence per exception type. `seller` is a display name, or null when unknown. */
export function exceptionSentence(exc: ExceptionRow, order: OrderRow | null, payment: PaymentRow | null, seller: string | null): string {
  const paidAmount = payment?.amount ?? order?.quote_amount ?? order?.max_amount ?? null;
  switch (exc.type) {
    case "no_order":
      return `${payment ? dollars(payment.amount) : "Money"} sent to an unknown wallet with no order behind it. Possible stolen key.`;
    case "wallet_mismatch":
      return "Payment went to a different wallet than the order.";
    case "amount_mismatch":
      return `Paid ${dollars(payment?.amount)} but the order was for ${dollars(order?.quote_amount ?? order?.max_amount)}.`;
    case "nothing_delivered":
      return `Paid ${seller ?? "the seller"}${paidAmount !== null ? ` ${dollars(paidAmount)}` : ""} and got nothing back.`;
    case "bad_format":
      return "The delivery arrived but the format was wrong.";
    case "wrong_data":
      return "The delivery didn't match what was ordered.";
  }
}

/** Short title per exception type, for headings and table cells. */
export const EXCEPTION_TITLE: Record<ExceptionType, string> = {
  no_order: "Payment with no order",
  wallet_mismatch: "Wrong wallet",
  amount_mismatch: "Wrong amount",
  nothing_delivered: "Nothing delivered",
  bad_format: "Bad format",
  wrong_data: "Wrong data",
};

export const EXCEPTION_STATUS_LABEL: Record<ExceptionStatus, string> = {
  open: "Open",
  approved: "Approved",
  seller_blocked: "Seller blocked",
};

const FRIENDLY: Record<OrderStatus, string> = {
  booked: "Completed",
  denied: "Blocked",
  paying: "Processing",
  paid: "Processing",
  pending_review: "Waiting for approval",
  exception: "Problem found",
};

export function friendlyStatus(status: OrderStatus): string {
  return FRIENDLY[status];
}

/** "just now", "5m ago", "2h ago", "3d ago", then an ET date like "Nov 3". */
export function timeShort(iso: string, now: number): string {
  const seconds = Math.round((now - Date.parse(iso)) / 1000);
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d ago`;
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }).format(Date.parse(iso));
}
