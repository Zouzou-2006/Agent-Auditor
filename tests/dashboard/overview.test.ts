import { describe, expect, it } from "vitest";
import type { ExceptionRow, OrderRow, PaymentRow } from "../../lib/db-types";
import { EMPTY_DATA, type DashboardData, type Rules } from "../../lib/dashboard/model";
import {
  attentionItems,
  etClock,
  exceptionSentence,
  itemPhrase,
  nextUtcMidnight,
  orderSentence,
  pendingSentence,
  recentActivity,
  weekStartEt,
  weekStats,
} from "../../lib/dashboard/overview";

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

describe("sentences", () => {
  const d = data({});
  it("quotes the deny reason exactly", () => {
    const o = order({ order_id: "o1", status: "denied", created_at: "2026-11-15T10:00:00Z", seller_id: "premiumreports", deny_reason: "seller not approved" });
    expect(orderSentence(o, d)).toBe("Blocked a price quote from premiumreports: seller not approved. No money moved.");
  });

  it("uses the seller's display name and the quote amount", () => {
    const o = order({ order_id: "o1", status: "booked", created_at: "2026-11-15T10:00:00Z", quote_amount: 100000 });
    expect(orderSentence(o, d)).toBe("Bought a price quote from DataCo for $0.10. Delivered as ordered and booked.");
  });

  it("writes the pending review sentence with the review limit", () => {
    const o = order({ order_id: "o1", status: "pending_review", created_at: "2026-11-15T10:00:00Z", max_amount: 600000 });
    expect(pendingSentence(o, d, rules)).toBe("Your agent wants to buy a price quote from DataCo for $0.60. Over your $0.50 review limit.");
  });

  it("explains a no_order exception from its payment", () => {
    const d2 = data({ payments: [payment({ tx_signature: "tx1", block_time: "2026-11-15T10:00:00Z", amount: 250000 })] });
    const e = exception({ exception_id: "e1", type: "no_order", severity: "critical", created_at: "2026-11-15T10:00:05Z", tx_signature: "tx1" });
    expect(exceptionSentence(e, d2)).toBe("$0.25 left the agent wallet with no matching order. Possible stolen key.");
  });

  it("adds a/an to the item", () => {
    expect(itemPhrase("price_quote")).toBe("a price quote");
    expect(itemPhrase("api_report")).toBe("an api report");
  });
});

describe("attentionItems", () => {
  it("lists open exceptions (critical first) then pending orders, and prefers the AI summary", () => {
    const d = data({
      orders: [
        order({ order_id: "p1", status: "pending_review", created_at: "2026-11-15T09:00:00Z", max_amount: 600000, summary: "Large quote" }),
        order({ order_id: "x1", status: "exception", created_at: "2026-11-15T08:00:00Z" }),
      ],
      exceptions: [
        exception({ exception_id: "e-high", type: "nothing_delivered", severity: "high", created_at: "2026-11-15T11:00:00Z", order_id: "x1", summary: "CheapData sent nothing." }),
        exception({ exception_id: "e-crit", type: "no_order", severity: "critical", created_at: "2026-11-15T10:00:00Z" }),
        exception({ exception_id: "e-done", type: "wrong_data", severity: "medium", created_at: "2026-11-15T12:00:00Z", status: "approved" }),
      ],
    });
    const items = attentionItems(d, rules);
    expect(items.map((i) => i.key)).toEqual(["e-crit", "e-high", "p1"]);
    expect(items[1].text).toBe("CheapData sent nothing.");
    const pending = items[2];
    expect(pending.kind === "pending" && pending.note).toBe("Large quote");
  });

  it("is empty when nothing needs a human", () => {
    expect(attentionItems(data({ orders: [order({ order_id: "b", status: "booked", created_at: "2026-11-15T09:00:00Z" })] }), rules)).toEqual([]);
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
});

describe("recentActivity", () => {
  it("mixes orders and exceptions newest first, capped, with tx links and summaries", () => {
    const orders = Array.from({ length: 9 }, (_, i) =>
      order({ order_id: `o${i}`, status: "booked", created_at: `2026-11-15T0${i}:00:00Z`, summary: i === 8 ? "AI line" : null }),
    );
    const d = data({
      orders,
      payments: [payment({ tx_signature: "tx8", block_time: "2026-11-15T08:00:10Z", order_id: "o8" })],
      exceptions: [exception({ exception_id: "e1", type: "no_order", severity: "critical", created_at: "2026-11-15T09:30:00Z", tx_signature: "txz" })],
    });
    const rows = recentActivity(d, 8);
    expect(rows).toHaveLength(8);
    expect(rows[0]).toMatchObject({ rowKey: "e1", kind: "exception", critical: true, order: null, tx: "txz" });
    expect(rows[1]).toMatchObject({ rowKey: "o8", kind: "paid", text: "AI line", tx: "tx8" });
    expect(rows[2].text).toBe("Bought a price quote from DataCo for $0.10. Delivered as ordered and booked.");
  });
});
