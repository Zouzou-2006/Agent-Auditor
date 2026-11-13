import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import rules from "../../config/rules.json";
import { GET } from "../../app/api/sellers/[seller]/route";
import { DATACO_PRICE, parseParams } from "../../lib/sellers/dataco";
import { checkQuote } from "../../lib/rules";
import { decodeHeader, encodeHeader, resetFeePayerCache, type PaymentRequired } from "../../lib/sellers/x402";

const DATACO_WALLET = "DataCoWa11et1111111111111111111111111111111";
const FEE_PAYER = "FeePayer111111111111111111111111111111111111";
const FACILITATOR = "https://facilitator.test";
const ORDER_ID = "0b6f3c2e-8a51-4e7b-9a0d-5f2c1e4d7a90";

type FacilitatorReply = { verify?: object; settle?: object };

function mockFacilitator(reply: FacilitatorReply = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const path = input.replace(FACILITATOR, "");
      calls.push(path);
      if (path === "/supported") {
        return Response.json({ kinds: [{ x402Version: 2, scheme: "exact", network: rules.network, extra: { feePayer: FEE_PAYER } }] });
      }
      if (path === "/verify") return Response.json(reply.verify ?? { isValid: true, payer: "Buyer" });
      if (path === "/settle") {
        return Response.json(reply.settle ?? { success: true, transaction: "5igTx", network: rules.network, payer: "Buyer" });
      }
      return new Response("not found", { status: 404 });
    }),
  );
  return calls;
}

const call = (query: string, headers: Record<string, string> = {}, seller = "dataco") =>
  GET(new Request(`http://localhost/api/sellers/${seller}?${query}`, { headers: { "X-Order-Id": ORDER_ID, ...headers } }), {
    params: Promise.resolve({ seller }),
  });

beforeEach(() => {
  vi.stubEnv("DATACO_WALLET", DATACO_WALLET);
  vi.stubEnv("X402_FACILITATOR_URL", FACILITATOR);
  resetFeePayerCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("DataCo without payment", () => {
  it("answers 402 with a quote that passes Cooper's checkQuote", async () => {
    mockFacilitator();
    const res = await call("ticker=SOL&date=2026-11-14");
    expect(res.status).toBe(402);

    const body = (await res.json()) as PaymentRequired;
    expect(decodeHeader(res.headers.get("PAYMENT-REQUIRED")!)).toEqual(body);
    const [q] = body.accepts;
    expect(q).toMatchObject({
      scheme: "exact",
      network: rules.network,
      amount: "100000",
      asset: rules.usdc_mint,
      payTo: DATACO_WALLET,
      extra: { feePayer: FEE_PAYER, memo: ORDER_ID },
    });

    // What the gateway will do with it (amount arrives as a string, so it converts first).
    const quote = { amount: Number(q.amount), wallet: q.payTo, asset: q.asset, network: q.network };
    expect(checkQuote({ max_amount: DATACO_PRICE }, quote, { wallet: DATACO_WALLET, status: "approved" })).toEqual({ ok: true });
  });
});

describe("DataCo with payment", () => {
  const paid = { "PAYMENT-SIGNATURE": encodeHeader({ x402Version: 2, payload: { transaction: "base64tx" } }) };

  it("verifies, settles, then returns clean JSON for the ticker and date asked", async () => {
    const calls = mockFacilitator();
    const res = await call("ticker=SOL&date=2026-11-14", paid);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ticker: "SOL", date: "2026-11-14", price_usd: 142.1, source: "DataCo" });
    expect(decodeHeader(res.headers.get("PAYMENT-RESPONSE")!)).toMatchObject({ success: true, transaction: "5igTx" });
    expect(calls).toEqual(["/supported", "/verify", "/settle"]);
  });

  it("sends the facilitator the same order_id memo as the 402 quote", async () => {
    mockFacilitator();
    await call("ticker=SOL&date=2026-11-14", paid);
    const fetchMock = vi.mocked(fetch);
    const settle = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/settle"));
    const sent = JSON.parse(String((settle?.[1] as RequestInit).body));
    expect(sent.paymentRequirements.extra.memo).toBe(ORDER_ID);
  });

  it("gives no data when the facilitator rejects the payment", async () => {
    const calls = mockFacilitator({ verify: { isValid: false, invalidReason: "insufficient_funds" } });
    const res = await call("ticker=SOL&date=2026-11-14", paid);
    expect(res.status).toBe(402);
    expect(((await res.json()) as PaymentRequired).error).toBe("insufficient_funds");
    expect(calls).not.toContain("/settle");
  });

  it("gives no data when settlement fails", async () => {
    mockFacilitator({ settle: { success: false, errorReason: "transaction_failed" } });
    const res = await call("ticker=SOL&date=2026-11-14", paid);
    expect(res.status).toBe(402);
  });

  it("gives no data for a garbage payment header", async () => {
    const calls = mockFacilitator();
    const res = await call("ticker=SOL&date=2026-11-14", { "PAYMENT-SIGNATURE": "not-base64-json!!" });
    expect(res.status).toBe(402);
    expect(calls).not.toContain("/verify");
  });
});

describe("DataCo bad requests never get a quote", () => {
  it.each([
    ["missing date", "ticker=SOL"],
    ["unknown ticker", "ticker=DOGE&date=2026-11-14"],
    ["impossible date", "ticker=SOL&date=2026-02-30"],
    ["wrong date format", "ticker=SOL&date=11/14/2026"],
  ])("%s → 400", async (_name, query) => {
    const calls = mockFacilitator();
    const res = await call(query);
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it.each([
    ["missing X-Order-Id", ""],
    ["X-Order-Id that isn't a uuid", "order-1"],
  ])("%s → 400, because the payment couldn't be matched to its order", async (_name, orderId) => {
    const calls = mockFacilitator();
    const res = await call("ticker=SOL&date=2026-11-14", { "X-Order-Id": orderId });
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("parseParams accepts a normal request", () => {
    expect(parseParams(new URLSearchParams("ticker=ETH&date=2026-11-14"))).toEqual({ ok: true, ticker: "ETH", date: "2026-11-14" });
  });
});

describe("seller routing", () => {
  it("unknown seller → 404", async () => {
    expect((await call("", {}, "premiumreports")).status).toBe(404);
  });

  it("missing DATACO_WALLET → 500, not a quote to nobody", async () => {
    vi.stubEnv("DATACO_WALLET", "");
    expect((await call("ticker=SOL&date=2026-11-14")).status).toBe(500);
  });
});
