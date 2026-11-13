// POST /api/exceptions/[id], against the in-memory fake (getDb is mocked; no real database).
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExceptionRow } from "@/lib/db-types";
import { FakeDb } from "../fakeDb";

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/booking-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/booking-db")>()),
  getDb: () => holder.db,
}));

const { POST } = await import("@/app/api/exceptions/[id]/route");

const ORDER = randomUUID();
const SELLER_WALLET = "CheapDataWa11et111111111111111111111111111";

let db: FakeDb;
let exceptionId: string;

function addException(overrides: Partial<ExceptionRow> = {}): string {
  const row: ExceptionRow = {
    exception_id: randomUUID(),
    created_at: "2026-11-13T15:31:00+00:00",
    order_id: ORDER,
    tx_signature: "sig_1",
    type: "nothing_delivered",
    severity: "high",
    summary: 'Delivery failed the "received" check',
    status: "open",
    ...overrides,
  };
  db.exceptions.push(row);
  return row.exception_id;
}

beforeEach(() => {
  db = new FakeDb();
  holder.db = db;
  db.addSeller({
    seller_id: "cheapdata", name: "CheapData", url: "http://localhost:3000/api/sellers/cheapdata",
    wallet: SELLER_WALLET, status: "approved",
  });
  db.addOrder({
    order_id: ORDER, created_at: "2026-11-13T15:30:00+00:00", seller_id: "cheapdata", item: "price_quote",
    params: { ticker: "SOL", date: "2026-11-14" }, max_amount: 100000, purpose: "Daily SOL price",
    status: "exception", deny_reason: null, quote_amount: 100000, quote_wallet: SELLER_WALLET, summary: null,
  });
  db.addPayment({
    tx_signature: "sig_1", block_time: "2026-11-13T15:30:30+00:00", from_wallet: "AgentWa11et",
    to_wallet: SELLER_WALLET, amount: 100000, memo: ORDER, order_id: ORDER, raw: {},
  });
  exceptionId = addException();
});

afterEach(() => vi.restoreAllMocks());

/** POST a body (a string is sent as-is) to /api/exceptions/<id>. */
async function post(id: string, body?: unknown) {
  const init: RequestInit = { method: "POST", headers: { "content-type": "application/json" } };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  const res = await POST(new Request(`http://localhost/api/exceptions/${id}`, init), {
    params: Promise.resolve({ id }),
  });
  return { status: res.status, json: await res.json() };
}

describe("200", () => {
  it("approve: returns the exception as approved and books the purchase entry", async () => {
    const { status, json } = await post(exceptionId, { action: "approve" });

    expect(status).toBe(200);
    expect(json.exception).toMatchObject({ exception_id: exceptionId, status: "approved" });
    expect(db.journal).toHaveLength(1);
    expect(db.journal[0]).toMatchObject({ debit_account: "Data purchases expense", amount: 100000 });
    expect(db.orders.get(ORDER)!.status).toBe("booked");
  });

  it("block_seller: returns the exception as seller_blocked, blocks the seller and books the loss", async () => {
    const { status, json } = await post(exceptionId, { action: "block_seller" });

    expect(status).toBe(200);
    expect(json.exception).toMatchObject({ exception_id: exceptionId, status: "seller_blocked" });
    expect(db.sellers.get("cheapdata")!.status).toBe("blocked");
    expect(db.journal).toHaveLength(1);
    expect(db.journal[0]).toMatchObject({ debit_account: "Loss on undelivered purchases", amount: 100000 });
  });
});

describe("400", () => {
  it.each([
    ["no body", undefined],
    ["invalid JSON", "{not json"],
    ["a JSON string", '"approve"'],
    ["null", "null"],
    ["no action", {}],
    ["an unknown action", { action: "refund" }],
    ["the wrong case", { action: "Approve" }],
    ["a non-string action", { action: 1 }],
  ])("%s → 400, and nothing changes", async (_label, body) => {
    const { status, json } = await post(exceptionId, body);

    expect(status).toBe(400);
    expect(json).toEqual({ error: 'body must be {"action": "approve"} or {"action": "block_seller"}' });
    expect(db.exceptions[0].status).toBe("open");
    expect(db.journal).toHaveLength(0);
  });
});

describe("404", () => {
  it("an exception id that doesn't exist", async () => {
    expect(await post(randomUUID(), { action: "approve" })).toEqual({
      status: 404, json: { error: "exception not found" },
    });
  });

  it("an id that isn't a uuid never reaches the database", async () => {
    const spy = vi.spyOn(db, "getException");
    expect(await post("not-a-uuid", { action: "approve" })).toEqual({
      status: 404, json: { error: "exception not found" },
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("409", () => {
  it("approving twice: the second call finds it already handled", async () => {
    expect((await post(exceptionId, { action: "approve" })).status).toBe(200);

    const second = await post(exceptionId, { action: "approve" });

    expect(second).toEqual({ status: 409, json: { error: "exception already handled (status approved)" } });
    expect(db.journal).toHaveLength(1);
  });

  it("block_seller after approve", async () => {
    await post(exceptionId, { action: "approve" });

    const { status } = await post(exceptionId, { action: "block_seller" });

    expect(status).toBe(409);
    expect(db.sellers.get("cheapdata")!.status).toBe("approved");
    expect(db.journal).toHaveLength(1);
  });

  it("another click resolves it between our read and the conditional update", async () => {
    vi.spyOn(db, "updateExceptionStatusIf").mockResolvedValue(false);

    expect(await post(exceptionId, { action: "approve" })).toEqual({
      status: 409, json: { error: "exception already handled" },
    });
    expect(db.journal).toHaveLength(0);
  });

  it("a no_order (stolen-key) exception has nothing to approve or block", async () => {
    const id = addException({ order_id: null, tx_signature: "sig_stray", type: "no_order", severity: "critical" });

    for (const action of ["approve", "block_seller"]) {
      expect(await post(id, { action })).toEqual({
        status: 409, json: { error: "a no_order exception has no order, so it can't be approved or blocked" },
      });
    }
    expect(db.journal).toHaveLength(0);
  });
});

describe("500", () => {
  it("a database failure returns a short message, never the error, stack or keys", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(db, "getException").mockRejectedValue(
      new Error("booking-db: getException failed [08006]: connection to service_role@db.example.co refused"),
    );

    const { status, json } = await post(exceptionId, { action: "approve" });

    expect(status).toBe(500);
    expect(json).toEqual({ error: "internal error" });
    expect(log).toHaveBeenCalledOnce(); // the detail goes to the server log only
  });

  it("a failure inside the action (e.g. the journal insert) is also a 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(db, "insertJournalEntry").mockRejectedValue(new Error("duplicate key value violates unique constraint"));

    const { status, json } = await post(exceptionId, { action: "approve" });

    expect(status).toBe(500);
    expect(json).toEqual({ error: "internal error" });
  });
});
