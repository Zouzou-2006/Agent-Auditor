import { describe, expect, it } from "vitest";
import rules from "../config/rules.json";
import { checkOrder, checkQuote, needsReview, type Quote, type Seller } from "../lib/rules";

const USDC_MINT = rules.usdc_mint;
// Mainnet USDC mint: a real, different mint that must NOT pass on devnet.
const OTHER_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const DATACO: Seller = { wallet: "DataCoWa11et1111111111111111111111111111111", status: "approved" };
const OTHER_WALLET = "SomeoneE1se2222222222222222222222222222222";

const quote = (overrides: Partial<Quote> = {}): Quote => ({
  amount: 100000,
  wallet: DATACO.wallet,
  asset: USDC_MINT,
  network: rules.network,
  ...overrides,
});

describe("checkOrder", () => {
  it("happy path: DataCo, max $0.10, spent 0 → ok", () => {
    const order = { max_amount: 100000 };
    expect(checkOrder(order, DATACO, 0)).toEqual({ ok: true });
    expect(checkQuote(order, quote(), DATACO)).toEqual({ ok: true });
  });

  it("seller null → seller not approved", () => {
    expect(checkOrder({ max_amount: 100000 }, null, 0)).toEqual({
      ok: false, rule: 1, reason: "seller not approved",
    });
  });

  it("seller blocked → seller blocked", () => {
    expect(checkOrder({ max_amount: 100000 }, { ...DATACO, status: "blocked" }, 0)).toEqual({
      ok: false, rule: 1, reason: "seller blocked",
    });
  });

  it.each(["pending", "", "Approved", "APPROVED", "approved "])(
    "seller status %j (not exactly \"approved\") → seller blocked",
    (status) => {
      expect(checkOrder({ max_amount: 100000 }, { ...DATACO, status }, 0)).toEqual({
        ok: false, rule: 1, reason: "seller blocked",
      });
    },
  );

  it("max 1500000 → over per-purchase limit", () => {
    expect(checkOrder({ max_amount: 1500000 }, DATACO, 0)).toEqual({
      ok: false, rule: 2, reason: "over per-purchase limit",
    });
  });

  it("max 1000000 (exactly the limit) → passes rule 2", () => {
    expect(checkOrder({ max_amount: 1000000 }, DATACO, 0)).toEqual({ ok: true });
  });

  it("max 100000, spent 4950000 → over daily limit", () => {
    expect(checkOrder({ max_amount: 100000 }, DATACO, 4950000)).toEqual({
      ok: false, rule: 3, reason: "over daily limit",
    });
  });

  it("max 100000, spent 4900000 (lands exactly on the limit) → ok", () => {
    expect(checkOrder({ max_amount: 100000 }, DATACO, 4900000)).toEqual({ ok: true });
  });
});

describe("checkQuote", () => {
  const order = { max_amount: 100000 };

  it("quote 150000 on max 100000 → quote over max", () => {
    expect(checkQuote(order, quote({ amount: 150000 }), DATACO)).toEqual({
      ok: false, rule: 4, reason: "quote over max",
    });
  });

  it("quote to a different wallet → quote wallet doesn't match seller", () => {
    expect(checkQuote(order, quote({ wallet: OTHER_WALLET }), DATACO)).toEqual({
      ok: false, rule: 5, reason: "quote wallet doesn't match seller",
    });
  });

  it("quote asset SOL → wrong asset or network", () => {
    expect(checkQuote(order, quote({ asset: "SOL" }), DATACO)).toEqual({
      ok: false, rule: 6, reason: "wrong asset or network",
    });
  });

  it("network is exactly the x402 devnet id from rules.json", () => {
    expect(rules.network).toBe("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1");
  });

  it.each(["solana-devnet", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"])(
    "quote network %j → wrong asset or network",
    (network) => {
      expect(checkQuote(order, quote({ network }), DATACO)).toEqual({
        ok: false, rule: 6, reason: "wrong asset or network",
      });
    },
  );

  it("quote asset is a different mint address → wrong asset or network", () => {
    expect(checkQuote(order, quote({ asset: OTHER_MINT }), DATACO)).toEqual({
      ok: false, rule: 6, reason: "wrong asset or network",
    });
  });
});

describe("needsReview", () => {
  it("max 600000 → true", () => {
    expect(needsReview({ max_amount: 600000 })).toBe(true);
  });

  it("max 500000 (exactly the threshold) → false", () => {
    expect(needsReview({ max_amount: 500000 })).toBe(false);
  });
});
