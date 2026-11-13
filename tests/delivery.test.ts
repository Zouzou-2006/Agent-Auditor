import { describe, expect, it, vi } from "vitest";
import type { DeliveryRow, OrderRow } from "../lib/db-types";
import { recordDelivery, runChecks, type DeliveryDeps, type NewDelivery } from "../lib/delivery";

const ORDER_ID = "0b6f3c2e-8a51-4e7b-9a0d-5f2c1e4d7a90";

const order = (overrides: Partial<OrderRow> = {}): OrderRow => ({
  order_id: ORDER_ID,
  created_at: "2026-11-14T12:00:00Z",
  seller_id: "dataco",
  item: "price_quote",
  params: { ticker: "SOL", date: "2026-11-14" },
  max_amount: 100000,
  purpose: "Daily SOL price for the treasury report",
  status: "paid",
  deny_reason: null,
  quote_amount: 100000,
  quote_wallet: "ATDBWGF9hk38MJZ9QHiDKw7ujZXh8nwEnqFF4D7iPXQc",
  summary: null,
  ...overrides,
});

// Exactly what DataCo returns (lib/sellers/dataco.ts).
const DATACO_BODY = JSON.stringify({ ticker: "SOL", date: "2026-11-14", price_usd: 142.1, source: "DataCo" });
const body = (overrides: Record<string, unknown>) =>
  JSON.stringify({ ...JSON.parse(DATACO_BODY), ...overrides });

const ALL_PASS = { received: true, format: true, matches_order: true };
const NOT_RECEIVED = { received: false, format: false, matches_order: false };
const BAD_FORMAT = { received: true, format: false, matches_order: false };
const WRONG_DATA = { received: true, format: true, matches_order: false };

describe("runChecks", () => {
  it("beat 1: DataCo's clean answer passes all three", () => {
    expect(runChecks(order(), DATACO_BODY)).toEqual({ checks: ALL_PASS, passed: true });
  });

  it.each([
    ["empty body (beat 2, CheapData)", ""],
    ["only whitespace", "  \n "],
  ])("received fails: %s → nothing_delivered", (_name, b) => {
    expect(runChecks(order(), b)).toEqual({ checks: NOT_RECEIVED, passed: false });
  });

  it.each([
    ["not JSON", "<html>oops</html>"],
    ["a JSON array", "[1,2,3]"],
    ["JSON null", "null"],
    ["missing price_usd", JSON.stringify({ ticker: "SOL", date: "2026-11-14", source: "DataCo" })],
    ["price_usd as a string", body({ price_usd: "142.10" })],
    ["date not YYYY-MM-DD", body({ date: "11/14/2026" })],
    ["impossible date", body({ date: "2026-02-30" })],
    ["ticker as a number", body({ ticker: 7 })],
    ["source missing", JSON.stringify({ ticker: "SOL", date: "2026-11-14", price_usd: 142.1 })],
  ])("format fails: %s → bad_format", (_name, b) => {
    expect(runChecks(order(), b)).toEqual({ checks: BAD_FORMAT, passed: false });
  });

  it("format fails for an item we have no format for (default deny)", () => {
    expect(runChecks(order({ item: "premium_report" }), DATACO_BODY)).toEqual({ checks: BAD_FORMAT, passed: false });
  });

  it.each([
    ["wrong ticker", body({ ticker: "BTC" })],
    ["wrong date", body({ date: "2026-11-13" })],
  ])("matches_order fails: %s → wrong_data", (_name, b) => {
    expect(runChecks(order(), b)).toEqual({ checks: WRONG_DATA, passed: false });
  });

  it("matches_order fails when the order's params don't name a ticker and date", () => {
    expect(runChecks(order({ params: {} }), DATACO_BODY)).toEqual({ checks: WRONG_DATA, passed: false });
    expect(runChecks(order({ params: null }), DATACO_BODY)).toEqual({ checks: WRONG_DATA, passed: false });
  });

  it("extra fields in the body are fine", () => {
    expect(runChecks(order(), body({ volume: 12 })).passed).toBe(true);
  });
});

describe("recordDelivery", () => {
  function fakeDeps() {
    const steps: string[] = [];
    const deps: DeliveryDeps = {
      insertDelivery: vi.fn(async (d: NewDelivery) => {
        steps.push("insert");
        return { ...d, received_at: "2026-11-14T12:00:01Z" } as DeliveryRow;
      }),
      tryBook: vi.fn(async () => {
        steps.push("tryBook");
        return { result: "waiting" };
      }),
    };
    return { deps, steps };
  }

  it("saves the row exactly as the seller sent it, then calls tryBook(order_id)", async () => {
    const { deps, steps } = fakeDeps();
    const row = await recordDelivery(order(), DATACO_BODY, deps);
    expect(deps.insertDelivery).toHaveBeenCalledWith({ order_id: ORDER_ID, body: DATACO_BODY, checks: ALL_PASS, passed: true });
    expect(deps.tryBook).toHaveBeenCalledWith(ORDER_ID);
    expect(steps).toEqual(["insert", "tryBook"]);
    expect(row.passed).toBe(true);
  });

  it("an empty delivery is still saved (that's the evidence) and still goes to tryBook", async () => {
    const { deps } = fakeDeps();
    const row = await recordDelivery(order({ seller_id: "cheapdata" }), "", deps);
    expect(row).toMatchObject({ body: "", checks: NOT_RECEIVED, passed: false });
    expect(deps.tryBook).toHaveBeenCalledWith(ORDER_ID);
  });

  it("doesn't call tryBook if the row couldn't be saved", async () => {
    const { deps } = fakeDeps();
    deps.insertDelivery = vi.fn(async () => {
      throw new Error("db down");
    });
    await expect(recordDelivery(order(), DATACO_BODY, deps)).rejects.toThrow("db down");
    expect(deps.tryBook).not.toHaveBeenCalled();
  });
});

// End to end with Cooper's real tryBook against the in-memory booking database.
describe("recordDelivery + tryBook (booking)", () => {
  const AGENT_WALLET = "HsyoZYyJCdDiGAvQgokFPGdvEUQy2p5byzeZvEhRRbgr";

  async function purchase(deliveredBody: string) {
    const { FakeDb } = await import("./fakeDb");
    const { tryBook } = await import("../lib/booking");
    const db = new FakeDb();
    const o = order();
    db.addOrder(o);
    db.addSeller({ seller_id: "dataco", name: "DataCo", url: "http://localhost:3000/api/sellers/dataco", wallet: o.quote_wallet!, status: "approved" });
    // The Streams webhook already matched the payment.
    db.addPayment({
      tx_signature: "sig_1", block_time: "2026-11-14T12:00:00Z", from_wallet: AGENT_WALLET, to_wallet: o.quote_wallet!,
      amount: 100000, memo: ORDER_ID, order_id: ORDER_ID, raw: {},
    });
    const deps: DeliveryDeps = {
      insertDelivery: async (d) => {
        const row = { ...d, received_at: "2026-11-14T12:00:01Z" } as DeliveryRow;
        db.addDelivery(row);
        return row;
      },
      tryBook: (id) => tryBook(id, db),
    };
    await recordDelivery(o, deliveredBody, deps);
    return db;
  }

  it("beat 1: a clean DataCo delivery is booked as Data purchases expense", async () => {
    const db = await purchase(DATACO_BODY);
    expect((await db.getOrder(ORDER_ID))?.status).toBe("booked");
    expect(db.journal).toHaveLength(1);
    expect(db.journal[0]).toMatchObject({ debit_account: "Data purchases expense", amount: 100000 });
    expect(db.exceptions).toHaveLength(0);
  });

  it.each([
    ["", "nothing_delivered", "high"],
    ["not json", "bad_format", "medium"],
    [body({ ticker: "BTC" }), "wrong_data", "medium"],
  ])("body %j → %s exception, no journal entry", async (b, type, severity) => {
    const db = await purchase(b);
    expect((await db.getOrder(ORDER_ID))?.status).toBe("exception");
    expect(db.exceptions).toEqual([expect.objectContaining({ type, severity, status: "open" })]);
    expect(db.journal).toHaveLength(0);
  });
});
