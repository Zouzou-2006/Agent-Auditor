import type { PaymentRequirements } from "@x402/core/types";
import { describe, expect, it } from "vitest";
import { checkPaymentMemo, memoGuardHook } from "@/lib/gateway/memo-guard";

const ORDER = "6f1c2a8e-0b7d-4c1e-9a52-3d4e5f60718a";

function req(extra: Record<string, unknown>): PaymentRequirements {
  return {
    scheme: "exact",
    network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    amount: "100000",
    asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    payTo: "bcSuSumf9ChahaHsvz92xDnXSMABkSo6qcYV1kwrnWa",
    maxTimeoutSeconds: 300,
    extra,
  };
}

describe("checkPaymentMemo", () => {
  it("accepts a memo equal to the order_id", () => {
    expect(checkPaymentMemo(req({ memo: ORDER }), ORDER)).toEqual({ ok: true });
  });

  it("rejects a different memo", () => {
    expect(checkPaymentMemo(req({ memo: "11111111-2222-4333-8444-555555555555" }), ORDER)).toEqual({
      ok: false,
      reason: "seller quote memo does not match order_id",
    });
  });

  it.each([{}, { memo: "" }, { memo: 42 }])("rejects a missing or non-string memo: %j", (extra) => {
    expect(checkPaymentMemo(req(extra), ORDER)).toEqual({ ok: false, reason: "seller quote has no memo" });
  });

  it("is exact: no trimming or case folding", () => {
    expect(checkPaymentMemo(req({ memo: ORDER.toUpperCase() }), ORDER).ok).toBe(false);
    expect(checkPaymentMemo(req({ memo: ` ${ORDER}` }), ORDER).ok).toBe(false);
  });
});

describe("memoGuardHook", () => {
  it("returns undefined (continue) when the memo matches", async () => {
    await expect(memoGuardHook(ORDER)({ selectedRequirements: req({ memo: ORDER }) })).resolves.toBeUndefined();
  });

  it("aborts when it does not", async () => {
    await expect(memoGuardHook(ORDER)({ selectedRequirements: req({}) })).resolves.toEqual({
      abort: true,
      reason: "seller quote has no memo",
    });
  });
});
