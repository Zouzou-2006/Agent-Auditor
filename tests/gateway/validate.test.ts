import { describe, expect, it } from "vitest";
import { usdFromBaseUnits } from "@/lib/gateway/pay";
import { utcDayBounds } from "@/lib/gateway/gateway-db";
import { parseOrderRequest, parseQuoteAmount, sellerUrl, toQuote } from "@/lib/gateway/validate";

const good = {
  seller_id: "dataco",
  item: "price_quote",
  params: { ticker: "SOL", date: "2026-11-14" },
  max_amount: 100000,
  purpose: "Daily SOL price",
};

describe("parseOrderRequest", () => {
  it("accepts the SPEC example", () => {
    expect(parseOrderRequest(good)).toEqual({ ok: true, value: good });
  });

  it.each([
    -1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "100000", null, 2 ** 60,
  ])("rejects max_amount %s", (max_amount) => {
    const result = parseOrderRequest({ ...good, max_amount });
    expect(result).toEqual({ ok: false, error: "max_amount must be a positive integer of USDC base units" });
  });

  it.each([
    [{ seller_id: "" }, "seller_id"],
    [{ seller_id: 7 }, "seller_id"],
    [{ item: " " }, "item"],
    [{ params: [] }, "params"],
    [{ params: "ticker=SOL" }, "params"],
    [{ params: { ticker: { nested: true } } }, "params.ticker"],
    [{ purpose: undefined }, "purpose"],
  ])("rejects %j", (overrides, field) => {
    const result = parseOrderRequest({ ...good, ...overrides });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain(field);
  });

  it.each([null, [], "x", 42])("rejects a non-object body %j", (body) => {
    expect(parseOrderRequest(body).ok).toBe(false);
  });
});

describe("parseQuoteAmount (x402 sends a base-units string)", () => {
  it.each([
    ["100000", 100000],
    ["0", 0],
  ])("%s -> %i", (input, expected) => {
    expect(parseQuoteAmount(input)).toBe(expected);
  });

  it.each(["0.1", "-5", "1e5", " 100", "", "99999999999999999999", 100000, null])("rejects %j", (input) => {
    expect(parseQuoteAmount(input)).toBeNull();
  });
});

describe("toQuote", () => {
  it("maps x402 requirements to checkQuote's { amount, wallet, asset, network }", () => {
    expect(toQuote({ amount: "100000", payTo: "W", asset: "M", network: "N" })).toEqual({
      amount: 100000,
      wallet: "W",
      asset: "M",
      network: "N",
    });
  });

  it("returns null for a malformed quote", () => {
    expect(toQuote({ amount: "1.5", payTo: "W", asset: "M", network: "N" })).toBeNull();
    expect(toQuote({ amount: "1", payTo: 5, asset: "M", network: "N" })).toBeNull();
  });
});

describe("sellerUrl", () => {
  it("puts params on the query string", () => {
    expect(sellerUrl("http://localhost:3000/api/sellers/dataco", { ticker: "SOL", date: "2026-11-14" })).toBe(
      "http://localhost:3000/api/sellers/dataco?ticker=SOL&date=2026-11-14",
    );
  });
});

describe("helpers", () => {
  it("formats base units as USD without floats", () => {
    expect(usdFromBaseUnits(1_000_000)).toBe("$1.000000");
    expect(usdFromBaseUnits(100_000)).toBe("$0.100000");
  });

  it("todaySpent uses the UTC day", () => {
    expect(utcDayBounds(new Date("2026-11-14T23:59:59-05:00"))).toEqual({
      start: "2026-11-15T00:00:00.000Z",
      end: "2026-11-16T00:00:00.000Z",
    });
  });
});
