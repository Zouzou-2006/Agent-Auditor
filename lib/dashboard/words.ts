// Plain-language words for the dashboard (owner: Aidan). Pure functions: rows in, sentences out.
// Every screen prefers the Claude-written `summary` columns; these are the fallback when a summary
// is still null, and the labels a controller reads instead of raw status codes. Deny reasons are
// always quoted exactly (SPEC.md section 5). Money is integer base units until it is formatted here.

import type { ExceptionRow, ExceptionSeverity, ExceptionStatus, ExceptionType, OrderRow, OrderStatus, PaymentRow, SellerRow, SellerStatus } from "../db-types";
import { formatUsd, type ProvenanceBasis } from "./model";

/** 100000 -> "$0.10". Integer math (formatUsd); null -> "—". */
export function dollars(baseUnits: number | null | undefined): string {
  return formatUsd(baseUnits);
}

/** The seller's display name, or its raw id plus "(not approved)" when it isn't in the sellers table. */
export function sellerName(sellerId: string, sellers: SellerRow[]): string {
  return sellers.find((s) => s.seller_id === sellerId)?.name ?? `${sellerId} (not approved)`;
}

const withArticle = (label: string) => `${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}`;
const words = (raw: string) => raw.replace(/_/g, " ").trim();
const has = <T extends object>(map: T, key: string): key is Extract<keyof T, string> => Object.prototype.hasOwnProperty.call(map, key);

function paramsOf(order: Pick<OrderRow, "params">): Record<string, unknown> {
  const p = order.params;
  return p && typeof p === "object" && !Array.isArray(p) ? p : {};
}

/** "2026-11-14" -> "Nov 14". A calendar date, so no time zone shift; null if it isn't a real YYYY-MM-DD. */
export function shortDate(isoDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const ms = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== isoDate) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(ms);
}

/** "price_quote" with ticker SOL -> "a SOL price"; anything else -> "a premium report". */
export function itemPhrase(order: Pick<OrderRow, "item" | "params">): string {
  const ticker = paramsOf(order).ticker;
  if (order.item === "price_quote" && typeof ticker === "string" && ticker.trim()) return `a ${ticker.trim().toUpperCase()} price`;
  return withArticle(words(order.item) || "data purchase");
}

/** The item for a table cell or a title: "SOL price for Nov 14"; any other item is its name in words ("premium report"). */
export function itemLabel(order: Pick<OrderRow, "item" | "params">): string {
  const params = paramsOf(order);
  const ticker = typeof params.ticker === "string" ? params.ticker.trim().toUpperCase() : "";
  if (order.item === "price_quote" && ticker) {
    const day = typeof params.date === "string" ? shortDate(params.date) : null;
    return day ? `${ticker} price for ${day}` : `${ticker} price`;
  }
  return words(order.item) || "data purchase";
}

/** {"ticker":"SOL","date":"2026-11-14"} -> "Ticker SOL · Date Nov 14". What was asked for, without JSON. */
export function paramsText(params: unknown): string {
  const entries = Object.entries(paramsOf({ params: params as OrderRow["params"] }));
  if (entries.length === 0) return "—";
  return entries
    .map(([k, v]) => {
      const key = words(k);
      const value = typeof v === "string" ? (shortDate(v) ?? v) : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
      return `${key.charAt(0).toUpperCase()}${key.slice(1)} ${value}`;
    })
    .join(" · ");
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
  booked: "Booked",
  denied: "Blocked",
  paying: "Processing",
  paid: "Processing",
  pending_review: "Waiting for approval",
  exception: "Problem found",
};

export function friendlyStatus(status: OrderStatus): string {
  return FRIENDLY[status];
}

/** A status string from an API reply: in words when it's an order status, otherwise shown as is. */
export function statusLabel(raw: string): string {
  return has(FRIENDLY, raw) ? FRIENDLY[raw] : raw;
}

export const SEVERITY_LABEL: Record<ExceptionSeverity, string> = { critical: "Critical", high: "High", medium: "Medium" };

export const SELLER_STATUS_LABEL: Record<SellerStatus, string> = { approved: "Approved", blocked: "Blocked" };

/** The chip on each audit-trail step: who or what decided it. */
export const PROVENANCE_LABEL: Record<ProvenanceBasis, string> = { deterministic: "Rule", "on-chain": "Blockchain", human: "Person" };

/** The copilot's read-only lookups (lib/assistant/tools.ts), shown as "data looked up" chips. */
const TOOL_LABEL: Record<string, string> = {
  get_overview: "Overview",
  list_orders: "Orders",
  get_order: "Order details",
  list_exceptions: "Exceptions",
  list_payments: "Payments",
  list_sellers: "Sellers",
  daily_spend: "Today's spending",
};

export function toolLabel(name: string): string {
  return has(TOOL_LABEL, name) ? TOOL_LABEL[name] : words(name);
}

/** config/rules.json `network` (the CAIP-2 id x402 quotes send) -> its plain name. */
const NETWORK_LABEL: Record<string, string> = { "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "Solana devnet" };

export function networkLabel(network: string): string {
  return has(NETWORK_LABEL, network) ? NETWORK_LABEL[network] : network;
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
