// Pure helpers for the Overview page (owner: Aidan). No React, no Supabase: rows in, plain values out.
// Sentences prefer the Claude-written `summary` columns; the formatters here are the fallback when
// a summary is still null. Money stays integer base units until formatUsd. Times are shown in
// America/New_York; the $5 daily rule itself stays UTC in the gateway (SPEC.md section 5).

import type { ExceptionRow, ExceptionSeverity, OrderRow } from "../db-types";
import { formatUsd, outgoing, paymentTxByOrder, type DashboardData, type Rules } from "./model";

export const DASHBOARD_TZ = "America/New_York";
const DAY_MS = 86_400_000;

type EtParts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: string };

function etParts(ms: number): EtParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DASHBOARD_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(ms);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: get("weekday"),
  };
}

/** ET offset from UTC at instant `ms`, in ms (for example -5 h in winter, -4 h in summer). */
function etOffsetMs(ms: number): number {
  const p = etParts(ms);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** The UTC instant of midnight ET on the given ET calendar date. */
export function etMidnightUtc(year: number, month: number, day: number): number {
  const utcMidnight = Date.UTC(year, month - 1, day);
  return utcMidnight - etOffsetMs(utcMidnight + 12 * 3_600_000);
}

const WEEKDAY_FROM_MONDAY: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** Monday 00:00 ET of the week containing `now`, as epoch ms. */
export function weekStartEt(now: number): number {
  const p = etParts(now);
  const monday = new Date(Date.UTC(p.year, p.month - 1, p.day) - (WEEKDAY_FROM_MONDAY[p.weekday] ?? 0) * DAY_MS);
  return etMidnightUtc(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate());
}

/** The next UTC midnight after `now`: when the gateway's daily limit resets. */
export function nextUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/** "7:00 PM" in ET. */
export function etClock(ms: number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: DASHBOARD_TZ, hour: "numeric", minute: "2-digit" }).format(ms);
}

/** "price_quote" -> "a price quote". */
export function itemPhrase(item: string): string {
  const label = item.replace(/_/g, " ").trim() || "data";
  return `${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}`;
}

export function sellerName(data: DashboardData, sellerId: string): string {
  return data.sellers.find((s) => s.seller_id === sellerId)?.name ?? sellerId;
}

/** What the order cost or would cost: the seller's quote once known, otherwise the max. */
export function orderAmount(order: OrderRow): number {
  return order.quote_amount ?? order.max_amount;
}

/** Plain sentence for an order, used when orders.summary is null. Deny reasons are quoted exactly. */
export function orderSentence(order: OrderRow, data: DashboardData): string {
  const seller = sellerName(data, order.seller_id);
  const what = itemPhrase(order.item);
  const amount = formatUsd(orderAmount(order));
  switch (order.status) {
    case "booked":
      return `Bought ${what} from ${seller} for ${amount}. Delivered as ordered and booked.`;
    case "paid":
      return `Paid ${seller} ${amount} for ${what}. Waiting for the chain to confirm before booking.`;
    case "paying":
      return `Paying ${seller} ${amount} for ${what}.`;
    case "denied":
      return `Blocked ${what} from ${seller}: ${order.deny_reason ?? "no reason saved"}. No money moved.`;
    case "pending_review":
      return `Waiting for your approval: ${what} from ${seller} for ${formatUsd(order.max_amount)}.`;
    case "exception":
      return `Paid ${seller} ${amount} for ${what}, but the purchase needs a human.`;
  }
}

/** Plain sentence for an exception, used when exceptions.summary is null. */
export function exceptionSentence(exc: ExceptionRow, data: DashboardData): string {
  const order = exc.order_id ? data.orders.find((o) => o.order_id === exc.order_id) : undefined;
  const payment = exc.tx_signature ? data.payments.find((p) => p.tx_signature === exc.tx_signature) : undefined;
  const seller = order ? sellerName(data, order.seller_id) : "the seller";
  const amount = payment ? formatUsd(payment.amount) : order ? formatUsd(orderAmount(order)) : null;
  const paid = amount ? `Paid ${seller} ${amount}` : `Paid ${seller}`;
  switch (exc.type) {
    case "no_order":
      return `${amount ?? "A payment"} left the agent wallet with no matching order. Possible stolen key.`;
    case "wallet_mismatch":
      return `${paid}, but the money went to a different wallet than the order's.`;
    case "amount_mismatch":
      return `${paid}, which doesn't match the amount the seller quoted.`;
    case "nothing_delivered":
      return `${paid}, but nothing was delivered.`;
    case "bad_format":
      return `${paid}, but the data came back unreadable or incomplete.`;
    case "wrong_data":
      return `${paid}, but the data doesn't match what was ordered.`;
  }
}

/** The fixed review sentence for a pending_review order (it carries the numbers a human decides on). */
export function pendingSentence(order: OrderRow, data: DashboardData, rules: Rules): string {
  return `Your agent wants to buy ${itemPhrase(order.item)} from ${sellerName(data, order.seller_id)} for ${formatUsd(order.max_amount)}. Over your ${formatUsd(rules.human_review_over)} review limit.`;
}

export type AttentionItem =
  | { kind: "exception"; key: string; at: string; text: string; exception: ExceptionRow; order: OrderRow | null }
  | { kind: "pending"; key: string; at: string; text: string; note: string | null; order: OrderRow };

const SEVERITY_RANK: Record<ExceptionSeverity, number> = { critical: 0, high: 1, medium: 2 };

/** Open exceptions (most severe, then newest, first) followed by pending_review orders (newest first). */
export function attentionItems(data: DashboardData, rules: Rules): AttentionItem[] {
  const exceptions: AttentionItem[] = data.exceptions
    .filter((e) => e.status === "open")
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.created_at.localeCompare(a.created_at))
    .map((e) => ({
      kind: "exception",
      key: e.exception_id,
      at: e.created_at,
      text: e.summary ?? exceptionSentence(e, data),
      exception: e,
      order: (e.order_id && data.orders.find((o) => o.order_id === e.order_id)) || null,
    }));
  const pending: AttentionItem[] = data.orders
    .filter((o) => o.status === "pending_review")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((o) => ({ kind: "pending", key: o.order_id, at: o.created_at, text: pendingSentence(o, data, rules), note: o.summary, order: o }));
  return [...exceptions, ...pending];
}

export interface WeekStats {
  weekStart: number;
  spent: number;
  purchases: number;
  blocked: number;
  verified: number;
}

/** "This week" = since Monday 00:00 ET. Verified = paid or booked orders with a matched on-chain payment. */
export function weekStats(data: DashboardData, gatewayWallet: string | null, now: number): WeekStats {
  const weekStart = weekStartEt(now);
  const inWeek = (iso: string) => Date.parse(iso) >= weekStart;
  const payments = outgoing(data.payments, gatewayWallet).filter((p) => inWeek(p.block_time));
  const txByOrder = paymentTxByOrder(data.payments);
  return {
    weekStart,
    spent: payments.reduce((sum, p) => sum + p.amount, 0),
    purchases: payments.filter((p) => p.order_id !== null).length,
    blocked: data.orders.filter((o) => o.status === "denied" && inWeek(o.created_at)).length,
    verified: data.orders.filter((o) => (o.status === "paid" || o.status === "booked") && txByOrder.has(o.order_id)).length,
  };
}

export type ActivityKind = "paid" | "blocked" | "exception" | "pending" | "paying";

export interface ActivityRow {
  key: string;
  /** Matches Dashboard's fresh-row keys (order_id / exception_id). */
  rowKey: string;
  at: string;
  kind: ActivityKind;
  critical: boolean;
  text: string;
  order: OrderRow | null;
  tx: string | null;
}

const ORDER_KIND: Record<OrderRow["status"], ActivityKind> = {
  booked: "paid",
  paid: "paid",
  paying: "paying",
  denied: "blocked",
  pending_review: "pending",
  exception: "exception",
};

/** The newest `limit` orders and exceptions, mixed, newest first. */
export function recentActivity(data: DashboardData, limit = 8): ActivityRow[] {
  const txByOrder = paymentTxByOrder(data.payments);
  const byId = new Map(data.orders.map((o) => [o.order_id, o]));
  const rows: ActivityRow[] = [
    ...data.orders.map((o) => ({
      key: `o-${o.order_id}`,
      rowKey: o.order_id,
      at: o.created_at,
      kind: ORDER_KIND[o.status],
      critical: false,
      text: o.summary ?? orderSentence(o, data),
      order: o,
      tx: txByOrder.get(o.order_id) ?? null,
    })),
    ...data.exceptions.map((e) => ({
      key: `e-${e.exception_id}`,
      rowKey: e.exception_id,
      at: e.created_at,
      kind: "exception" as const,
      critical: e.severity === "critical",
      text: e.summary ?? exceptionSentence(e, data),
      order: (e.order_id && byId.get(e.order_id)) || null,
      tx: e.tx_signature,
    })),
  ];
  return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
