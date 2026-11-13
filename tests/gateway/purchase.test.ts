import type { PaymentRequirements } from "@x402/core/types";
import { describe, expect, it, vi } from "vitest";
import rules from "@/config/rules.json";
import type { DeliveryRow, OrderRow, OrderStatus, SellerRow } from "@/lib/db-types";
import type { RecordDelivery } from "@/lib/gateway/delivery";
import type { GatewayDb, NewOrder, OrderPatch } from "@/lib/gateway/gateway-db";
import type { Pay, PayOutcome } from "@/lib/gateway/pay";
import { approveOrder, placeOrder, type GatewayDeps } from "@/lib/gateway/purchase";
import type { OrderRequest } from "@/lib/gateway/validate";

const GATEWAY = "HsyoZYyJCdDiGAvQgokFPGdvEUQy2p5byzeZvEhRRbgr";
const DATACO_WALLET = "ATDBWGF9hk38MJZ9QHiDKw7ujZXh8nwEnqFF4D7iPXQc";
const ATTACKER = "6QUTX4jCxJiBXpX2VjC66tKuodmkhvVf2qtEvbwBEfaN";
const ORDER_ID = "6f1c2a8e-0b7d-4c1e-9a52-3d4e5f60718a";
const SIG = "3Hu4pkagn4Lm9New9HoUWG89iJJ1t9R86FLRuCjr8ZY6AMaPXYE4BEaAE6MroYxasivi4qKoMnfgxsrR236o2kX2";
const BODY = '{"ticker":"SOL","date":"2026-11-14","price_usd":142.1,"source":"DataCo"}';

const sellers: Record<string, SellerRow> = {
  dataco: { seller_id: "dataco", name: "DataCo", url: "http://localhost:3000/api/sellers/dataco", wallet: DATACO_WALLET, status: "approved" },
  cheapdata: { seller_id: "cheapdata", name: "CheapData", url: "http://localhost:3000/api/sellers/cheapdata", wallet: "9umxy5", status: "blocked" },
};

const request = (overrides: Partial<OrderRequest> = {}): OrderRequest => ({
  seller_id: "dataco",
  item: "price_quote",
  params: { ticker: "SOL", date: "2026-11-14" },
  max_amount: 100000,
  purpose: "Daily SOL price for the treasury report",
  ...overrides,
});

class FakeDb implements GatewayDb {
  orders = new Map<string, OrderRow>();
  spent = 0;
  async getSeller(id: string) { return sellers[id] ?? null; }
  async getOrder(id: string) { return this.orders.get(id) ?? null; }
  async insertOrder(order: NewOrder) {
    const row: OrderRow = { ...order, created_at: "2026-11-14T00:00:00Z", summary: null };
    this.orders.set(order.order_id, row);
    return row;
  }
  async updateOrderIf(id: string, from: OrderStatus, patch: OrderPatch) {
    const row = this.orders.get(id);
    if (!row || row.status !== from) return false;
    this.orders.set(id, { ...row, ...patch });
    return true;
  }
  async todaySpent() { return this.spent; }
}

/** A quote like DataCo's, with x402's string amount. */
function quoteRequirements(overrides: Partial<PaymentRequirements> = {}, memo: string | null = ORDER_ID): PaymentRequirements {
  return {
    scheme: "exact",
    network: rules.network as PaymentRequirements["network"],
    amount: "100000",
    asset: rules.usdc_mint,
    payTo: DATACO_WALLET,
    maxTimeoutSeconds: 60,
    extra: memo === null ? { feePayer: "fp" } : { feePayer: "fp", memo }, // null = seller sent no memo
    ...overrides,
  };
}

/** Behaves like the x402 client: asks decide() first and only "pays" if it says yes. */
function fakePay(requirements: PaymentRequirements, afterDecide?: () => PayOutcome) {
  const calls: { url: string; orderId: string; statusAtCall?: OrderStatus }[] = [];
  let db: FakeDb | null = null;
  const pay: Pay = async ({ url, orderId, decide }) => {
    calls.push({ url, orderId, statusAtCall: db?.orders.get(orderId)?.status });
    const quote = /^\d+$/.test(requirements.amount)
      ? { amount: Number(requirements.amount), wallet: requirements.payTo, asset: requirements.asset, network: requirements.network }
      : null;
    const decision = await decide(requirements, quote);
    if (!decision.ok) return { kind: "refused", reason: decision.reason, quote };
    if (afterDecide) return afterDecide();
    return { kind: "paid", signature: SIG, body: BODY, httpStatus: 200, quote: quote! };
  };
  return { pay, calls, attach: (d: FakeDb) => { db = d; } };
}

function deps(db: FakeDb, pay: Pay, overrides: Partial<GatewayDeps> = {}): GatewayDeps {
  let clock = 0;
  return {
    db,
    pay,
    recordDelivery: async (order) => ({ order_id: order.order_id, received_at: "t", body: BODY, checks: {}, passed: true } as DeliveryRow),
    gatewayWallet: GATEWAY,
    newOrderId: () => ORDER_ID,
    now: () => new Date(clock),
    sleep: async (ms) => { clock += ms; },
    bookingWaitMs: 20_000,
    pollMs: 1_000,
    ...overrides,
  };
}

describe("placeOrder: rules 1-3 before contacting the seller", () => {
  it.each([
    [{ seller_id: "premiumreports" }, 0, "seller not approved"],
    [{ seller_id: "cheapdata" }, 0, "seller blocked"],
    [{ max_amount: 1_500_000 }, 0, "over per-purchase limit"],
    [{ max_amount: 100_000 }, 4_950_000, "over daily limit"],
  ] as const)("%j (spent %i) -> denied: %s", async (overrides, spent, reason) => {
    const db = new FakeDb();
    db.spent = spent;
    const { pay, calls } = fakePay(quoteRequirements());
    const result = await placeOrder(request(overrides), deps(db, pay));
    expect(result).toEqual({ http: 200, body: { order_id: ORDER_ID, status: "denied", reason, data: null } });
    expect(db.orders.get(ORDER_ID)).toMatchObject({ status: "denied", deny_reason: reason });
    expect(calls).toHaveLength(0); // the seller is never contacted
  });

  it("over human_review_over -> pending_review, nothing paid", async () => {
    const db = new FakeDb();
    const { pay, calls } = fakePay(quoteRequirements());
    const result = await placeOrder(request({ max_amount: 600_000 }), deps(db, pay));
    expect(result.body).toMatchObject({ status: "pending_review" });
    expect(db.orders.get(ORDER_ID)?.status).toBe("pending_review");
    expect(calls).toHaveLength(0);
  });
});

describe("placeOrder: clean purchase", () => {
  it("saves `paying` before paying, records the quote, then books once the webhook lands", async () => {
    const db = new FakeDb();
    const fake = fakePay(quoteRequirements());
    fake.attach(db);
    // Simulate the Streams webhook + tryBook booking the order a few seconds later.
    let polls = 0;
    const getOrder = db.getOrder.bind(db);
    db.getOrder = async (id) => {
      polls += 1;
      if (polls === 3) await db.updateOrderIf(id, "paid", { status: "booked" });
      return getOrder(id);
    };
    const recordDelivery = vi.fn<RecordDelivery>(async (order) => ({ order_id: order.order_id } as DeliveryRow));

    const result = await placeOrder(request(), deps(db, fake.pay, { recordDelivery }));

    expect(fake.calls).toEqual([
      { url: "http://localhost:3000/api/sellers/dataco?ticker=SOL&date=2026-11-14", orderId: ORDER_ID, statusAtCall: "paying" },
    ]);
    expect(recordDelivery).toHaveBeenCalledWith(expect.objectContaining({ order_id: ORDER_ID, status: "paid" }), BODY);
    expect(db.orders.get(ORDER_ID)).toMatchObject({ status: "booked", quote_amount: 100000, quote_wallet: DATACO_WALLET });
    expect(result).toEqual({
      http: 200,
      body: { order_id: ORDER_ID, status: "booked", reason: "booked", data: JSON.parse(BODY) },
    });
  });

  it("returns `paid` when the webhook hasn't landed within the wait", async () => {
    const db = new FakeDb();
    const result = await placeOrder(request(), deps(db, fakePay(quoteRequirements()).pay));
    expect(result.body).toMatchObject({ status: "paid", data: JSON.parse(BODY) });
    expect(String((result.body as { reason: string }).reason)).toContain(SIG);
    expect(db.orders.get(ORDER_ID)?.status).toBe("paid");
  });

  it("returns `exception` when tryBook raised one", async () => {
    const db = new FakeDb();
    const getOrder = db.getOrder.bind(db);
    db.getOrder = async (id) => {
      await db.updateOrderIf(id, "paid", { status: "exception" });
      return getOrder(id);
    };
    const result = await placeOrder(request(), deps(db, fakePay(quoteRequirements()).pay));
    expect(result.body).toMatchObject({ status: "exception" });
  });

  it("says so when the delivery checks aren't connected yet (stub returns null)", async () => {
    const db = new FakeDb();
    const result = await placeOrder(request(), deps(db, fakePay(quoteRequirements()).pay, { recordDelivery: async () => null }));
    expect(result.body).toMatchObject({ status: "paid" });
    expect((result.body as { reason: string }).reason).toContain("delivery checks not connected yet");
  });
});

describe("placeOrder: quote checks happen before signing", () => {
  it.each([
    ["quote over max (rule 4)", quoteRequirements({ amount: "150000" }), "quote over max"],
    ["attacker wallet (rule 5)", quoteRequirements({ payTo: ATTACKER }), "quote wallet doesn't match seller"],
    ["SOL instead of USDC (rule 6)", quoteRequirements({ asset: "So11111111111111111111111111111111111111112" }), "wrong asset or network"],
    ["v1 network name (rule 6)", quoteRequirements({ network: "solana-devnet" as PaymentRequirements["network"] }), "wrong asset or network"],
    ["non-integer amount", quoteRequirements({ amount: "0.1" }), "wrong asset or network"],
    ["memo is another order", quoteRequirements({}, "11111111-2222-4333-8444-555555555555"), "quote memo doesn't match order"],
    ["no memo at all", quoteRequirements({}, null), "quote memo doesn't match order"],
  ])("%s -> denied", async (_label, requirements, reason) => {
    const db = new FakeDb();
    const result = await placeOrder(request(), deps(db, fakePay(requirements).pay));
    expect(result.body).toMatchObject({ status: "denied", reason });
    expect(db.orders.get(ORDER_ID)).toMatchObject({ status: "denied", deny_reason: reason });
  });

  it("keeps the seller's quote on a denied order (dashboard shows what was asked)", async () => {
    const db = new FakeDb();
    await placeOrder(request(), deps(db, fakePay(quoteRequirements({ payTo: ATTACKER })).pay));
    expect(db.orders.get(ORDER_ID)).toMatchObject({ quote_amount: 100000, quote_wallet: ATTACKER });
  });
});

describe("placeOrder: payment problems", () => {
  it("failure before signing -> denied `payment failed`", async () => {
    const db = new FakeDb();
    const pay: Pay = async () => ({ kind: "failed", error: "seller answered HTTP 500", quote: null });
    const result = await placeOrder(request(), deps(db, pay));
    expect(result.body).toMatchObject({ status: "denied", reason: "payment failed" });
    expect(db.orders.get(ORDER_ID)?.status).toBe("denied");
  });

  it("signed but unconfirmed -> 502 and the order stays `paying` (never a false denial)", async () => {
    const db = new FakeDb();
    const fake = fakePay(quoteRequirements(), () => ({ kind: "unknown", error: "settlement_pending", quote: null, signature: SIG }));
    const result = await placeOrder(request(), deps(db, fake.pay));
    expect(result.http).toBe(502);
    expect(result.body).toMatchObject({ order_id: ORDER_ID });
    expect(db.orders.get(ORDER_ID)?.status).toBe("paying");
  });
});

describe("approveOrder", () => {
  async function pending(db: FakeDb) {
    await placeOrder(request({ max_amount: 600_000 }), deps(db, fakePay(quoteRequirements()).pay));
    expect(db.orders.get(ORDER_ID)?.status).toBe("pending_review");
  }

  it("404 for an unknown order", async () => {
    const result = await approveOrder(ORDER_ID, deps(new FakeDb(), fakePay(quoteRequirements()).pay));
    expect(result.http).toBe(404);
  });

  it("pays an approved $0.60 order without sending it back to review", async () => {
    const db = new FakeDb();
    await pending(db);
    const result = await approveOrder(ORDER_ID, deps(db, fakePay(quoteRequirements()).pay));
    expect(result.body).toMatchObject({ status: "paid" });
    expect(db.orders.get(ORDER_ID)?.status).toBe("paid");
  });

  it("re-runs checkOrder: the daily total may have moved while it waited", async () => {
    const db = new FakeDb();
    await pending(db);
    db.spent = 4_500_000;
    const result = await approveOrder(ORDER_ID, deps(db, fakePay(quoteRequirements()).pay));
    expect(result.body).toMatchObject({ status: "denied", reason: "over daily limit" });
  });

  it("a second Approve click gets 409 and never pays twice", async () => {
    const db = new FakeDb();
    await pending(db);
    const fake = fakePay(quoteRequirements());
    await approveOrder(ORDER_ID, deps(db, fake.pay));
    const second = await approveOrder(ORDER_ID, deps(db, fake.pay));
    expect(second.http).toBe(409);
    expect(fake.calls).toHaveLength(1);
  });
});
