// Pure helpers for the Overview and the Attention drawer (owner: Aidan). No React, no Supabase.
// Sentences come from lib/dashboard/words.ts and always prefer the Claude-written `summary`.
// Times are shown in America/New_York; the $5 daily rule itself stays UTC in the gateway
// (SPEC.md section 5), so the reset time is the next UTC midnight shown in ET.

import type { ExceptionRow, ExceptionSeverity, ExceptionType, OrderRow } from "../db-types";
import { orderTrail, outgoing, paymentTxByOrder, type DashboardData, type Rules, type TrailStep } from "./model";
import { deliveryText, EXCEPTION_TITLE, exceptionSentence, orderSentence, readableSummary, reviewSentence, sellerName, unconfirmedSentence } from "./words";

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
  /** Outgoing USDC this week (every payment out, with or without an order). */
  spent: number;
  /** The part of `spent` with no order behind it. */
  unmatched: number;
  purchases: number;
  blocked: number;
  verified: number;
  /** Exceptions raised this week, open or resolved: problems the auditor caught. */
  caught: number;
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
    unmatched: payments.filter((p) => p.order_id === null).reduce((sum, p) => sum + p.amount, 0),
    purchases: payments.filter((p) => p.order_id !== null).length,
    blocked: data.orders.filter((o) => o.status === "denied" && inWeek(o.created_at)).length,
    verified: data.orders.filter((o) => (o.status === "paid" || o.status === "booked") && txByOrder.has(o.order_id)).length,
    caught: data.exceptions.filter((e) => inWeek(e.created_at)).length,
  };
}

/** The three results at the top of the Overview: what the auditor caught, blocked and booked this week. */
export interface WeekOutcomes {
  /** Exceptions raised this week, open or resolved (same count as weekStats.caught). */
  caught: number;
  /** The most severe of them (newest first among equals), for the tile's one-line note. */
  topProblem: ExceptionType | null;
  /** Orders denied this week (same count as weekStats.blocked). */
  blocked: number;
  /** Orders created this week that are now booked. */
  booked: number;
  /** Their Data purchases expense entries, in base units. */
  bookedAmount: number;
}

export function weekOutcomes(data: DashboardData, gatewayWallet: string | null, now: number): WeekOutcomes {
  const week = weekStats(data, gatewayWallet, now);
  const inWeek = (iso: string) => Date.parse(iso) >= week.weekStart;
  const top = data.exceptions
    .filter((e) => inWeek(e.created_at))
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.created_at.localeCompare(a.created_at))[0];
  const booked = new Set(data.orders.filter((o) => o.status === "booked" && inWeek(o.created_at)).map((o) => o.order_id));
  return {
    caught: week.caught,
    topProblem: top?.type ?? null,
    blocked: week.blocked,
    booked: booked.size,
    bookedAmount: data.journal_entries
      .filter((j) => j.debit_account === "Data purchases expense" && j.order_id !== null && booked.has(j.order_id))
      .reduce((sum, j) => sum + j.amount, 0),
  };
}

export interface LedgerTotals {
  /** Every payment out of the wallet, read from the chain. */
  out: number;
  /** Everything booked to the ledger (purchases and losses). */
  booked: number;
  /** Out minus booked: money that left but isn't in the books (yet). */
  notBooked: number;
  /** The part of `out` with no order behind it. */
  unmatched: number;
}

/** All-time totals for the Ledger header, using the same outgoing-payment math as the Overview. */
export function ledgerTotals(data: DashboardData, gatewayWallet: string | null): LedgerTotals {
  const out = outgoing(data.payments, gatewayWallet);
  const sum = (rows: { amount: number }[]) => rows.reduce((s, r) => s + r.amount, 0);
  const total = sum(out);
  const booked = sum(data.journal_entries);
  return { out: total, booked, notBooked: Math.max(0, total - booked), unmatched: sum(out.filter((p) => p.order_id === null)) };
}

/** completed ✓, processing ⏳, blocked ⊘, pending ⏸, exception ⚠ */
export type ActivityKind = "completed" | "processing" | "blocked" | "pending" | "exception";

/** The result stamp on a purchase: what happened, in one word. */
export type StampKind = "booked" | "blocked" | "flagged" | "approval" | "unconfirmed";

/** One leg of the three-way match: ok (green), failed (red), blocked (grey ✕), none (grey, not reached). */
export type MatchState = "ok" | "failed" | "blocked" | "none";

export interface ThreeWay {
  order: MatchState;
  /** null on a blocked order: it never got as far as a payment. */
  payment: MatchState | null;
  delivery: MatchState | null;
  tips: { order: string; payment: string; delivery: string };
}

/** After this long, a "paid" order the chain hasn't confirmed is worth a human's look. */
export const UNCONFIRMED_AFTER_MS = 5 * 60_000;

export function isUnconfirmed(order: OrderRow, now: number | undefined): boolean {
  return now !== undefined && order.status === "paid" && now - Date.parse(order.created_at) > UNCONFIRMED_AFTER_MS;
}

/**
 * Order ↔ Payment ↔ Delivery, read from the audit trail. A wallet or amount mismatch fails the payment
 * leg even though the payment itself arrived.
 */
export function threeWay(order: OrderRow, data: DashboardData): ThreeWay {
  const t = orderTrail(order, data);
  const step = (key: TrailStep["key"]) => t.steps.find((s) => s.key === key);
  const rules = step("rules");
  const quote = step("quote");
  const payment = step("payment");
  const delivery = step("delivery");
  if (order.status === "denied") {
    return { order: "blocked", payment: null, delivery: null, tips: { order: `Blocked: ${order.deny_reason ?? "no reason saved"}`, payment: "", delivery: "" } };
  }
  const waitingReview = t.steps.some((s) => s.key === "review" && s.state === "waiting");
  const mismatch = t.exception?.type === "wallet_mismatch" || t.exception?.type === "amount_mismatch";
  const leg = (s: TrailStep | undefined): MatchState => (s?.state === "done" ? "ok" : s?.state === "failed" ? "failed" : "none");
  const deliveryTip = [delivery?.detail, t.delivery ? deliveryText(t.delivery.body) : null].filter(Boolean).join("\n");
  return {
    order: waitingReview ? "none" : rules?.state === "done" && quote?.state !== "failed" ? "ok" : leg(rules),
    payment: mismatch ? "failed" : leg(payment),
    delivery: leg(delivery),
    tips: {
      order: [rules?.detail, quote?.detail].filter(Boolean).join("\n"),
      payment: mismatch && t.exception ? EXCEPTION_TITLE[t.exception.type] : (payment?.detail ?? ""),
      delivery: deliveryTip,
    },
  };
}

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
  /** True for a blocked order: the amount was never spent. */
  struck: boolean;
  stamp: StampKind | null;
  /** Three-way match for a purchase; null for a payment with no order. */
  match: ThreeWay | null;
  /** Dashboard "fresh" keys that mean this row just changed (new related row or a status change). */
  freshKeys: string[];
  order: OrderRow | null;
  exception: ExceptionRow | null;
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

const ORDER_STAMP: Record<OrderRow["status"], StampKind | null> = {
  booked: "booked",
  denied: "blocked",
  exception: "flagged",
  pending_review: "approval",
  paid: null,
  paying: null,
};

/** The stamp for an order on its own; in-progress orders have none until they turn "not confirmed". */
export function orderStamp(order: OrderRow, now?: number): StampKind | null {
  return isUnconfirmed(order, now) ? "unconfirmed" : ORDER_STAMP[order.status];
}

/**
 * The newest `limit` purchases, newest first: one row per order, with its exception folded in. A payment
 * with no order is its own row. `now` turns a "paid" order older than 5 minutes into "not confirmed".
 */
export function recentActivity(data: DashboardData, limit = 8, now?: number): ActivityRow[] {
  const txByOrder = paymentTxByOrder(data.payments);
  const excByOrder = new Map(data.exceptions.filter((e) => e.order_id).map((e) => [e.order_id as string, e]));
  const entriesByOrder = new Map<string, string[]>();
  for (const j of data.journal_entries) if (j.order_id) entriesByOrder.set(j.order_id, [...(entriesByOrder.get(j.order_id) ?? []), j.entry_id]);
  const rows: ActivityRow[] = [
    ...data.orders.map((o) => {
      const exc = excByOrder.get(o.order_id) ?? null;
      const tx = txByOrder.get(o.order_id) ?? null;
      const unconfirmed = isUnconfirmed(o, now);
      const seller = sellerName(o.seller_id, data.sellers);
      const text = exc ? exceptionText(exc, data) : unconfirmed ? unconfirmedSentence(o, seller) : orderText(o, data);
      const at = exc && exc.created_at > o.created_at ? exc.created_at : o.created_at;
      return {
        key: `o-${o.order_id}`,
        rowKey: o.order_id,
        at,
        kind: ORDER_KIND[o.status],
        critical: exc?.severity === "critical",
        text,
        note: hiddenNote(exc ? exc.summary : o.summary, text),
        amount: o.quote_amount ?? o.max_amount,
        struck: o.status === "denied",
        stamp: orderStamp(o, now),
        match: threeWay(o, data),
        freshKeys: [
          o.order_id,
          `status:${o.order_id}:${o.status}`,
          ...(tx ? [tx] : []),
          ...(exc ? [exc.exception_id, `status:${exc.exception_id}:${exc.status}`] : []),
          ...(entriesByOrder.get(o.order_id) ?? []),
        ],
        order: o,
        exception: exc,
        tx,
      };
    }),
    ...data.exceptions
      .filter((e) => !e.order_id || !orderOf(data, e.order_id))
      .map((e) => {
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
          struck: false,
          stamp: "flagged" as const,
          match: null,
          freshKeys: [e.exception_id, `status:${e.exception_id}:${e.status}`],
          order: null,
          exception: e,
          tx: e.tx_signature,
        };
      }),
  ];
  return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
