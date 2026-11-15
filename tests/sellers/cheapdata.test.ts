import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import rules from "../../config/rules.json";
import { GET } from "../../app/api/sellers/[seller]/route";
import type { OrderRow } from "../../lib/db-types";
import { runChecks } from "../../lib/delivery";
import { checkQuote } from "../../lib/rules";
import { CHEAPDATA_PRICE } from "../../lib/sellers/cheapdata";
import { decodeHeader, encodeHeader, resetFeePayerCache, type PaymentRequired } from "../../lib/sellers/x402";

const CHEAPDATA_WALLET = "9umxy5AaLN4v8uVowiT6RpWi97Jwj7ttRtTdnSoCsrK2";
const FACILITATOR = "https://facilitator.test";
const ORDER_ID = "0b6f3c2e-8a51-4e7b-9a0d-5f2c1e4d7a90";
const PAID = { "PAYMENT-SIGNATURE": encodeHeader({ x402Version: 2, payload: { transaction: "base64tx" } }) };

function mockFacilitator(verify: object = { isValid: true }) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const path = input.replace(FACILITATOR, "");
      calls.push(path);
      if (path === "/supported") {
        return Response.json({ kinds: [{ scheme: "exact", network: rules.network, extra: { feePayer: "FeePayer1" } }] });
      }
      if (path === "/verify") return Response.json(verify);
      if (path === "/settle") return Response.json({ success: true, transaction: "CheapTx", network: rules.network });
      return new Response("not found", { status: 404 });
    }),
  );
  return calls;
}

const call = (headers: Record<string, string> = {}, query = "ticker=SOL&date=2026-11-15") =>
  GET(new Request(`http://localhost/api/sellers/cheapdata?${query}`, { headers: { "X-Order-Id": ORDER_ID, ...headers } }), {
    params: Promise.resolve({ seller: "cheapdata" }),
  });

beforeEach(() => {
  vi.stubEnv("CHEAPDATA_WALLET", CHEAPDATA_WALLET);
  vi.stubEnv("X402_FACILITATOR_URL", FACILITATOR);
  resetFeePayerCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("CheapData", () => {
  it("quotes like an honest seller, so every rule passes and the gateway pays", async () => {
    mockFacilitator();
    const res = await call();
    expect(res.status).toBe(402);
    const [q] = ((await res.json()) as PaymentRequired).accepts;
    expect(q).toMatchObject({ amount: "100000", payTo: CHEAPDATA_WALLET, asset: rules.usdc_mint, extra: { memo: ORDER_ID } });
    const quote = { amount: Number(q.amount), wallet: q.payTo, asset: q.asset, network: q.network };
    expect(checkQuote({ max_amount: CHEAPDATA_PRICE }, quote, { wallet: CHEAPDATA_WALLET, status: "approved" })).toEqual({ ok: true });
  });

  it("takes the payment (verify + settle), then delivers an EMPTY body", async () => {
    const calls = mockFacilitator();
    const res = await call(PAID);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    expect(decodeHeader(res.headers.get("PAYMENT-RESPONSE")!)).toMatchObject({ success: true, transaction: "CheapTx" });
    expect(calls).toEqual(["/supported", "/verify", "/settle"]);
  });

  it("the empty body fails the delivery checks at 'received' → nothing_delivered", async () => {
    mockFacilitator();
    const body = await (await call(PAID)).text();
    const order = { item: "price_quote", params: { ticker: "SOL", date: "2026-11-15" } } as Pick<OrderRow, "item" | "params">;
    expect(runChecks(order, body)).toEqual({
      checks: { received: false, format: false, matches_order: false },
      passed: false,
    });
  });

  it("a payment that doesn't verify gets a 402 again (it isn't free money either)", async () => {
    mockFacilitator({ isValid: false, invalidReason: "insufficient_funds" });
    expect((await call(PAID)).status).toBe(402);
  });

  it("missing CHEAPDATA_WALLET → 500, never a quote to nobody", async () => {
    vi.stubEnv("CHEAPDATA_WALLET", "");
    expect((await call()).status).toBe(500);
  });

  it("no X-Order-Id → 400 before any quote", async () => {
    const calls = mockFacilitator();
    expect((await call({ "X-Order-Id": "" })).status).toBe(400);
    expect(calls).toEqual([]);
  });
});
