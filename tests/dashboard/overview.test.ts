import { describe, expect, it } from "vitest";
import type { ExceptionRow, OrderRow, PaymentRow } from "../../lib/db-types";
import { EMPTY_DATA, matchesStatus, type DashboardData, type Rules } from "../../lib/dashboard/model";
import {
  attentionItems,
  attentionLevel,
  etClock,
  isUnconfirmed,
  lastDecisionAt,
  ledgerTotals,
  nextUtcMidnight,
  orderStamp,
  recentActivity,
  threeWay,
  weekStartEt,
  weekStats,
} from "../../lib/dashboard/overview";
import { auditHeadline } from "../../lib/dashboard/words";

const GATEWAY = "GatewayWallet";
const rules: Rules = {
  network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  asset: "USDC",
  usdc_mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  max_per_purchase: 1000000,
  max_per_day: 5000000,
  human_review_over: 500000,
};

const order = (o: Partial<OrderRow> & Pick<OrderRow, "order_id" | "status" | "created_at">): OrderRow => ({
  seller_id: "dataco",
  item: "price_quote",
  params: { ticker: "SOL", date: "2026-11-15" },
  max_amount: 100000,
  purpose: "test",
  deny_reason: null,
  quote_amount: null,
  quote_wallet: null,
  summary: null,
  ...o,
});
const exception = (e: Partial<ExceptionRow> & Pick<ExceptionRow, "exception_id" | "type" | "severity" | "created_at">): ExceptionRow => ({
  order_id: null,
  tx_signature: null,
  summary: null,
  status: "open",
  ...e,
});
const payment = (p: Partial<PaymentRow> & Pick<PaymentRow, "tx_signature" | "block_time">): PaymentRow => ({
  from_wallet: GATEWAY,
  to_wallet: "Seller",
  amount: 100000,
  memo: null,
  order_id: null,
  raw: {},
  ...p,
});

const data = (d: Partial<DashboardData>): DashboardData => ({
  ...EMPTY_DATA,
  sellers: [{ seller_id: "dataco", name: "DataCo", url: "", wallet: "W", status: "approved" }],
  ...d,
});

describe("time helpers (America/New_York)", () => {
  it("starts the week on Monday 00:00 ET", () => {
    // Sunday 2026-11-15, 10:00 EST -> Monday 2026-11-09 00:00 EST = 05:00 UTC
    expect(new Date(weekStartEt(Date.parse("2026-11-15T15:00:00Z"))).toISOString()).toBe("2026-11-09T05:00:00.000Z");
    // Monday 00:30 EST is already the new week
    expect(new Date(weekStartEt(Date.parse("2026-11-16T05:30:00Z"))).toISOString()).toBe("2026-11-16T05:00:00.000Z");
    // Summer (EDT, UTC-4)
    expect(new Date(weekStartEt(Date.parse("2026-07-01T12:00:00Z"))).toISOString()).toBe("2026-06-29T04:00:00.000Z");
  });

  it("shows the next UTC midnight (the daily-limit reset) in ET", () => {
    expect(etClock(nextUtcMidnight(Date.parse("2026-11-15T15:00:00Z")))).toBe("7:00 PM");
    expect(etClock(nextUtcMidnight(Date.parse("2026-07-01T12:00:00Z")))).toBe("8:00 PM");
  });
});

describe("attentionItems / attentionLevel", () => {
  const d = data({
    orders: [
      order({ order_id: "p1", status: "pending_review", created_at: "2026-11-15T09:00:00Z", max_amount: 600000 }),
      order({ order_id: "x1", status: "exception", created_at: "2026-11-15T08:00:00Z", seller_id: "cheapdata" }),
    ],
    payments: [payment({ tx_signature: "tz", block_time: "2026-11-15T10:00:00Z", amount: 250000 })],
    exceptions: [
      exception({ exception_id: "e-high", type: "nothing_delivered", severity: "high", created_at: "2026-11-15T11:00:00Z", order_id: "x1", summary: "CheapData sent nothing." }),
      exception({ exception_id: "e-crit", type: "no_order", severity: "critical", created_at: "2026-11-15T10:00:00Z", tx_signature: "tz" }),
      exception({ exception_id: "e-done", type: "wrong_data", severity: "medium", created_at: "2026-11-15T12:00:00Z", status: "approved" }),
    ],
  });

  it("lists pending reviews first, then open exceptions by severity", () => {
    const items = attentionItems(d, rules);
    expect(items.map((i) => i.key)).toEqual(["p1", "e-crit", "e-high"]);
    expect(items[0].text).toBe("Your agent wants to buy a SOL price from DataCo for $0.60. Over your $0.50 review limit.");
    expect(items[1].text).toBe("$0.25 left the wallet with no order behind it. Possible stolen key.");
    // Exception text is always built from the rows; the stored summary (booking.ts's note) moves to the tooltip.
    expect(items[2].text).toBe("Paid cheapdata (not approved) $0.10 and got nothing back.");
    expect(items[2].note).toBe("CheapData sent nothing.");
    expect(attentionLevel(items)).toBe("critical");
  });

  it("is amber without a critical, neutral when empty", () => {
    expect(attentionLevel(attentionItems({ ...d, exceptions: [] }, rules))).toBe("waiting");
    expect(attentionLevel(attentionItems(data({}), rules))).toBe("none");
  });
});

describe("lastDecisionAt", () => {
  it("takes the newest row of any kind", () => {
    const d = data({
      orders: [order({ order_id: "a", status: "booked", created_at: "2026-11-15T09:00:00Z" })],
      payments: [payment({ tx_signature: "t", block_time: "2026-11-15T09:00:05Z" })],
    });
    expect(lastDecisionAt(d)).toBe("2026-11-15T09:00:05Z");
    expect(lastDecisionAt(data({}))).toBeNull();
  });
});

describe("weekStats", () => {
  it("counts this week's outgoing spend, blocked orders and verified orders", () => {
    const now = Date.parse("2026-11-15T15:00:00Z");
    const d = data({
      orders: [
        order({ order_id: "a", status: "booked", created_at: "2026-11-14T10:00:00Z" }),
        order({ order_id: "b", status: "paid", created_at: "2026-11-14T11:00:00Z" }),
        order({ order_id: "c", status: "denied", created_at: "2026-11-13T10:00:00Z", deny_reason: "seller blocked" }),
        order({ order_id: "d", status: "denied", created_at: "2026-11-01T10:00:00Z", deny_reason: "seller blocked" }),
      ],
      payments: [
        payment({ tx_signature: "t1", block_time: "2026-11-14T10:00:10Z", order_id: "a" }),
        payment({ tx_signature: "t2", block_time: "2026-11-14T12:00:00Z", amount: 50000 }),
        payment({ tx_signature: "t3", block_time: "2026-11-02T12:00:00Z", order_id: "zz" }),
        payment({ tx_signature: "t4", block_time: "2026-11-14T12:00:00Z", from_wallet: "Faucet", to_wallet: GATEWAY, amount: 9000000 }),
      ],
    });
    expect(weekStats(d, GATEWAY, now)).toMatchObject({ spent: 150000, purchases: 1, blocked: 1, verified: 1 });
  });

  it("splits out money with no order, and counts problems caught and purchases booked", () => {
    const now = Date.parse("2026-11-15T15:00:00Z");
    const d = data({
      payments: [
        payment({ tx_signature: "t1", block_time: "2026-11-14T10:00:10Z", order_id: "a" }),
        payment({ tx_signature: "t2", block_time: "2026-11-14T12:00:00Z", amount: 100000 }),
      ],
      exceptions: [
        exception({ exception_id: "e1", type: "no_order", severity: "critical", created_at: "2026-11-14T12:00:05Z" }),
        exception({ exception_id: "e0", type: "wrong_data", severity: "medium", created_at: "2026-11-02T12:00:05Z" }),
      ],
      journal_entries: [
        { entry_id: "j1", order_id: "a", tx_signature: "t1", entry_date: "2026-11-14", debit_account: "Data purchases expense", credit_account: "USDC - agent wallet", amount: 100000, description: "d" },
        { entry_id: "j2", order_id: "b", tx_signature: "t9", entry_date: "2026-11-14", debit_account: "Loss on undelivered purchases", credit_account: "USDC - agent wallet", amount: 100000, description: "d" },
        { entry_id: "j3", order_id: "c", tx_signature: "t8", entry_date: "2026-11-02", debit_account: "Data purchases expense", credit_account: "USDC - agent wallet", amount: 100000, description: "d" },
      ],
    });
    expect(weekStats(d, GATEWAY, now)).toMatchObject({ spent: 200000, unmatched: 100000, caught: 1, booked: 100000 });
  });
});

describe("ledgerTotals", () => {
  it("splits on-chain money out into booked and not booked, and names the part with no order", () => {
    const d = data({
      payments: [
        payment({ tx_signature: "t1", block_time: "2026-11-14T10:00:10Z", order_id: "a" }),
        payment({ tx_signature: "t2", block_time: "2026-11-14T12:00:00Z" }),
        payment({ tx_signature: "t3", block_time: "2026-11-14T12:00:00Z", from_wallet: "Faucet", to_wallet: GATEWAY, amount: 9000000 }),
      ],
      journal_entries: [
        { entry_id: "j1", order_id: "a", tx_signature: "t1", entry_date: "2026-11-14", debit_account: "Data purchases expense", credit_account: "USDC - agent wallet", amount: 100000, description: "d" },
      ],
    });
    expect(ledgerTotals(d, GATEWAY)).toEqual({ out: 200000, booked: 100000, notBooked: 100000, unmatched: 100000 });
  });
});

describe("matchesStatus", () => {
  it("groups paid and paying as processing", () => {
    const paying = order({ order_id: "p", status: "paying", created_at: "2026-11-15T10:00:00Z" });
    expect(matchesStatus(paying, "processing")).toBe(true);
    expect(matchesStatus({ ...paying, status: "paid" }, "processing")).toBe(true);
    expect(matchesStatus({ ...paying, status: "booked" }, "processing")).toBe(false);
    expect(matchesStatus(paying, "all")).toBe(true);
  });
});

describe("auditHeadline", () => {
  it("leads with what the auditor did", () => {
    expect(auditHeadline({ caught: 1, blocked: 6, booked: 100000 })).toBe("Caught 1 problem this week · 6 orders blocked · $0.10 booked");
    expect(auditHeadline({ caught: 0, blocked: 1, booked: 0 })).toBe("No problems caught this week · 1 order blocked · $0.00 booked");
  });
});

describe("threeWay / stamps", () => {
  const now = Date.parse("2026-11-15T15:00:00Z");
  const booked = order({ order_id: "b", status: "booked", created_at: "2026-11-15T10:00:00Z", quote_amount: 100000, quote_wallet: "W" });
  const clean = data({
    orders: [booked],
    payments: [payment({ tx_signature: "tb", block_time: "2026-11-15T10:00:05Z", order_id: "b", to_wallet: "W" })],
    deliveries: [{ order_id: "b", received_at: "2026-11-15T10:00:04Z", body: '{"ticker":"SOL","date":"2026-11-15","price_usd":142.1,"source":"DataCo"}', checks: { received: true, format: true, matches_order: true }, passed: true }],
  });

  it("is green on all three legs for a clean purchase, with the delivery in the tooltip", () => {
    const m = threeWay(booked, clean);
    expect([m.order, m.payment, m.delivery]).toEqual(["ok", "ok", "ok"]);
    expect(m.tips.delivery).toContain("SOL was $142.10 on Nov 15");
  });

  it("shows only a blocked Order leg for a denied order", () => {
    const denied = order({ order_id: "d", status: "denied", created_at: "2026-11-15T10:00:00Z", deny_reason: "payment failed" });
    expect(threeWay(denied, data({ orders: [denied] }))).toMatchObject({ order: "blocked", payment: null, delivery: null });
    expect(orderStamp(denied, now)).toBe("blocked");
  });

  it("fails the payment leg on a wallet mismatch", () => {
    const flagged = { ...booked, status: "exception" as const };
    const d = { ...clean, orders: [flagged], exceptions: [exception({ exception_id: "e", type: "wallet_mismatch", severity: "critical", created_at: "2026-11-15T10:00:06Z", order_id: "b" })] };
    expect(threeWay(flagged, d).payment).toBe("failed");
    expect(orderStamp(flagged, now)).toBe("flagged");
  });

  it("calls a paid order unconfirmed after 5 minutes, not before", () => {
    const paid = order({ order_id: "p", status: "paid", created_at: "2026-11-15T14:56:00Z" });
    expect(isUnconfirmed(paid, now)).toBe(false);
    expect(isUnconfirmed({ ...paid, created_at: "2026-11-15T14:54:00Z" }, now)).toBe(true);
    expect(orderStamp({ ...paid, created_at: "2026-11-15T14:54:00Z" }, now)).toBe("unconfirmed");
    expect(orderStamp(paid, now)).toBeNull();
  });
});

describe("recentActivity", () => {
  it("mixes orders and exceptions newest first, capped, with amounts, tx links and summaries", () => {
    const orders = Array.from({ length: 9 }, (_, i) =>
      order({ order_id: `o${i}`, status: "booked", created_at: `2026-11-15T0${i}:00:00Z`, quote_amount: 100000, summary: i === 8 ? "AI line" : null }),
    );
    const d = data({
      orders,
      payments: [payment({ tx_signature: "tx8", block_time: "2026-11-15T08:00:10Z", order_id: "o8" })],
      exceptions: [exception({ exception_id: "e1", type: "no_order", severity: "critical", created_at: "2026-11-15T09:30:00Z", tx_signature: "txz" })],
    });
    const rows = recentActivity(d, 8);
    expect(rows).toHaveLength(8);
    expect(rows[0]).toMatchObject({ rowKey: "e1", kind: "exception", critical: true, order: null, tx: "txz", amount: null });
    expect(rows[1]).toMatchObject({ rowKey: "o8", kind: "completed", text: "AI line", tx: "tx8", amount: 100000 });
    expect(rows[2].text).toBe("Bought a SOL price from DataCo");
  });

  it("folds an order's exception into the order's row; a payment with no order keeps its own row", () => {
    const now = Date.parse("2026-11-15T15:00:00Z");
    const d = data({
      sellers: [
        { seller_id: "dataco", name: "DataCo", url: "", wallet: "W", status: "approved" },
        { seller_id: "cheapdata", name: "CheapData", url: "", wallet: "C", status: "approved" },
      ],
      orders: [
        order({ order_id: "x", status: "exception", created_at: "2026-11-15T10:00:00Z", seller_id: "cheapdata", quote_amount: 100000 }),
        order({ order_id: "n", status: "denied", created_at: "2026-11-15T09:00:00Z", deny_reason: "seller not approved" }),
        order({ order_id: "s", status: "paid", created_at: "2026-11-15T08:00:00Z", quote_amount: 100000 }),
      ],
      payments: [
        payment({ tx_signature: "tx", block_time: "2026-11-15T10:00:05Z", order_id: "x", to_wallet: "C" }),
        payment({ tx_signature: "tz", block_time: "2026-11-15T11:00:00Z" }),
      ],
      exceptions: [
        exception({ exception_id: "ex", type: "nothing_delivered", severity: "high", created_at: "2026-11-15T10:00:07Z", order_id: "x", tx_signature: "tx" }),
        exception({ exception_id: "ez", type: "no_order", severity: "critical", created_at: "2026-11-15T11:00:02Z", tx_signature: "tz" }),
      ],
    });
    const rows = recentActivity(d, 8, now);
    expect(rows.map((r) => r.rowKey)).toEqual(["ez", "x", "n", "s"]);
    expect(rows[0]).toMatchObject({ stamp: "flagged", critical: true, match: null });
    expect(rows[1]).toMatchObject({ stamp: "flagged", text: "Paid CheapData $0.10 and got nothing back.", exception: { exception_id: "ex" } });
    expect(rows[1].freshKeys).toEqual(expect.arrayContaining(["x", "tx", "ex", "status:x:exception"]));
    expect(rows[2]).toMatchObject({ stamp: "blocked", struck: true });
    expect(rows[3]).toMatchObject({ stamp: "unconfirmed", text: "Paid DataCo for a SOL price, not confirmed on chain" });
  });
});
