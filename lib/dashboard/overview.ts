// Pure helpers for the Overview and the Attention drawer (owner: Aidan). No React, no Supabase.
// Sentences come from lib/dashboard/words.ts and always prefer the Claude-written `summary`.
// Times are shown in America/New_York; the $5 daily rule itself stays UTC in the gateway
// (SPEC.md section 5), so the reset time is the next UTC midnight shown in ET.

import type { ExceptionRow, ExceptionSeverity, OrderRow } from "../db-types";
import { outgoing, paymentTxByOrder, type DashboardData, type Rules } from "./model";
import { exceptionSentence, orderSentence, readableSummary, reviewSentence, sellerName } from "./words";

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

const orderOf = (data: DashboardData, id: string | null) => (id ? (data.orders.find((o) => o.order_id === id) ?? null) : null);

const paymentOf = (data: DashboardData, sig: string | null) => (sig ? (data.payments.find((p) => p.tx_signature === sig) ?? null) : null);

/**
 * The display sentence for an exception, always built from its rows. exceptions.summary is filled by
 * lib/booking.ts with a factual note (raw amounts, wallet addresses), and /api/summaries only writes
 * null summaries, so it is never AI-written; it stays visible in tooltips as the stored note.
 */
export function exceptionText(exc: ExceptionRow, data: DashboardData): string {
  const order = orderOf(data, exc.order_id);
  return exceptionSentence(exc, order, paymentOf(data, exc.tx_signature), order ? sellerName(order.seller_id, data.sellers) : null);
}

/** The order's AI summary when it reads as plain English (readableSummary), else null. */
export function orderSummary(order: OrderRow, data: DashboardData): string | null {
  return readableSummary(order.summary, data.sellers);
}

/** The display sentence for an order: its readable AI summary, else the plain-language fallback. */
export function orderText(order: OrderRow, data: DashboardData): string {
  return orderSummary(order, data) ?? orderSentence(order, sellerName(order.seller_id, data.sellers));
}

/** The stored summary when the screen shows something else in its place (for the tooltip), else null. */
function hiddenNote(stored: string | null, shown: string): string | null {
  return stored && stored !== shown ? stored : null;
}

export type AttentionItem =
  | { kind: "pending"; key: string; at: string; text: string; note: string | null; amount: number; order: OrderRow }
  | {
      kind: "exception";
      key: string;
      at: string;
      text: string;
      note: string | null;
      amount: number | null;
      /** Where the money went; shown for a payment with no order, whose only evidence is the payment. */
      toWallet: string | null;
      exception: ExceptionRow;
      order: OrderRow | null;
    };

const SEVERITY_RANK: Record<ExceptionSeverity, number> = { critical: 0, high: 1, medium: 2 };

/** Pending reviews (newest first), then open exceptions (most severe, then newest, first). */
export function attentionItems(data: DashboardData, rules: Rules): AttentionItem[] {
  const pending: AttentionItem[] = data.orders
    .filter((o) => o.status === "pending_review")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((o) => {
      const text = orderSummary(o, data) ?? reviewSentence(o, sellerName(o.seller_id, data.sellers), rules.human_review_over);
      return { kind: "pending", key: o.order_id, at: o.created_at, text, note: hiddenNote(o.summary, text), amount: o.max_amount, order: o };
    });
  const exceptions: AttentionItem[] = data.exceptions
    .filter((e) => e.status === "open")
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.created_at.localeCompare(a.created_at))
    .map((e) => {
      const payment = paymentOf(data, e.tx_signature);
      const order = orderOf(data, e.order_id);
      const text = exceptionText(e, data);
      return {
        kind: "exception",
        key: e.exception_id,
        at: e.created_at,
        text,
        note: hiddenNote(e.summary, text),
        amount: payment?.amount ?? order?.quote_amount ?? null,
        toWallet: payment?.to_wallet ?? null,
        exception: e,
        order,
      };
    });
  return [...pending, ...exceptions];
}

export type AttentionLevel = "critical" | "waiting" | "none";

/** Chip color: red if any critical exception, amber if anything else waits on a human, neutral if nothing. */
export function attentionLevel(items: AttentionItem[]): AttentionLevel {
  if (items.some((i) => i.kind === "exception" && i.exception.severity === "critical")) return "critical";
  return items.length > 0 ? "waiting" : "none";
}

/** Newest decision of any kind (order, payment, delivery, exception), or null when there is none. */
export function lastDecisionAt(data: DashboardData): string | null {
  const times = [
    ...data.orders.map((o) => o.created_at),
    ...data.payments.map((p) => p.block_time),
    ...data.deliveries.map((d) => d.received_at),
    ...data.exceptions.map((e) => e.created_at),
  ];
  return times.reduce<string | null>((latest, t) => (latest === null || t > latest ? t : latest), null);
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

/** completed ✓, processing ⏳, blocked ⊘, pending ⏸, exception ⚠ */
export type ActivityKind = "completed" | "processing" | "blocked" | "pending" | "exception";

export interface ActivityRow {
  key: string;
  /** Matches Dashboard's fresh-row keys (order_id / exception_id). */
  rowKey: string;
  at: string;
  kind: ActivityKind;
  critical: boolean;
  text: string;
  /** The stored summary when `text` replaced it, for the row's tooltip. */
  note: string | null;
  /** Base units shown right-aligned; for a blocked order this is what it would have cost. */
  amount: number | null;
  order: OrderRow | null;
  tx: string | null;
}

const ORDER_KIND: Record<OrderRow["status"], ActivityKind> = {
  booked: "completed",
  paid: "processing",
  paying: "processing",
  denied: "blocked",
  pending_review: "pending",
  exception: "exception",
};

/** The newest `limit` orders and exceptions, mixed, newest first. */
export function recentActivity(data: DashboardData, limit = 8): ActivityRow[] {
  const txByOrder = paymentTxByOrder(data.payments);
  const rows: ActivityRow[] = [
    ...data.orders.map((o) => {
      const text = orderText(o, data);
      return {
        key: `o-${o.order_id}`,
        rowKey: o.order_id,
        at: o.created_at,
        kind: ORDER_KIND[o.status],
        critical: false,
        text,
        note: hiddenNote(o.summary, text),
        amount: o.quote_amount ?? o.max_amount,
        order: o,
        tx: txByOrder.get(o.order_id) ?? null,
      };
    }),
    ...data.exceptions.map((e) => {
      const text = exceptionText(e, data);
      return {
        key: `e-${e.exception_id}`,
        rowKey: e.exception_id,
        at: e.created_at,
        kind: "exception" as const,
        critical: e.severity === "critical",
        text,
        note: hiddenNote(e.summary, text),
        amount: paymentOf(data, e.tx_signature)?.amount ?? null,
        order: orderOf(data, e.order_id),
        tx: e.tx_signature,
      };
    }),
  ];
  return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
