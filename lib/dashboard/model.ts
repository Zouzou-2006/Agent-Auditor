// Pure dashboard logic (owner: Nizar, with Aidan's agreement). No React, no Supabase: everything
// here takes table rows and returns plain values, so it is unit-tested in tests/dashboard.
// Money is always integer USDC base units (1 USDC = 1000000); formatting uses integer math only.

import type {
  DeliveryRow,
  ExceptionRow,
  ExceptionSeverity,
  JournalEntryRow,
  OrderRow,
  OrderStatus,
  PaymentRow,
  SellerRow,
} from "../db-types";

export interface DashboardData {
  sellers: SellerRow[];
  orders: OrderRow[];
  payments: PaymentRow[];
  deliveries: DeliveryRow[];
  journal_entries: JournalEntryRow[];
  exceptions: ExceptionRow[];
}

export const EMPTY_DATA: DashboardData = {
  sellers: [],
  orders: [],
  payments: [],
  deliveries: [],
  journal_entries: [],
  exceptions: [],
};

/** The subset of config/rules.json the dashboard shows (SPEC.md section 5). */
export interface Rules {
  network: string;
  asset: string;
  usdc_mint: string;
  max_per_purchase: number;
  max_per_day: number;
  human_review_over: number;
}

export const ORDER_STATUSES: OrderStatus[] = ["pending_review", "paying", "paid", "booked", "denied", "exception"];
export const SEVERITIES: ExceptionSeverity[] = ["critical", "high", "medium"];

/** Base units -> "$0.10", "$1.25", "$0.0015" (extra digits only when they aren't zero). Integer math. */
export function formatUsd(baseUnits: number | bigint | null | undefined): string {
  if (baseUnits === null || baseUnits === undefined) return "—";
  const n = BigInt(baseUnits);
  const negative = n < 0n;
  const digits = (negative ? -n : n).toString().padStart(7, "0");
  const whole = digits.slice(0, -6);
  const cents = digits.slice(-6, -4);
  const rest = digits.slice(-4).replace(/0+$/, "");
  return `${negative ? "-" : ""}$${BigInt(whole).toLocaleString("en-US")}.${cents}${rest}`;
}

/** Whole-percent share of `part` in `whole`, clamped to 0..100, integer math. */
export function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.max(0, Math.floor((part * 100) / whole)));
}

export function shortId(value: string | null | undefined, keep = 4): string {
  if (!value) return "—";
  return value.length > keep * 2 + 1 ? `${value.slice(0, keep)}…${value.slice(-keep)}` : value;
}

export function utcDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** Outgoing payments: from the gateway wallet (SPEC section 3: only outgoing payments are checked). */
export function outgoing(payments: PaymentRow[], gatewayWallet: string | null): PaymentRow[] {
  return gatewayWallet ? payments.filter((p) => p.from_wallet === gatewayWallet) : payments;
}

export interface Overview {
  spentToday: number;
  dailyLimit: number;
  dailyUsedPct: number;
  ordersByStatus: Record<OrderStatus, number>;
  totalOrders: number;
  blockedBeforePayment: number;
  bookedAmount: number;
  openExceptions: number;
  openBySeverity: Record<ExceptionSeverity, number>;
  unmatchedPayments: number;
  lastPaymentAt: string | null;
}

export function computeOverview(data: DashboardData, rules: Rules, gatewayWallet: string | null, now: Date): Overview {
  const today = now.toISOString().slice(0, 10);
  const out = outgoing(data.payments, gatewayWallet);
  const spentToday = out.filter((p) => utcDay(p.block_time) === today).reduce((sum, p) => sum + p.amount, 0);

  const ordersByStatus = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;
  for (const o of data.orders) ordersByStatus[o.status] += 1;

  const open = data.exceptions.filter((e) => e.status === "open");
  const openBySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<ExceptionSeverity, number>;
  for (const e of open) openBySeverity[e.severity] += 1;

  const bookedAmount = data.journal_entries
    .filter((j) => j.debit_account === "Data purchases expense")
    .reduce((sum, j) => sum + j.amount, 0);

  const lastPaymentAt = data.payments.reduce<string | null>(
    (latest, p) => (latest === null || p.block_time > latest ? p.block_time : latest),
    null,
  );

  return {
    spentToday,
    dailyLimit: rules.max_per_day,
    dailyUsedPct: percent(spentToday, rules.max_per_day),
    ordersByStatus,
    totalOrders: data.orders.length,
    blockedBeforePayment: ordersByStatus.denied,
    bookedAmount,
    openExceptions: open.length,
    openBySeverity,
    unmatchedPayments: out.filter((p) => p.order_id === null).length,
    lastPaymentAt,
  };
}

export interface DayBucket {
  day: string; // YYYY-MM-DD (UTC)
  amount: number;
  count: number;
}

/** Outgoing USDC per UTC day for the last `days` days, oldest first, zero-filled. */
export function dailySpend(payments: PaymentRow[], gatewayWallet: string | null, now: Date, days = 14): DayBucket[] {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const buckets: DayBucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    buckets.push({ day: new Date(start - i * 86_400_000).toISOString().slice(0, 10), amount: 0, count: 0 });
  }
  const index = new Map(buckets.map((b) => [b.day, b]));
  for (const p of outgoing(payments, gatewayWallet)) {
    const bucket = index.get(utcDay(p.block_time));
    if (bucket) {
      bucket.amount += p.amount;
      bucket.count += 1;
    }
  }
  return buckets;
}

export interface OrderFilter {
  query: string;
  status: OrderStatus | "all";
  seller: string | "all";
}

export function filterOrders(orders: OrderRow[], filter: OrderFilter): OrderRow[] {
  const q = filter.query.trim().toLowerCase();
  return orders.filter((o) => {
    if (filter.status !== "all" && o.status !== filter.status) return false;
    if (filter.seller !== "all" && o.seller_id !== filter.seller) return false;
    if (!q) return true;
    return [o.order_id, o.seller_id, o.item, o.purpose, o.deny_reason ?? "", o.summary ?? "", JSON.stringify(o.params)]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });
}

export type StepState = "done" | "failed" | "waiting" | "skipped";

export interface TrailStep {
  key: "rules" | "review" | "quote" | "payment" | "delivery" | "booking";
  label: string;
  state: StepState;
  detail: string;
}

/**
 * Decision provenance for each audit-trail step: which component decided it and how. Every step is
 * deterministic code or on-chain data; only the one-line summary is AI-written, and it never decides.
 */
export const STEP_PROVENANCE: Record<TrailStep["key"], { source: string; basis: "deterministic" | "on-chain" | "human" }> = {
  rules: { source: "Rule engine · config/rules.json", basis: "deterministic" },
  review: { source: "Human approval", basis: "human" },
  quote: { source: "Seller's x402 quote · gateway checks", basis: "deterministic" },
  payment: { source: "Solana devnet · QuickNode Streams", basis: "on-chain" },
  delivery: { source: "Delivery checks · plain code", basis: "deterministic" },
  booking: { source: "Booking · double-entry ledger", basis: "deterministic" },
};

export interface OrderTrail {
  order: OrderRow;
  seller: SellerRow | null;
  payment: PaymentRow | null;
  delivery: DeliveryRow | null;
  journal: JournalEntryRow[];
  exception: ExceptionRow | null;
  steps: TrailStep[];
}

/** Reason strings from SPEC.md section 5, grouped by the step of the flow that applies them. */
export const RULE_REASONS = ["seller not approved", "seller blocked", "over per-purchase limit", "over daily limit"];
export const QUOTE_REASONS = [
  "quote over max",
  "quote wallet doesn't match seller",
  "wrong asset or network",
  "quote memo doesn't match order",
];

export function denyStage(reason: string | null): "rules" | "quote" | "payment" {
  if (reason !== null && QUOTE_REASONS.includes(reason)) return "quote";
  if (reason === "payment failed") return "payment";
  return "rules";
}

function checksOf(delivery: DeliveryRow): Record<string, boolean> {
  const c = delivery.checks;
  if (!c || typeof c !== "object" || Array.isArray(c)) return {};
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v === true]));
}

/**
 * The audit trail for one order: every decision from the rule check to the journal entry,
 * built only from the saved rows (SPEC section 3, steps 1-8).
 */
export function orderTrail(order: OrderRow, data: DashboardData): OrderTrail {
  const seller = data.sellers.find((s) => s.seller_id === order.seller_id) ?? null;
  const payment = data.payments.find((p) => p.order_id === order.order_id) ?? null;
  const delivery = data.deliveries.find((d) => d.order_id === order.order_id) ?? null;
  const journal = data.journal_entries.filter((j) => j.order_id === order.order_id);
  const exception = data.exceptions.find((e) => e.order_id === order.order_id) ?? null;

  const stage = order.status === "denied" ? denyStage(order.deny_reason) : null;
  const steps: TrailStep[] = [];

  steps.push({
    key: "rules",
    label: "Finance rules",
    state: stage === "rules" ? "failed" : "done",
    detail:
      stage === "rules"
        ? `Denied: ${order.deny_reason ?? "no reason saved"}`
        : `Passed: approved seller, max ${formatUsd(order.max_amount)} within limits`,
  });

  if (order.status === "pending_review") {
    steps.push({ key: "review", label: "Human review", state: "waiting", detail: "Over the review threshold, waiting for Approve" });
  }

  const quoteSeen = order.quote_amount !== null ? `${formatUsd(order.quote_amount)} to ${shortId(order.quote_wallet, 6)}` : "";
  steps.push({
    key: "quote",
    label: "Seller quote (HTTP 402)",
    state: stage === "quote" ? "failed" : stage === "rules" ? "skipped" : order.quote_amount !== null ? "done" : "waiting",
    detail:
      stage === "quote"
        ? `Denied: ${order.deny_reason}${quoteSeen ? ` (${quoteSeen})` : ""}`
        : stage === "rules"
          ? "Not requested: blocked before contacting the seller"
          : quoteSeen || (order.status === "pending_review" ? "Requested after approval" : "Not received yet"),
  });

  const paymentFailed = stage === "payment";
  steps.push({
    key: "payment",
    label: "On-chain payment",
    state: payment ? "done" : paymentFailed ? "failed" : order.status === "denied" ? "skipped" : "waiting",
    detail: payment
      ? `${formatUsd(payment.amount)} matched by memo, block time ${new Date(payment.block_time).toISOString().replace("T", " ").slice(0, 19)} UTC`
      : paymentFailed
        ? "Payment failed. No money moved"
        : order.status === "denied"
          ? "No money moved"
          : order.status === "paying"
            ? "Signed, waiting for settlement / Streams"
            : order.status === "paid"
              ? "Paid, waiting for Streams to deliver the transaction"
              : "Not paid yet",
  });

  const checks = delivery ? checksOf(delivery) : null;
  steps.push({
    key: "delivery",
    label: "Delivery checks",
    state: delivery ? (delivery.passed ? "done" : "failed") : order.status === "denied" ? "skipped" : "waiting",
    detail: checks
      ? Object.entries(checks)
          .map(([k, v]) => `${k} ${v ? "✓" : "✗"}`)
          .join(" · ")
      : order.status === "denied"
        ? "Nothing to check"
        : "No delivery saved yet",
  });

  steps.push({
    key: "booking",
    label: "Booking",
    state: journal.length ? "done" : exception ? "failed" : order.status === "denied" ? "skipped" : "waiting",
    detail: journal.length
      ? journal.map((j) => `Dr ${j.debit_account} / Cr ${j.credit_account} ${formatUsd(j.amount)}`).join("; ")
      : exception
        ? `Exception ${exception.type} (${exception.severity}), ${exception.status}`
        : order.status === "denied"
          ? "Blocked before payment: no entry needed"
          : "Waiting for payment and delivery",
  });

  return { order, seller, payment, delivery, journal, exception, steps };
}
