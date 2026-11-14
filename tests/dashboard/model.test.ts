import { describe, expect, it } from "vitest";
import type { OrderRow, PaymentRow } from "@/lib/db-types";
import {
  computeOverview,
  dailySpend,
  denyStage,
  EMPTY_DATA,
  explorerAddressUrl,
  explorerTxUrl,
  filterOrders,
  formatUsd,
  orderTrail,
  paymentTxByOrder,
  percent,
  type DashboardData,
  type Rules,
} from "@/lib/dashboard/model";

const GATEWAY = "HsyoZYyJCdDiGAvQgokFPGdvEUQy2p5byzeZvEhRRbgr";
const DATACO = "ATDBWGF9hk38MJZ9QHiDKw7ujZXh8nwEnqFF4D7iPXQc";
const NOW = new Date("2026-11-14T15:00:00Z");

const rules: Rules = {
  network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  asset: "USDC",
  usdc_mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  max_per_purchase: 1000000,
  max_per_day: 5000000,
  human_review_over: 500000,
};

function order(overrides: Partial<OrderRow>): OrderRow {
  return {
    order_id: "11111111-1111-4111-8111-111111111111",
    created_at: "2026-11-14T14:00:00Z",
    seller_id: "dataco",
    item: "price_quote",
    params: { ticker: "SOL", date: "2026-11-14" },
    max_amount: 100000,
    purpose: "Daily SOL price",
    status: "booked",
    deny_reason: null,
    quote_amount: 100000,
    quote_wallet: DATACO,
    summary: null,
    ...overrides,
  };
}

function payment(overrides: Partial<PaymentRow>): PaymentRow {
  return {
    tx_signature: "sig1",
    block_time: "2026-11-14T14:00:05Z",
    from_wallet: GATEWAY,
    to_wallet: DATACO,
    amount: 100000,
    memo: "11111111-1111-4111-8111-111111111111",
    order_id: "11111111-1111-4111-8111-111111111111",
    raw: {},
    ...overrides,
  };
}

describe("formatUsd (integer base units, no floats)", () => {
  it.each([
    [100000, "$0.10"],
    [1000000, "$1.00"],
    [1250000, "$1.25"],
    [1500, "$0.0015"],
    [0, "$0.00"],
    [5000000000, "$5,000.00"],
    [-100000, "-$0.10"],
  ])("%i -> %s", (n, s) => expect(formatUsd(n)).toBe(s));

  it("shows a dash for a missing amount", () => {
    expect(formatUsd(null)).toBe("—");
  });
});

describe("percent", () => {
  it("floors and clamps", () => {
    expect(percent(100000, 5000000)).toBe(2);
    expect(percent(6000000, 5000000)).toBe(100);
    expect(percent(1, 0)).toBe(0);
  });
});

describe("computeOverview", () => {
  const data: DashboardData = {
    ...EMPTY_DATA,
    orders: [order({}), order({ order_id: "b", status: "denied", deny_reason: "seller not approved" })],
    payments: [
      payment({}),
      payment({ tx_signature: "old", block_time: "2026-11-13T23:59:59Z" }),
      payment({ tx_signature: "stolen", order_id: null, memo: null, to_wallet: "attacker" }),
      payment({ tx_signature: "faucet", from_wallet: "faucet", to_wallet: GATEWAY, order_id: null }),
    ],
    exceptions: [
      { exception_id: "e1", created_at: NOW.toISOString(), order_id: null, tx_signature: "stolen", type: "no_order", severity: "critical", summary: null, status: "open" },
      { exception_id: "e2", created_at: NOW.toISOString(), order_id: "x", tx_signature: null, type: "nothing_delivered", severity: "high", summary: null, status: "seller_blocked" },
    ],
    journal_entries: [
      { entry_id: "j1", order_id: "a", tx_signature: "sig1", entry_date: "2026-11-14", debit_account: "Data purchases expense", credit_account: "USDC - agent wallet", amount: 100000, description: "SOL price quote from DataCo" },
      { entry_id: "j2", order_id: "x", tx_signature: null, entry_date: "2026-11-14", debit_account: "Loss on undelivered purchases", credit_account: "USDC - agent wallet", amount: 100000, description: "Loss" },
    ],
  };
  const o = computeOverview(data, rules, GATEWAY, NOW);

  it("counts only today's outgoing payments against the daily limit (UTC)", () => {
    expect(o.spentToday).toBe(200000);
    expect(o.dailyLimit).toBe(5000000);
    expect(o.dailyUsedPct).toBe(4);
  });

  it("counts statuses, open exceptions and unmatched outgoing payments", () => {
    expect(o.ordersByStatus.booked).toBe(1);
    expect(o.blockedBeforePayment).toBe(1);
    expect(o.openExceptions).toBe(1);
    expect(o.openBySeverity.critical).toBe(1);
    expect(o.unmatchedPayments).toBe(1);
  });

  it("books only Data purchases expense as purchases", () => {
    expect(o.bookedAmount).toBe(100000);
  });
});

describe("dailySpend", () => {
  it("zero-fills the window and ignores incoming funding", () => {
    const buckets = dailySpend(
      [payment({}), payment({ tx_signature: "in", from_wallet: "faucet", to_wallet: GATEWAY })],
      GATEWAY,
      NOW,
      3,
    );
    expect(buckets.map((b) => b.day)).toEqual(["2026-11-12", "2026-11-13", "2026-11-14"]);
    expect(buckets.map((b) => b.amount)).toEqual([0, 0, 100000]);
  });
});

describe("filterOrders", () => {
  const orders = [order({}), order({ order_id: "zzz", seller_id: "cheapdata", status: "denied", deny_reason: "seller blocked" })];

  it("filters by status, seller and free text", () => {
    expect(filterOrders(orders, { query: "", status: "denied", seller: "all" })).toHaveLength(1);
    expect(filterOrders(orders, { query: "", status: "all", seller: "dataco" })).toHaveLength(1);
    expect(filterOrders(orders, { query: "BLOCKED", status: "all", seller: "all" })[0].order_id).toBe("zzz");
    expect(filterOrders(orders, { query: "SOL", status: "all", seller: "all" })).toHaveLength(2);
  });
});

describe("denyStage uses the exact SPEC reason strings", () => {
  it.each([
    ["seller not approved", "rules"],
    ["seller blocked", "rules"],
    ["over per-purchase limit", "rules"],
    ["over daily limit", "rules"],
    ["quote over max", "quote"],
    ["quote wallet doesn't match seller", "quote"],
    ["wrong asset or network", "quote"],
    ["quote memo doesn't match order", "quote"],
    ["payment failed", "payment"],
  ])("%s -> %s", (reason, stage) => expect(denyStage(reason)).toBe(stage));
});

describe("orderTrail", () => {
  it("shows a clean purchase end to end", () => {
    const data: DashboardData = {
      ...EMPTY_DATA,
      orders: [order({})],
      payments: [payment({})],
      deliveries: [{ order_id: order({}).order_id, received_at: NOW.toISOString(), body: "{}", checks: { received: true, format: true, matches_order: true }, passed: true }],
      journal_entries: [{ entry_id: "j1", order_id: order({}).order_id, tx_signature: "sig1", entry_date: "2026-11-14", debit_account: "Data purchases expense", credit_account: "USDC - agent wallet", amount: 100000, description: "d" }],
    };
    const trail = orderTrail(order({}), data);
    expect(trail.steps.map((s) => s.state)).toEqual(["done", "done", "done", "done", "done"]);
    expect(trail.steps[4].detail).toContain("Dr Data purchases expense");
  });

  it("marks a rule denial and skips everything after it", () => {
    const denied = order({ status: "denied", deny_reason: "seller not approved", quote_amount: null, quote_wallet: null });
    const trail = orderTrail(denied, { ...EMPTY_DATA, orders: [denied] });
    expect(trail.steps.map((s) => [s.key, s.state])).toEqual([
      ["rules", "failed"],
      ["quote", "skipped"],
      ["payment", "skipped"],
      ["delivery", "skipped"],
      ["booking", "skipped"],
    ]);
    expect(trail.steps[0].detail).toBe("Denied: seller not approved");
  });

  it("puts a memo mismatch at the quote step even with no quote saved", () => {
    const denied = order({ status: "denied", deny_reason: "quote memo doesn't match order", quote_amount: null, quote_wallet: null });
    const trail = orderTrail(denied, { ...EMPTY_DATA, orders: [denied] });
    expect(trail.steps[0].state).toBe("done");
    expect(trail.steps[1]).toMatchObject({ key: "quote", state: "failed" });
  });

  it("adds a waiting review step for pending_review", () => {
    const pending = order({ status: "pending_review", max_amount: 600000, quote_amount: null, quote_wallet: null });
    const trail = orderTrail(pending, { ...EMPTY_DATA, orders: [pending] });
    expect(trail.steps[1]).toMatchObject({ key: "review", state: "waiting" });
  });
});

describe("explorer links", () => {
  it("opens wallets on the Tokens tab, so a seller's USDC shows up", () => {
    expect(explorerAddressUrl(DATACO)).toBe(`https://explorer.solana.com/address/${DATACO}/tokens?cluster=devnet`);
  });

  it("opens transactions on devnet", () => {
    expect(explorerTxUrl("Fwz6")).toBe("https://explorer.solana.com/tx/Fwz6?cluster=devnet");
  });
});

describe("paymentTxByOrder", () => {
  it("maps each matched order to its payment tx and skips unmatched payments", () => {
    const matched = payment({ tx_signature: "SIG_A", order_id: "order-a" });
    const unmatched = payment({ tx_signature: "SIG_B", order_id: null });
    const map = paymentTxByOrder([matched, unmatched]);
    expect(map.get("order-a")).toBe("SIG_A");
    expect(map.size).toBe(1);
    expect(map.get("order-without-payment")).toBeUndefined();
  });
});
