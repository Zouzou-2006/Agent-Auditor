import { beforeEach, describe, expect, it } from "vitest";
import {
  ACCOUNTS,
  approveException,
  blockSeller,
  flagUnmatchedPayment,
  tryBook,
} from "../lib/booking";
import type { Delivery, Order, Payment } from "../lib/db";
import { FakeDb } from "./fakeDb";

const DATACO_WALLET = "DataCoWa11et1111111111111111111111111111111";
const AGENT_WALLET = "AgentWa11et33333333333333333333333333333333";
const OTHER_WALLET = "SomeoneE1se2222222222222222222222222222222";
const ORDER = "ord_1";
const BLOCK_TIME = "2026-11-13T15:30:00+00:00"; // timestamptz, as Supabase returns it

const payment = (overrides: Partial<Payment> = {}): Payment => ({
  tx_signature: "sig_1",
  from_wallet: AGENT_WALLET,
  to_wallet: DATACO_WALLET,
  amount: 100000,
  memo: ORDER,
  order_id: ORDER,
  block_time: BLOCK_TIME,
  ...overrides,
});

const delivery = (checks: Partial<Delivery["checks"]> = {}): Delivery => {
  const c = { received: true, format: true, matches_order: true, ...checks };
  return { order_id: ORDER, checks: c, passed: c.received && c.format && c.matches_order };
};
const EMPTY_DELIVERY = delivery({ received: false, format: false, matches_order: false });

// "paid" = the gateway has sent the payment; the webhook may not have confirmed it yet.
const paidOrder = (overrides: Partial<Order> = {}): Order => ({
  order_id: ORDER,
  seller_id: "dataco",
  item: "price_quote",
  params: { ticker: "SOL", date: "2026-11-14" },
  status: "paid",
  quote_amount: 100000,
  quote_wallet: DATACO_WALLET,
  ...overrides,
});

let db: FakeDb;
beforeEach(() => {
  db = new FakeDb();
  db.addSeller({ seller_id: "dataco", name: "DataCo", wallet: DATACO_WALLET, status: "approved" });
  db.addOrder(paidOrder());
});

const purchaseEntry = {
  order_id: ORDER,
  tx_signature: "sig_1",
  entry_date: "2026-11-13",
  debit_account: ACCOUNTS.dataExpense,
  credit_account: ACCOUNTS.agentWallet,
  amount: 100000,
  description: "SOL price quote from DataCo",
};

describe("tryBook", () => {
  it("a clean purchase books once, even if called again", async () => {
    db.addPayment(payment());
    db.addDelivery(delivery());

    expect((await tryBook(ORDER, db)).result).toBe("booked");
    expect((await tryBook(ORDER, db)).result).toBe("skipped");

    expect(db.journal).toHaveLength(1);
    expect(db.journal[0]).toMatchObject(purchaseEntry);
    expect(db.exceptions).toHaveLength(0);
    expect(db.orders.get(ORDER)!.status).toBe("booked");
  });

  it("payment then delivery books", async () => {
    db.addPayment(payment());
    expect((await tryBook(ORDER, db)).result).toBe("waiting"); // webhook call
    db.addDelivery(delivery());
    expect((await tryBook(ORDER, db)).result).toBe("booked"); // delivery-check call
    expect(db.journal).toHaveLength(1);
  });

  it("delivery then payment books", async () => {
    db.addDelivery(delivery());
    expect((await tryBook(ORDER, db)).result).toBe("waiting"); // delivery-check call
    db.addPayment(payment());
    expect((await tryBook(ORDER, db)).result).toBe("booked"); // webhook call
    expect(db.journal).toHaveLength(1);
  });

  it("two simultaneous calls book only once", async () => {
    db.addPayment(payment());
    db.addDelivery(delivery());

    const results = await Promise.all([tryBook(ORDER, db), tryBook(ORDER, db)]);

    expect(results.map((r) => r.result).sort()).toEqual(["booked", "skipped"]);
    expect(db.journal).toHaveLength(1);
    expect(db.exceptions).toHaveLength(0);
  });

  it("an empty delivery gives one nothing_delivered exception", async () => {
    db.addPayment(payment());
    db.addDelivery(EMPTY_DELIVERY);

    expect((await tryBook(ORDER, db)).result).toBe("exception");

    expect(db.exceptions).toHaveLength(1);
    expect(db.exceptions[0]).toMatchObject({
      order_id: ORDER, tx_signature: "sig_1", type: "nothing_delivered", severity: "high", status: "open",
    });
    expect(db.exceptions[0].summary).not.toBe(""); // factual fallback until the AI summary overwrites it
    expect(db.journal).toHaveLength(0);
    expect(db.orders.get(ORDER)!.status).toBe("exception");
  });

  it("wrong wallet plus empty delivery gives only wallet_mismatch", async () => {
    db.addPayment(payment({ to_wallet: OTHER_WALLET }));
    db.addDelivery(EMPTY_DELIVERY);

    await tryBook(ORDER, db);

    expect(db.exceptions).toHaveLength(1);
    expect(db.exceptions[0]).toMatchObject({ type: "wallet_mismatch", severity: "critical" });
    expect(db.journal).toHaveLength(0);
  });

  it("an order with no quote wallet gives wallet_mismatch, not a booking", async () => {
    db.addOrder(paidOrder({ quote_wallet: null, quote_amount: null }));
    db.addPayment(payment());
    db.addDelivery(delivery());

    expect((await tryBook(ORDER, db)).result).toBe("exception");
    expect(db.exceptions[0]).toMatchObject({ type: "wallet_mismatch", severity: "critical" });
    expect(db.journal).toHaveLength(0);
  });

  it("a non-price_quote item is described as '<item> from <seller name>'", async () => {
    db.addOrder(paidOrder({ item: "news_report", params: {} }));
    db.addPayment(payment());
    db.addDelivery(delivery());

    await tryBook(ORDER, db);

    expect(db.journal[0].description).toBe("news_report from DataCo");
  });

  it("falls back to seller_id in the description if the seller row is missing", async () => {
    db.sellers.clear();
    db.addPayment(payment());
    db.addDelivery(delivery());

    await tryBook(ORDER, db);

    expect(db.journal[0].description).toBe("SOL price quote from dataco");
  });

  it("without a Db it hits the labelled Supabase stub", async () => {
    await expect(tryBook(ORDER)).rejects.toThrow("Supabase Db not implemented yet");
  });
});

describe("flagUnmatchedPayment", () => {
  it("creates a critical no_order exception with no order and no journal entry", async () => {
    const stray = payment({ tx_signature: "sig_stray", order_id: null, memo: null });

    await flagUnmatchedPayment(stray, db);

    expect(db.exceptions).toHaveLength(1);
    expect(db.exceptions[0]).toMatchObject({
      order_id: null, tx_signature: "sig_stray", type: "no_order", severity: "critical", status: "open",
    });
    expect(db.journal).toHaveLength(0);
  });

  it("calling it twice for the same transaction creates one exception", async () => {
    const stray = payment({ tx_signature: "sig_stray", order_id: null, memo: null });

    const first = await flagUnmatchedPayment(stray, db);
    const second = await flagUnmatchedPayment(stray, db);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(db.exceptions).toHaveLength(1);
  });
});

describe("resolving exceptions", () => {
  const makeException = async () => {
    db.addPayment(payment());
    db.addDelivery(EMPTY_DELIVERY);
    const r = await tryBook(ORDER, db);
    if (r.result !== "exception") throw new Error("expected an exception");
    return r.exception.exception_id;
  };

  it("approveException books the purchase entry and marks things approved/booked", async () => {
    const id = await makeException();

    await approveException(id, db);

    expect(db.journal).toHaveLength(1);
    expect(db.journal[0]).toMatchObject(purchaseEntry);
    expect(db.exceptions[0].status).toBe("approved");
    expect(db.orders.get(ORDER)!.status).toBe("booked");
    expect(await approveException(id, db)).toBeNull(); // double click does nothing
    expect(db.journal).toHaveLength(1);
  });

  it("blockSeller blocks the seller and books the loss entry", async () => {
    const id = await makeException();

    await blockSeller(id, db);

    expect(db.journal).toHaveLength(1);
    expect(db.journal[0]).toMatchObject({
      ...purchaseEntry,
      debit_account: ACCOUNTS.undeliveredLoss,
      credit_account: ACCOUNTS.agentWallet,
      description: "Loss on undelivered SOL price quote from DataCo",
    });
    expect(db.sellers.get("dataco")!.status).toBe("blocked");
    expect(db.exceptions[0].status).toBe("seller_blocked");
    expect(await blockSeller(id, db)).toBeNull();
    expect(db.journal).toHaveLength(1);
  });
});
